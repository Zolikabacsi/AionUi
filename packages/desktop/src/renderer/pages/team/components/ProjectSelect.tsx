/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Select, Empty } from '@arco-design/web-react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { useTranslation } from 'react-i18next';

export type ProjectOption = {
  project_id: string;
  name: string;
  workspace?: string | null;
};

export type ProjectSelectProps = {
  value?: string | null;
  onChange?: (projectId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
};

/**
 * Project selector for project-agnostic teams.
 *
 * Lists all projects by calling the sidebar read model and filtering the
 * `project`-scope groups. This keeps the source-of-truth on the backend
 * without adding a dedicated list endpoint.
 */
const ProjectSelect: React.FC<ProjectSelectProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  allowClear = true,
  className,
}) => {
  const { t } = useTranslation();

  const { data, isLoading } = useSWR(['sidebar-projects'], async () => {
    const resp = await ipcBridge.sidebar.get.invoke({});
    const projects: ProjectOption[] = [];
    for (const group of resp.groups ?? []) {
      if (group.scope.type === 'project') {
        projects.push({
          project_id: group.scope.project_id,
          name: group.scope.name,
          workspace: group.scope.workspace ?? null,
        });
      }
    }
    return projects;
  });

  return (
    <Select
      className={className}
      placeholder={placeholder ?? t('team.create.selectProject', { defaultValue: 'Select project' })}
      value={value ?? undefined}
      disabled={disabled || isLoading}
      allowClear={allowClear}
      loading={isLoading}
      onChange={(v) => {
        if (!v) {
          onChange?.(null);
        } else {
          onChange?.(String(v));
        }
      }}
      showSearch
      filterOption={(input, option) =>
        String(option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
      }
      notFoundContent={isLoading ? null : <Empty description={t('team.create.noProjects', { defaultValue: 'No projects yet' })} />}
    >
      {(data ?? []).map((p) => (
        <Select.Option key={p.project_id} value={p.project_id}>
          {p.name}
        </Select.Option>
      ))}
    </Select>
  );
};

export default ProjectSelect;
