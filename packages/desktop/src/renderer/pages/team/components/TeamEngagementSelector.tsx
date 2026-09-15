/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Divider, Dropdown, Menu, Message, Typography } from '@arco-design/web-react';
import { Down, FolderOpen } from '@icon-park/react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import ProjectSelect from './ProjectSelect';
import {
  resolveEngagementSelection,
  setSelectedEngagement,
  useSelectedEngagementId,
} from '../engagementSelectionStore';
import type { TTeam, TeamEngagement } from '@/common/types/team/teamTypes';

export type TeamEngagementSelectorProps = {
  team: TTeam;
  /** Emitted whenever a concrete engagement becomes the active selection. */
  onSelect?: (engagement: TeamEngagement) => void;
};

/**
 * Engagement selector for a team (Phase 5b, D1).
 *
 * Lists the team's engagements (resolved to their sidebar project name), lets
 * the user switch between them (persisted + emitted via `onSelect`), and — via
 * "New engagement…" — pick an existing sidebar project to create-or-select an
 * engagement for. Creating reuses the backend find-or-create semantics of
 * `POST /api/teams/:id/engagements`.
 *
 * This component only owns list / create / select. Archive and process
 * switching are wired at the TeamPage level in a later task.
 */
const TeamEngagementSelector: React.FC<TeamEngagementSelectorProps> = ({ team, onSelect }) => {
  const { t } = useTranslation();
  const [engagements, setEngagements] = useState<TeamEngagement[]>([]);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const selectedId = useSelectedEngagementId(team.id);

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
  const nameFor = useCallback(
    (projectId: string) => projects?.find((p) => p.project_id === projectId)?.name ?? projectId,
    [projects]
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await ipcBridge.team.listEngagements.invoke({ team_id: team.id });
        if (alive) setEngagements(list);
      } catch (err) {
        console.error(err);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [team.id]);

  const effectiveId = selectedId ?? resolveEngagementSelection(team.id, engagements, team.project_id ?? null);
  const current = engagements.find((e) => e.id === effectiveId);
  const label = current
    ? nameFor(current.project_id)
    : t('team.engagement.unassigned', { defaultValue: 'No engagement' });

  const select = useCallback(
    (engagement: TeamEngagement) => {
      setSelectedEngagement(team.id, engagement.id);
      onSelect?.(engagement);
    },
    [team.id, onSelect]
  );

  const handleNew = useCallback(
    async (projectId: string | null) => {
      setCreating(false);
      if (!projectId) return;
      try {
        setPending(true);
        const created = await ipcBridge.team.createEngagement.invoke({ team_id: team.id, project_id: projectId });
        setEngagements((prev) => (prev.some((e) => e.id === created.id) ? prev : [...prev, created]));
        select(created);
        Message.success(t('team.engagement.created', { defaultValue: 'Engagement created' }));
      } catch (err) {
        Message.error(t('team.engagement.createFailed', { defaultValue: 'Failed to create engagement' }));
        console.error(err);
      } finally {
        setPending(false);
      }
    },
    [team.id, select, t]
  );

  const droplist = (
    <div className='p-4px' style={{ minWidth: 260 }}>
      <Menu
        onClickMenuItem={(key) => {
          const engagement = engagements.find((e) => e.id === key);
          if (engagement) select(engagement);
        }}
      >
        {engagements.length === 0 ? (
          <Menu.Item key='__empty__' disabled>
            <Typography.Text type='secondary'>
              {t('team.engagement.empty', { defaultValue: 'No engagements yet' })}
            </Typography.Text>
          </Menu.Item>
        ) : (
          engagements.map((e) => (
            <Menu.Item key={e.id}>
              <span>{nameFor(e.project_id)}</span>
              {e.status === 'archived' ? (
                <Typography.Text type='secondary' className='ml-8px'>
                  {t('team.engagement.archived', { defaultValue: 'Archived' })}
                </Typography.Text>
              ) : null}
            </Menu.Item>
          ))
        )}
      </Menu>
      <Divider style={{ margin: '4px 0' }} />
      {creating ? (
        <div className='p-8px'>
          <ProjectSelect
            value={null}
            onChange={(v) => void handleNew(v)}
            placeholder={t('team.engagement.selectProject', { defaultValue: 'Select a project' })}
            allowClear={false}
            className='w-full'
          />
        </div>
      ) : (
        <Button type='text' size='mini' className='w-full' onClick={() => setCreating(true)}>
          {t('team.engagement.new', { defaultValue: 'New engagement…' })}
        </Button>
      )}
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

export default TeamEngagementSelector;
