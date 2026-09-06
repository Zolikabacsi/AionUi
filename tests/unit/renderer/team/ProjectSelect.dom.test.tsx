import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: { get: { invoke: vi.fn(async () => ({ groups: [] })) } },
  },
}));

vi.mock('swr', () => ({
  default: () => ({
    data: [
      { project_id: 'p1', name: 'Alpha', workspace: null },
      { project_id: 'p2', name: 'Beta', workspace: null },
    ],
    isLoading: false,
  }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

import ProjectSelect from '@/renderer/pages/team/components/ProjectSelect';

describe('ProjectSelect', () => {
  it('renders the selected project name in the trigger', () => {
    render(<ProjectSelect value='p1' />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('maps a different value to its project label', () => {
    render(<ProjectSelect value='p2' />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
