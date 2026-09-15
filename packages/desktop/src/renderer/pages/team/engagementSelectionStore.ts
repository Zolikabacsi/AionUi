/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-team selected-engagement store (module-level, localStorage-backed).
 * Mirrors the subscribe pattern of `currentProjectStore` but keyed by team id
 * and persisted, like the other `team-*-` localStorage slots (pruned via
 * `pruneOrphanTeamStorage`).
 *
 * The raw selection (`getSelectedEngagement`) may be unset; callers resolve a
 * concrete engagement with `resolveEngagementSelection`, which applies the
 * Phase-5b default (D3): a valid stored id wins, else the engagement whose
 * project matches the team's `project_id`, else the newest active one, else
 * `null` (legacy team with no engagements).
 */

import { useSyncExternalStore } from 'react';
import type { TeamEngagement } from '@/common/types/team/teamTypes';

const storageKey = (teamId: string): string => `team-engagement-${teamId}`;

const selections = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

/** Read the raw stored selection for a team (no default resolution). */
export function getSelectedEngagement(teamId: string): string | null {
  const inMemory = selections.get(teamId);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = localStorage.getItem(storageKey(teamId));
    if (stored) {
      selections.set(teamId, stored);
      return stored;
    }
  } catch {
    // storage unavailable — in-memory only
  }
  return null;
}

/** Persist and broadcast a team's selected engagement id. */
export function setSelectedEngagement(teamId: string, engagementId: string): void {
  if (selections.get(teamId) === engagementId) return;
  selections.set(teamId, engagementId);
  try {
    localStorage.setItem(storageKey(teamId), engagementId);
  } catch {
    // storage unavailable — selection stays in memory for this session
  }
  const teamListeners = listeners.get(teamId);
  if (teamListeners) {
    for (const listener of teamListeners) listener();
  }
}

/** Subscribe to a team's selection changes. Returns an unsubscribe fn. */
export function subscribeEngagementSelection(teamId: string, listener: () => void): () => void {
  let set = listeners.get(teamId);
  if (!set) {
    set = new Set();
    listeners.set(teamId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/**
 * Default resolution (D3). `null` means the team has no engagements yet
 * (legacy / project-agnostic team) — callers fall back to team.project_id.
 */
export function resolveEngagementSelection(
  teamId: string,
  engagements: TeamEngagement[],
  teamProjectId: string | null
): string | null {
  const stored = getSelectedEngagement(teamId);
  if (stored && engagements.some((e) => e.id === stored)) return stored;

  if (teamProjectId) {
    const match = engagements.find((e) => e.project_id === teamProjectId);
    if (match) return match.id;
  }

  let newestActive: TeamEngagement | null = null;
  for (const e of engagements) {
    if (e.status !== 'active') continue;
    if (!newestActive || e.created_at > newestActive.created_at) newestActive = e;
  }
  return newestActive?.id ?? null;
}

/** React hook: subscribe to a team's selected engagement id. */
export function useSelectedEngagementId(teamId: string): string | null {
  return useSyncExternalStore(
    (cb) => subscribeEngagementSelection(teamId, cb),
    () => getSelectedEngagement(teamId),
    () => getSelectedEngagement(teamId)
  );
}

/** Test hook: reset in-memory selections and listeners. */
export function resetEngagementSelectionForTest(): void {
  selections.clear();
  listeners.clear();
}
