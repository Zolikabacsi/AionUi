/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamAssistant, TTeam } from '@/common/types/team/teamTypes';
import { useTeamSession } from '@/renderer/pages/team/hooks/useTeamSession';

const { teamEventHandlers, makeTeamEventChannel, eventChannel, getMock } = vi.hoisted(() => {
  const handlers: Record<string, unknown> = {};
  const makeChannel = (name: string) => ({
    on: vi.fn((handler: unknown) => {
      handlers[name] = handler;
      return vi.fn();
    }),
  });
  return {
    teamEventHandlers: handlers,
    makeTeamEventChannel: makeChannel,
    eventChannel: makeChannel('shared'),
    getMock: vi.fn(),
  };
});

vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  revalidateAcpConfigOptions: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: { removeJob: { invoke: vi.fn() } },
    team: {
      get: { invoke: getMock },
      addAgent: { invoke: vi.fn() },
      renameAgent: { invoke: vi.fn() },
      removeAgent: { invoke: vi.fn() },
      agentStatusChanged: makeTeamEventChannel('agentStatusChanged'),
      agentSpawned: eventChannel,
      agentRemoved: eventChannel,
      agentRenamed: eventChannel,
      agentRuntimeStatusChanged: makeTeamEventChannel('agentRuntimeStatusChanged'),
      sessionStatusChanged: eventChannel,
      taskChanged: eventChannel,
      sessionChanged: eventChannel,
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

function assistant(over: Partial<TeamAssistant> = {}): TeamAssistant {
  return {
    slot_id: 'member-slot',
    conversation_id: 'member-conv',
    role: 'teammate',
    assistant_backend: 'codex',
    assistant_name: 'Member',
    status: 'idle',
    context_reset: { supported: true, availability: 'ready' },
    ...over,
  };
}

function team(assistants: TeamAssistant[]): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Seed Team',
    workspace: '/tmp/team',
    workspace_mode: 'shared',
    leader_assistant_id: 'leader-assistant',
    created_at: 1,
    updated_at: 1,
    assistants,
  };
}

describe('useTeamSession statusMap seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(teamEventHandlers)) delete teamEventHandlers[key];
    getMock.mockResolvedValue(team([]));
  });

  it('seeds from the team template assistants when no seed assistants are passed (legacy)', () => {
    const { result } = renderHook(() => useTeamSession(team([assistant()])));
    expect(result.current.statusMap.get('member-slot')?.status).toBe('idle');
  });

  it('seeds from the passed assistants so engagement runtime slots resolve', () => {
    const joined = [assistant({ slot_id: 'eng-member', conversation_id: 'eng-conv', status: 'active' })];
    const { result } = renderHook(() => useTeamSession(team([assistant()]), undefined, joined));
    expect(result.current.statusMap.get('eng-member')?.status).toBe('active');
    // The template slot id must NOT leak into the engagement-keyed map.
    expect(result.current.statusMap.has('member-slot')).toBe(false);
  });

  it('re-seeds on slot-set switch: keeps live entries, seeds new slots, drops stale ones', () => {
    const { result, rerender } = renderHook(
      ({ seed }: { seed?: TeamAssistant[] }) =>
        useTeamSession(team([assistant(), assistant({ slot_id: 'leader-slot', role: 'leader' })]), undefined, seed),
      { initialProps: { seed: undefined as TeamAssistant[] | undefined } }
    );
    const statusHandler = teamEventHandlers.agentStatusChanged as (e: {
      team_id: string;
      slot_id: string;
      status: string;
    }) => void;
    act(() => statusHandler({ team_id: 'team-1', slot_id: 'member-slot', status: 'working' }));
    expect(result.current.statusMap.get('member-slot')?.status).toBe('active');

    // Engagement switch: member-slot stays (runtime id reuse), leader-slot is
    // gone, eng-new appears.
    rerender({ seed: [assistant(), assistant({ slot_id: 'eng-new', conversation_id: 'eng-new-conv' })] });

    expect(result.current.statusMap.get('member-slot')?.status).toBe('active'); // live entry not clobbered
    expect(result.current.statusMap.get('eng-new')?.status).toBe('idle'); // new slot seeded
    expect(result.current.statusMap.has('leader-slot')).toBe(false); // stale slot dropped
  });
});
