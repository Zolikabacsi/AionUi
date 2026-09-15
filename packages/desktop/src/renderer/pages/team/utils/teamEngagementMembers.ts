/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamAssistant, TeamEngagementMember } from '@/common/types/team/teamTypes';

/**
 * Merge an engagement's runtime member rows onto the team's assistant templates
 * (Phase 5b, D2 — mirrors the backend `engagement_member_agents` concept).
 *
 * Metadata (name/role/backend/model/icon/context_reset) comes from the matching
 * template assistant (`template_slot == assistant.slot_id`); the runtime
 * `slot_id`/`conversation_id` come from the engagement member. Returns the
 * untouched `assistants` array for a legacy team (no engagement) or when the
 * engagement has no member rows / no member matches a template — so the team
 * page's default (team-scoped) rendering is preserved verbatim.
 */
export function joinEngagementMembers(
  assistants: TeamAssistant[],
  members: TeamEngagementMember[] | null | undefined
): TeamAssistant[] {
  if (!members || members.length === 0) return assistants;
  const templateBySlot = new Map(assistants.map((assistant) => [assistant.slot_id, assistant]));
  const joined = members
    .map((member) => {
      const template = templateBySlot.get(member.template_slot);
      return template ? { ...template, slot_id: member.slot_id, conversation_id: member.conversation_id } : null;
    })
    .filter((assistant): assistant is TeamAssistant => assistant !== null);
  return joined.length > 0 ? joined : assistants;
}
