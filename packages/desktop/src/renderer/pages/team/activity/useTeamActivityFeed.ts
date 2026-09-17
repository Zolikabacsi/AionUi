/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { ITeamActivityItem, ITeamMailboxMessage, ITeamTaskItem } from '@/common/types/team/teamTypes';

const PAGE_SIZE = 100;

export type ActivityFeedDirection = 'desc' | 'asc';
export type ActivityFeedKind = 'all' | 'message' | 'task';

type Cursor = { ts: number; id: string } | undefined;

export type TeamActivityFeed = {
  messages: ITeamMailboxMessage[];
  tasks: ITeamTaskItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: unknown;
};

/**
 * Single-cursor paginated feed of a team's unified activity (messages + tasks).
 *
 * The backend merges both streams so one keyset cursor is continuous. Returned
 * items are routed into two id-keyed maps (`messagesById`/`tasksById`) that the
 * downstream board derives ordering/lanes from. Paging direction follows
 * `direction` (`desc` = newest first walking older; `asc` = oldest first walking
 * newer) and content scope follows `kind` (server-side). Switching either resets
 * the maps + cursor and refetches the first page; every request carries an epoch
 * so responses from a superseded direction/kind/team are discarded.
 *
 * WS upserts are decided against the loaded window edge: an event whose id is
 * already loaded updates in place; an unknown id is only inserted when it is
 * genuinely newer than the window (desc) or the newest end is loaded (asc) —
 * events landing in the not-yet-loaded older region are dropped and self-heal
 * when paging reaches them.
 *
 * When `engagement_id` is set the page is fetched from the engagement-scoped
 * route instead. WS payloads carry no engagement id, so an unknown event id
 * can't be attributed client-side and triggers a full refetch instead of the
 * optimistic window-edge insert.
 */
export function useTeamActivityFeed(
  team_id: string,
  active: boolean,
  direction: ActivityFeedDirection,
  kind: ActivityFeedKind,
  engagement_id?: string | null
): TeamActivityFeed {
  const [messagesById, setMessagesById] = useState<Record<string, ITeamMailboxMessage>>({});
  const [tasksById, setTasksById] = useState<Record<string, ITeamTaskItem>>({});
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cursorRef = useRef<Cursor>(undefined);
  const hasMoreRef = useRef(false);
  const epochRef = useRef(0);
  const loadingRef = useRef(false);

  // Mirror the maps into refs so the WS handlers can compute the window edge
  // across both streams without re-subscribing on every state change.
  const messagesByIdRef = useRef(messagesById);
  const tasksByIdRef = useRef(tasksById);
  messagesByIdRef.current = messagesById;
  tasksByIdRef.current = tasksById;

  const mergeItems = useCallback((items: ITeamActivityItem[]) => {
    const msgs: Record<string, ITeamMailboxMessage> = {};
    const tks: Record<string, ITeamTaskItem> = {};
    for (const it of items) {
      if (it.kind === 'message') msgs[it.message.id] = it.message;
      else tks[it.task.id] = it.task;
    }
    if (Object.keys(msgs).length) setMessagesById((prev) => ({ ...prev, ...msgs }));
    if (Object.keys(tks).length) setTasksById((prev) => ({ ...prev, ...tks }));
  }, []);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      if (!reset && !hasMoreRef.current) return;
      loadingRef.current = true;
      const myEpoch = epochRef.current;
      if (reset) setIsLoading(true);
      else setIsLoadingMore(true);
      try {
        const params = {
          team_id,
          limit: PAGE_SIZE,
          direction,
          kind,
          cursor_ts: reset ? undefined : cursorRef.current?.ts,
          cursor_id: reset ? undefined : cursorRef.current?.id,
        };
        const page = engagement_id
          ? await ipcBridge.team.listEngagementActivity.invoke({ ...params, engagement_id })
          : await ipcBridge.team.listActivity.invoke(params);
        if (myEpoch !== epochRef.current) return; // superseded — discard
        if (reset) {
          setMessagesById({});
          setTasksById({});
        }
        mergeItems(page?.items ?? []);
        // Advance by the server's raw last item, not a client-filtered one.
        cursorRef.current = page?.next_cursor;
        hasMoreRef.current = Boolean(page?.has_more);
        setHasMore(hasMoreRef.current);
        setError(null);
      } catch (e) {
        if (myEpoch === epochRef.current) setError(e);
      } finally {
        // Only the current-epoch request owns the loading flags/lock.
        if (myEpoch === epochRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
          loadingRef.current = false;
        }
      }
    },
    [team_id, engagement_id, direction, kind, mergeItems]
  );

  const resetAndReload = useCallback(() => {
    epochRef.current += 1;
    cursorRef.current = undefined;
    hasMoreRef.current = false;
    loadingRef.current = false;
    setMessagesById({});
    setTasksById({});
    setHasMore(false);
    void fetchPage(true);
  }, [fetchPage]);

  // Reset + first page on activation and whenever team/engagement/direction/kind changes.
  useEffect(() => {
    if (!active) return;
    resetAndReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, team_id, engagement_id, direction, kind]);

  const loadMore = useCallback(() => {
    void fetchPage(false);
  }, [fetchPage]);

  // WS upserts + reconnect realignment.
  useEffect(() => {
    if (!active) return;

    const newestEdge = (): { ts: number; id: string } | null => {
      let best: { ts: number; id: string } | null = null;
      const consider = (ts: number, id: string) => {
        if (!best || ts > best.ts || (ts === best.ts && id > best.id)) best = { ts, id };
      };
      for (const m of Object.values(messagesByIdRef.current)) consider(m.created_at, m.id);
      for (const tk of Object.values(tasksByIdRef.current)) consider(tk.created_at, tk.id);
      return best;
    };

    const shouldInsertNew = (ts: number, id: string): boolean => {
      if (direction === 'desc') {
        const edge = newestEdge();
        return !edge || ts > edge.ts || (ts === edge.ts && id > edge.id);
      }
      // asc: window grows toward newer rows; only append once the newest end
      // is loaded, otherwise the item belongs to a not-yet-loaded region.
      return !hasMoreRef.current;
    };

    const unsubs = [
      ipcBridge.team.mailboxChanged.on((event) => {
        if (event.team_id !== team_id) return;
        const m = event.message;
        if (engagement_id) {
          // Payload has no engagement id: unknown rows can't be attributed to
          // this engagement, so reload the window instead of inserting blindly.
          if (messagesByIdRef.current[m.id]) setMessagesById((prev) => ({ ...prev, [m.id]: m }));
          else resetAndReload();
          return;
        }
        setMessagesById((prev) => {
          if (prev[m.id]) return { ...prev, [m.id]: m }; // in-window update
          return shouldInsertNew(m.created_at, m.id) ? { ...prev, [m.id]: m } : prev;
        });
      }),
      ipcBridge.team.taskChanged.on((event) => {
        if (event.team_id !== team_id) return;
        if (!event.task) {
          // Legacy event without a payload: realign by reloading the first page.
          resetAndReload();
          return;
        }
        const tk = event.task;
        if (engagement_id) {
          if (tasksByIdRef.current[tk.id]) setTasksById((prev) => ({ ...prev, [tk.id]: tk }));
          else resetAndReload();
          return;
        }
        setTasksById((prev) => {
          if (prev[tk.id]) return { ...prev, [tk.id]: tk };
          return shouldInsertNew(tk.created_at, tk.id) ? { ...prev, [tk.id]: tk } : prev;
        });
      }),
      ipcBridge.realtime.reconnected.on(() => {
        resetAndReload();
      }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, team_id, engagement_id, direction, resetAndReload]);

  const messages = useMemo(() => Object.values(messagesById), [messagesById]);
  const tasks = useMemo(() => Object.values(tasksById), [tasksById]);

  return {
    messages,
    tasks,
    isLoading: active ? isLoading : false,
    isLoadingMore,
    hasMore,
    loadMore,
    error,
  };
}
