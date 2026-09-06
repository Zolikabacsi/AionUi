/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { Button, Dropdown, Modal, Message } from '@arco-design/web-react';
import { Down, FolderOpen } from '@icon-park/react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import ProjectSelect from './ProjectSelect';
import type { TTeam } from '@/common/types/team/teamTypes';

export type TeamProjectSwitcherProps = {
  team: TTeam;
};

/**
 * Project switcher for project-agnostic teams.
 *
 * Shows the current project name (or a hint to assign one). Switching
 * confirms with the user (resets context) and calls the backend
 * `PATCH /api/teams/:id/project` endpoint.
 */
const TeamProjectSwitcher: React.FC<TeamProjectSwitcherProps> = ({ team }) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);

  // Reuse the sidebar read model to resolve current project name + workspace.
  const { data: projects } = useSWR(['sidebar-projects'], async () => {
    const resp = await ipcBridge.sidebar.get.invoke({});
    const list: { project_id: string; name: string }[] = [];
    for (const group of resp.groups ?? []) {
      if (group.scope.type === 'project') {
        list.push({ project_id: group.scope.project_id, name: group.scope.name });
      }
    }
    return list;
  });

  const current = projects?.find((p) => p.project_id === team.project_id);
  const label = current?.name ?? team.project_id ?? t('team.project.unassigned', { defaultValue: 'No project' });

  const handleSwitch = async (newProjectId: string | null) => {
    if (!team.project_id) {
      // Initial assignment: no confirmation, no reset needed.
      try {
        setPending(true);
        const updated = await ipcBridge.team.updateProject.invoke({
          id: team.id,
          project_id: newProjectId ?? '',
        });
        await mutate(`team/${team.id}`);
        await mutate((key) => typeof key === 'string' && key.startsWith('team-conversation'));
        Message.success(t('team.project.assigned', { defaultValue: 'Project assigned' }));
        void updated;
      } catch (err) {
        Message.error(t('team.project.assignFailed', { defaultValue: 'Failed to assign project' }));
        console.error(err);
      } finally {
        setPending(false);
      }
      return;
    }

    if (newProjectId === team.project_id) {
      return;
    }

    Modal.confirm({
      title: t('team.project.switchTitle', { defaultValue: 'Switch project?' }),
      content: t('team.project.switchConfirm', {
        defaultValue:
          'Switching the team project will reset each teammate conversation context. This cannot be undone.',
      }),
      okText: t('team.project.switch', { defaultValue: 'Switch project' }),
      cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
      onOk: async () => {
        try {
          setPending(true);
          await ipcBridge.team.updateProject.invoke({
            id: team.id,
            project_id: newProjectId ?? '',
          });
          await mutate(`team/${team.id}`);
          await mutate((key) => typeof key === 'string' && key.startsWith('team-conversation'));
          Message.success(t('team.project.switched', { defaultValue: 'Project switched' }));
        } catch (err) {
          Message.error(t('team.project.switchFailed', { defaultValue: 'Failed to switch project' }));
          console.error(err);
        } finally {
          setPending(false);
        }
      },
    });
  };

  const droplist = (
    <div className='p-8px' style={{ minWidth: 260 }}>
      <ProjectSelect
        value={team.project_id ?? null}
        onChange={(v) => handleSwitch(v)}
        placeholder={t('team.project.assignProject', { defaultValue: 'Assign a project' })}
        allowClear={false}
        className='w-full'
      />
    </div>
  );

  return (
    <Dropdown trigger='click' droplist={droplist} disabled={pending}>
      <Button type='text' size='mini' loading={pending} className='flex items-center gap-6px !px-10px'>
        <FolderOpen theme='outline' size={14} fill='currentColor' />
        <span>{label}</span>
        <Down theme='outline' size={12} fill='currentColor' />
      </Button>
    </Dropdown>
  );
};

export default TeamProjectSwitcher;
