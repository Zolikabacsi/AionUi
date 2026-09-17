// src/renderer/pages/team/hooks/useTeamSession.ts
import { ipcBridge } from '@/common';
import { normalizeTeamStatus } from '@/common/adapter/teamMapper';
import type { TeamAssistantInput } from '@/common/adapter/teamMapper';
import type {
  ITeamAgentRemovedEvent,
  ITeamAgentRenamedEvent,
  ITeamAgentRuntimeStatusEvent,
  ITeamAgentSpawnedEvent,
  ITeamAgentStatusEvent,
  ITeamSessionChangedEvent,
  ITeamSessionStatusChangedEvent,
  ITeamTaskChangedEvent,
  TeamAssistant,
  TeammateStatus,
  TTeam,
} from '@/common/types/team/teamTypes';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { revalidateAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { removeTeamAssistantWithCronCleanup } from '../utils/removeTeamAssistantWithCronCleanup';
import {
  applyTeamRuntimeStatusToMembershipMutationState,
  applyTeamSessionStatusToMembershipMutationState,
  createTeamMembershipMutationState,
  isTeamMembershipMutationBusy,
} from './teamMembershipMutationBusy';
import type { TeamWarmupPhase } from './useTeamWarmup';

type AgentStatusInfo = {
  slot_id: string;
  status: TeammateStatus;
  last_message?: string;
};

export function useTeamSession(team: TTeam, warmupPhase?: TeamWarmupPhase, seedAssistants?: TeamAssistant[]) {
  const { mutate: mutateTeam } = useSWR(team.id ? `team/${team.id}` : null, () =>
    ipcBridge.team.get.invoke({ id: team.id })
  );

  // Slot ids the badges/lookups actually render for: engagement members carry
  // runtime slot ids (D2 join), so seeding from `team.assistants` (template
  // ids) would never match. Defaults to `team.assistants` for legacy callers.
  const seed = seedAssistants ?? team.assistants;
  const seedSlotIdsKey = seed.map((a) => a.slot_id).join('|');
  const [statusMap, setStatusMap] = useState<Map<string, AgentStatusInfo>>(
    () => new Map(seed.map((a) => [a.slot_id, { slot_id: a.slot_id, status: a.status }]))
  );

  // Re-key the seed when the displayed slot set changes (engagement switch):
  // seed new slots and drop slots no longer shown, but never clobber live
  // event-sourced entries for still-present slots.
  useEffect(() => {
    setStatusMap((prev) => {
      const ids = new Set(seed.map((a) => a.slot_id));
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (!ids.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      for (const a of seed) {
        if (!next.has(a.slot_id)) {
          next.set(a.slot_id, { slot_id: a.slot_id, status: a.status });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // `seedSlotIdsKey` is the only trigger: status changes for retained slots
    // must not overwrite live entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSlotIdsKey]);
  const [membershipMutationState, setMembershipMutationState] = useState(createTeamMembershipMutationState);
  const membershipMutationBusy = isTeamMembershipMutationBusy(membershipMutationState);

  useEffect(() => {
    if (warmupPhase === 'ready' || warmupPhase === 'error') {
      setMembershipMutationState(createTeamMembershipMutationState());
    }
  }, [team.id, warmupPhase]);

  useEffect(() => {
    const unsubStatus = ipcBridge.team.agentStatusChanged.on((event: ITeamAgentStatusEvent) => {
      if (event.team_id !== team.id) return;
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(event.slot_id, {
          slot_id: event.slot_id,
          status: normalizeTeamStatus(event.status),
          last_message: event.last_message,
        });
        return next;
      });
    });

    const unsubSpawned = ipcBridge.team.agentSpawned.on((event: ITeamAgentSpawnedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRemoved = ipcBridge.team.agentRemoved.on((event: ITeamAgentRemovedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRenamed = ipcBridge.team.agentRenamed.on((event: ITeamAgentRenamedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRuntimeStatus = ipcBridge.team.agentRuntimeStatusChanged.on((event: ITeamAgentRuntimeStatusEvent) => {
      if (event.team_id !== team.id) return;
      setMembershipMutationState((prev) =>
        applyTeamRuntimeStatusToMembershipMutationState(prev, event.slot_id, event.status)
      );
      // Dormant is the only runtime state with no other status source, so
      // surface it on the badge directly. pending/ready/failed stay driven by
      // agentStatusChanged plus the send-box runtime gate as before.
      if (event.status === 'dormant') {
        setStatusMap((prev) => {
          const next = new Map(prev);
          next.set(event.slot_id, { slot_id: event.slot_id, status: normalizeTeamStatus('dormant') });
          return next;
        });
        return;
      }
      if (event.status !== 'ready') return;
      void revalidateAcpConfigOptions(event.conversation_id);
    });

    const unsubSessionStatus = ipcBridge.team.sessionStatusChanged.on((event: ITeamSessionStatusChangedEvent) => {
      if (event.team_id !== team.id) return;
      setMembershipMutationState((prev) => applyTeamSessionStatusToMembershipMutationState(prev, event.status));
    });

    const unsubTaskChanged = ipcBridge.team.taskChanged.on((event: ITeamTaskChangedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubSessionChanged = ipcBridge.team.sessionChanged.on((event: ITeamSessionChangedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    return () => {
      unsubStatus();
      unsubSpawned();
      unsubRemoved();
      unsubRenamed();
      unsubRuntimeStatus();
      unsubSessionStatus();
      unsubTaskChanged();
      unsubSessionChanged();
    };
  }, [team.id, mutateTeam]);

  const addAssistant = useCallback(
    async (assistant: TeamAssistantInput): Promise<TeamAssistant> => {
      const created = await ipcBridge.team.addAgent.invoke({ team_id: team.id, assistant });
      await mutateTeam();
      return created;
    },
    [team.id, mutateTeam]
  );

  const renameAssistant = useCallback(
    async (slot_id: string, new_name: string) => {
      await ipcBridge.team.renameAgent.invoke({ team_id: team.id, slot_id, new_name });
      await mutateTeam();
    },
    [team.id, mutateTeam]
  );

  const removeAssistant = useCallback(
    async (slot_id: string) => {
      await removeTeamAssistantWithCronCleanup({
        team,
        slot_id,
        getConversation: getConversationOrNull,
        removeCronJob: (job_id) => ipcBridge.cron.removeJob.invoke({ job_id }),
        removeAgent: (params) => ipcBridge.team.removeAgent.invoke(params),
      });
      await mutateTeam();
    },
    [team, mutateTeam]
  );

  return { statusMap, membershipMutationBusy, addAssistant, renameAssistant, removeAssistant, mutateTeam };
}
