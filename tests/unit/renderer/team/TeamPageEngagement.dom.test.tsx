/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';

const { getConversationOrNullMock, ensureSessionMock, listEngagementsMock, listEngagementMembersMock, makeChannel } =
  vi.hoisted(() => {
    const makeChannel = (_name: string) => ({
      on: vi.fn(() => vi.fn()),
    });
    return {
      getConversationOrNullMock: vi.fn(),
      ensureSessionMock: vi.fn(async () => undefined),
      listEngagementsMock: vi.fn(async () => [] as unknown[]),
      listEngagementMembersMock: vi.fn(async () => [] as unknown[]),
      makeChannel,
    };
  });

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), useMessage: () => [null, null] },
    Modal: Object.assign(actual.Modal, { confirm: vi.fn() }),
  };
});

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      get: { invoke: vi.fn() },
      renameTeam: { invoke: vi.fn() },
      addAgent: { invoke: vi.fn() },
      removeAgent: { invoke: vi.fn() },
      attachAgent: { invoke: vi.fn(async () => undefined) },
      resetAgentContext: { invoke: vi.fn() },
      pauseSlotWork: { invoke: vi.fn() },
      getRunState: { invoke: vi.fn(async () => ({ session_generation: null, active_run: null, slot_work: [] })) },
      activeLease: { invoke: vi.fn(async () => ({ renewed_count: 2 })) },
      ensureSession: { invoke: (...args: unknown[]) => ensureSessionMock(...args) },
      listEngagements: { invoke: (arg: unknown) => listEngagementsMock(arg) },
      listEngagementMembers: { invoke: (arg: unknown) => listEngagementMembersMock(arg) },
      agentStatusChanged: makeChannel('agentStatusChanged'),
      agentSpawned: makeChannel('agentSpawned'),
      agentRemoved: makeChannel('agentRemoved'),
      agentRenamed: makeChannel('agentRenamed'),
      agentRuntimeStatusChanged: makeChannel('agentRuntimeStatusChanged'),
      sessionStatusChanged: makeChannel('sessionStatusChanged'),
      taskChanged: makeChannel('taskChanged'),
      mailboxChanged: makeChannel('mailboxChanged'),
      sessionChanged: makeChannel('sessionChanged'),
      runAccepted: makeChannel('runAccepted'),
      runStarted: makeChannel('runStarted'),
      runUpdated: makeChannel('runUpdated'),
      runCompleted: makeChannel('runCompleted'),
      runCancelled: makeChannel('runCancelled'),
      runFailed: makeChannel('runFailed'),
      childTurnStarted: makeChannel('childTurnStarted'),
      childTurnCompleted: makeChannel('childTurnCompleted'),
      childTurnCancelled: makeChannel('childTurnCancelled'),
      slotWorkChanged: makeChannel('slotWorkChanged'),
      listChanged: makeChannel('listChanged'),
    },
    cron: { removeJob: { invoke: vi.fn() } },
    assistant: { list: { invoke: vi.fn(async () => []) } },
    sidebar: { get: { invoke: vi.fn(async () => ({ groups: [] })) } },
    conversation: {
      update: { invoke: vi.fn(async () => undefined) },
      listChanged: makeChannel('conversationListChanged'),
      confirmation: {
        list: { invoke: vi.fn(async () => []) },
        add: makeChannel('confirmationAdd'),
        remove: makeChannel('confirmationRemove'),
      },
    },
    realtime: { reconnected: makeChannel('reconnected') },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: (...args: unknown[]) => getConversationOrNullMock(...args),
}));

// ChatLayout mock surfaces the values TeamPage derives, so we can assert the
// engagement rebind without rendering the real (heavy) layout subtree.
vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  __esModule: true,
  default: ({
    children,
    tabsSlot,
    workspacePath,
    previewHosted,
    siderTitle,
  }: {
    children: React.ReactNode;
    tabsSlot?: React.ReactNode;
    workspacePath?: string | null;
    previewHosted?: boolean;
    siderTitle?: React.ReactNode;
  }) => (
    <div>
      <div data-testid='sider-title'>{siderTitle}</div>
      <div data-testid='workspace-path'>{String(workspacePath ?? '')}</div>
      <div data-testid='preview-hosted'>{String(Boolean(previewHosted))}</div>
      <div data-testid='team-tabs-slot'>{tabsSlot}</div>
      <div data-testid='team-chat-layout'>{children}</div>
    </div>
  ),
}));

// TeamTabs probe: render the active assistants' names straight from the provider
// so the D2 member join is observable without the real dnd/pill subtree.
vi.mock('@/renderer/pages/team/components/TeamTabs', async () => {
  const ctx = await import('@/renderer/pages/team/hooks/TeamTabsContext');
  return {
    __esModule: true,
    default: () => {
      const { assistants } = ctx.useTeamTabs();
      return (
        <div data-testid='members-probe'>
          {assistants.map((a: { assistant_name: string }) => a.assistant_name).join(',')}
        </div>
      );
    },
  };
});

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({
  __esModule: true,
  default: () => <div />,
  useAcpWarmupStatus: () => undefined,
}));
vi.mock('@/renderer/components/agent/AcpRuntimeRestartButton', () => ({
  __esModule: true,
  useAcpRuntimeRestart: () => ({ restart: vi.fn(), restarting: false }),
  default: () => <div />,
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  __esModule: true,
  default: () => <div />,
}));
vi.mock('@/renderer/pages/team/components/TeamChatView', () => ({
  __esModule: true,
  default: ({ conversation: c }: { conversation: TChatConversation }) => <div data-testid={`chat-${c.id}`} />,
}));
vi.mock('@renderer/pages/conversation/components/ChatSlider.tsx', () => ({
  __esModule: true,
  default: () => <div />,
}));
vi.mock('@/renderer/pages/cron', () => ({ CronJobManager: () => <div /> }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {}, closePreviewIfScopeChanged: () => {} }),
}));

const setCurrentProjectMock = vi.fn();
const setCurrentConversationMock = vi.fn();
vi.mock('@/renderer/pages/conversation/explorer/currentProjectStore', () => ({
  setCurrentProject: (id: string | null) => setCurrentProjectMock(id),
}));
vi.mock('@/renderer/pages/conversation/explorer/currentConversationStore', () => ({
  setCurrentConversation: (id: string | null) => setCurrentConversationMock(id),
}));

import TeamPage from '@/renderer/pages/team/TeamPage';
import { resetEngagementSelectionForTest } from '@/renderer/pages/team/engagementSelectionStore';

function team(id = 'team-1'): TTeam {
  return {
    id,
    user_id: 'user-1',
    name: 'Bound Team',
    workspace: '/tmp/team',
    workspace_mode: 'shared',
    leader_assistant_id: 'leader-assistant',
    created_at: 1,
    updated_at: 1,
    project_id: null,
    assistants: [
      {
        slot_id: 'leader-slot',
        conversation_id: 'leader-conv',
        role: 'leader',
        assistant_backend: 'codex',
        assistant_name: 'Leader',
        status: 'idle',
        context_reset: { supported: false, availability: 'leader_not_targetable' },
      },
      {
        slot_id: 'member-slot',
        conversation_id: 'member-conv',
        role: 'teammate',
        assistant_backend: 'codex',
        assistant_name: 'Member',
        status: 'idle',
        context_reset: { supported: true, availability: 'ready' },
      },
    ],
  };
}

const engagement = {
  id: 'e1',
  team_id: 'team-1',
  project_id: 'proj-eng',
  workspace: '/ws-engagement',
  process: 'hierarchical',
  status: 'active',
  created_at: 5,
  updated_at: 5,
};

describe('TeamPage engagement wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngagementSelectionForTest();
    localStorage.clear();
    getConversationOrNullMock.mockImplementation(async (id: string) => ({
      id,
      type: 'acp',
      name: id,
      created_at: 1,
      updated_at: 1,
      extra: {},
    }));
    ensureSessionMock.mockResolvedValue(undefined);
  });

  it('binds project/workspace/conversation to the selected engagement and renders joined members', async () => {
    listEngagementsMock.mockResolvedValue([engagement]);
    listEngagementMembersMock.mockResolvedValue([
      {
        slot_id: 'eng-leader',
        template_slot: 'leader-slot',
        role: 'leader',
        conversation_id: 'eng-leader-conv',
        status: null,
      },
      {
        slot_id: 'eng-member',
        template_slot: 'member-slot',
        role: 'teammate',
        conversation_id: 'eng-member-conv',
        status: null,
      },
    ]);

    render(
      <MemoryRouter>
        <TeamPage team={team('team-engagement')} />
      </MemoryRouter>
    );

    // D2 join: members render with template names but engagement runtime ids.
    await waitFor(() => expect(screen.getByTestId('members-probe').textContent).toBe('Leader,Member'));
    // Explorer project rebinds to the engagement's project (legacy would be null).
    await waitFor(() => expect(setCurrentProjectMock).toHaveBeenCalledWith('proj-eng'));
    // Preview/file-panel scope + workspace follow the engagement's workspace.
    await waitFor(() => expect(screen.getByTestId('workspace-path').textContent).toBe('/ws-engagement'));
    expect(screen.getByTestId('preview-hosted').textContent).toBe('true');
    // The active column's conversation binding uses the engagement member's runtime id.
    await waitFor(() => expect(setCurrentConversationMock).toHaveBeenCalledWith('eng-leader-conv'));
  });

  it('leaves the legacy (no-engagement) path unchanged', async () => {
    listEngagementsMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <TeamPage team={team('team-legacy')} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('members-probe').textContent).toBe('Leader,Member'));
    // No engagement → project stays whatever the leader conversation yields (null here).
    await waitFor(() => expect(setCurrentProjectMock).toHaveBeenCalledWith(null));
    await waitFor(() => expect(screen.getByTestId('workspace-path').textContent).toBe('/tmp/team'));
    // Mirrors current behavior: without a bound project the explorer is not
    // pointed at any conversation.
    await waitFor(() => expect(setCurrentConversationMock).toHaveBeenCalledWith(null));
    expect(listEngagementMembersMock).not.toHaveBeenCalled();
  });
});
