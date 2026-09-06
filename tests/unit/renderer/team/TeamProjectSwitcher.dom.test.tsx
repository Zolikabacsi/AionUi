import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateProject = vi.fn(async (arg: unknown) => arg);

vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: { get: { invoke: vi.fn(async () => ({ groups: [] })) } },
    team: { updateProject: { invoke: (arg: unknown) => updateProject(arg) } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

vi.mock('swr', () => ({
  default: () => ({ data: [{ project_id: 'p1', name: 'Alpha' }], isLoading: false }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn() },
    Modal: { confirm: vi.fn() },
  };
});

// Replace the real selector with a trigger that always picks a fixed project.
vi.mock('@/renderer/pages/team/components/ProjectSelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button onClick={() => onChange('p9')}>select-p9</button>
  ),
}));

import { Message, Modal } from '@arco-design/web-react';
import TeamProjectSwitcher from '@/renderer/pages/team/components/TeamProjectSwitcher';
import type { TTeam } from '@/common/types/team/teamTypes';

const makeTeam = (project_id: string | null) => ({ id: 't1', project_id }) as TTeam;

describe('TeamProjectSwitcher', () => {
  beforeEach(() => {
    updateProject.mockClear();
    vi.mocked(Modal.confirm).mockClear();
    vi.mocked(Message.success).mockClear();
  });

  it('assigns a project without confirmation when the team has none', async () => {
    render(<TeamProjectSwitcher team={makeTeam(null)} />);
    fireEvent.click(screen.getByText('No project'));
    fireEvent.click(screen.getByText('select-p9'));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith({ id: 't1', project_id: 'p9' }));
    expect(Modal.confirm).not.toHaveBeenCalled();
    expect(Message.success).toHaveBeenCalled();
  });

  it('asks for confirmation before switching an already-assigned project', async () => {
    render(<TeamProjectSwitcher team={makeTeam('p1')} />);
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText('select-p9'));

    expect(Modal.confirm).toHaveBeenCalledTimes(1);
    expect(updateProject).not.toHaveBeenCalled();
  });
});
