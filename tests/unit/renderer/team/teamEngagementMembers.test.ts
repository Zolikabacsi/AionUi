/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { joinEngagementMembers } from '@/renderer/pages/team/utils/teamEngagementMembers';
import type { TeamAssistant, TeamEngagementMember } from '@/common/types/team/teamTypes';

const assistant = (overrides: Partial<TeamAssistant>): TeamAssistant => ({
  slot_id: 'tpl-1',
  conversation_id: 'tpl-conv',
  role: 'teammate',
  assistant_backend: 'codex',
  assistant_name: 'Coder',
  status: 'idle',
  model: 'gpt-x',
  icon: 'coder.svg',
  context_reset: { supported: true, availability: 'ready' },
  ...overrides,
});

const member = (overrides: Partial<TeamEngagementMember>): TeamEngagementMember => ({
  slot_id: 'eng-1',
  template_slot: 'tpl-1',
  role: 'teammate',
  conversation_id: 'eng-conv',
  status: null,
  ...overrides,
});

describe('joinEngagementMembers', () => {
  it('takes template metadata from the assistant and runtime ids from the engagement member', () => {
    const joined = joinEngagementMembers([assistant({ slot_id: 'tpl-1' })], [member({ template_slot: 'tpl-1' })]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      slot_id: 'eng-1',
      conversation_id: 'eng-conv',
      assistant_name: 'Coder',
      assistant_backend: 'codex',
      model: 'gpt-x',
      icon: 'coder.svg',
      role: 'teammate',
    });
    expect(joined[0].context_reset).toEqual({ supported: true, availability: 'ready' });
  });

  it('drops engagement members with no matching template slot', () => {
    const joined = joinEngagementMembers(
      [assistant({ slot_id: 'tpl-1' })],
      [member({ template_slot: 'tpl-1', slot_id: 'eng-1' }), member({ template_slot: 'ghost', slot_id: 'eng-2' })]
    );
    expect(joined.map((a) => a.slot_id)).toEqual(['eng-1']);
  });

  it('falls back to the team assistants when there are no engagement members', () => {
    const assistants = [assistant({ slot_id: 'tpl-1' })];
    expect(joinEngagementMembers(assistants, [])).toBe(assistants);
    expect(joinEngagementMembers(assistants, null)).toBe(assistants);
  });

  it('falls back to the team assistants when no member matches any template', () => {
    const assistants = [assistant({ slot_id: 'tpl-1' })];
    expect(joinEngagementMembers(assistants, [member({ template_slot: 'ghost' })])).toBe(assistants);
  });
});
