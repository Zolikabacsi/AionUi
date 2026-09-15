/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEngagements = vi.fn(async () => [
  { id: 'e1', team_id: 't1', project_id: 'p1', status: 'active', created_at: 1, updated_at: 1 },
  { id: 'e2', team_id: 't1', project_id: 'p2', status: 'archived', created_at: 2, updated_at: 2 },
]);
const createEngagement = vi.fn(async () => ({
  id: 'e3',
  team_id: 't1',
  project_id: 'p9',
  status: 'active',
  created_at: 3,
  updated_at: 3,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      get: {
        invoke: vi.fn(async () => ({
          groups: [
            { scope: { type: 'project', project_id: 'p1', name: 'Alpha' } },
            { scope: { type: 'project', project_id: 'p2', name: 'Beta' } },
            { scope: { type: 'project', project_id: 'p9', name: 'Zeta' } },
          ],
        })),
      },
    },
    team: {
      listEngagements: { invoke: (arg: unknown) => listEngagements(arg) },
      createEngagement: { invoke: (arg: unknown) => createEngagement(arg) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

const mutate = vi.fn(async () => undefined);
vi.mock('swr', () => ({
  default: (key: unknown) => {
    if (Array.isArray(key) && key[0] === 'sidebar-projects') {
      return {
        data: [
          { project_id: 'p1', name: 'Alpha' },
          { project_id: 'p2', name: 'Beta' },
          { project_id: 'p9', name: 'Zeta' },
        ],
        isLoading: false,
      };
    }
    if (Array.isArray(key) && key[0] === 'team-engagements') {
      return {
        data: [
          { id: 'e1', team_id: 't1', project_id: 'p1', status: 'active', created_at: 1, updated_at: 1 },
          { id: 'e2', team_id: 't1', project_id: 'p2', status: 'archived', created_at: 2, updated_at: 2 },
        ],
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useSWRConfig: () => ({ mutate }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { success: vi.fn(), error: vi.fn() } };
});

// Stub ProjectSelect: a button that always picks project p9.
vi.mock('@/renderer/pages/team/components/ProjectSelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button onClick={() => onChange('p9')}>select-p9</button>
  ),
}));

import { Message } from '@arco-design/web-react';
import TeamEngagementSelector from '@/renderer/pages/team/components/TeamEngagementSelector';
import { getSelectedEngagement, resetEngagementSelectionForTest } from '@/renderer/pages/team/engagementSelectionStore';
import type { TTeam } from '@/common/types/team/teamTypes';

const team = { id: 't1', project_id: 'p1' } as TTeam;

describe('TeamEngagementSelector', () => {
  beforeEach(() => {
    resetEngagementSelectionForTest();
    localStorage.clear();
    listEngagements.mockClear();
    createEngagement.mockClear();
    mutate.mockClear();
    vi.mocked(Message.success).mockClear();
    vi.mocked(Message.error).mockClear();
  });

  it('lists engagements with their project names and selects one', async () => {
    const onSelect = vi.fn();
    render(<TeamEngagementSelector team={team} onSelect={onSelect} />);

    // open the dropdown
    fireEvent.click(await screen.findByText('Alpha'));

    fireEvent.click(await screen.findByText('Beta'));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'e2', project_id: 'p2' });
    expect(getSelectedEngagement('t1')).toBe('e2');
  });

  it('creates an engagement for a chosen project and selects the result', async () => {
    const onSelect = vi.fn();
    render(<TeamEngagementSelector team={team} onSelect={onSelect} />);

    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(await screen.findByText('New engagement…'));
    fireEvent.click(await screen.findByText('select-p9'));

    await waitFor(() => expect(createEngagement).toHaveBeenCalledWith({ team_id: 't1', project_id: 'p9' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'e3' })));
    expect(getSelectedEngagement('t1')).toBe('e3');
    // The create must refresh the SHARED engagements cache TeamPage reads from
    // (not just the selector's private state), or the page keeps the previous
    // project/workspace while the store points at the new engagement.
    expect(mutate).toHaveBeenCalledWith(['team-engagements', 't1']);
    expect(Message.success).toHaveBeenCalled();
  });

  it('surfaces a failure message when creation throws', async () => {
    createEngagement.mockRejectedValueOnce(new Error('boom'));
    render(<TeamEngagementSelector team={team} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(await screen.findByText('New engagement…'));
    fireEvent.click(await screen.findByText('select-p9'));

    await waitFor(() => expect(Message.error).toHaveBeenCalled());
  });
});
