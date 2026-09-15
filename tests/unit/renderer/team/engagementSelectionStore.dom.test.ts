/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSelectedEngagement,
  resolveEngagementSelection,
  setSelectedEngagement,
  subscribeEngagementSelection,
  resetEngagementSelectionForTest,
} from '@/renderer/pages/team/engagementSelectionStore';
import type { TeamEngagement } from '@/common/types/team/teamTypes';

const eng = (id: string, project_id: string, status: 'active' | 'archived', created_at: number): TeamEngagement =>
  ({ id, team_id: 't1', project_id, status, created_at, updated_at: created_at }) as TeamEngagement;

describe('engagementSelectionStore', () => {
  beforeEach(() => resetEngagementSelectionForTest());
  afterEach(() => localStorage.clear());

  it('persists and returns a stored selection per team', () => {
    expect(getSelectedEngagement('t1')).toBeNull();
    setSelectedEngagement('t1', 'e7');
    expect(getSelectedEngagement('t1')).toBe('e7');
    expect(localStorage.getItem('team-engagement-t1')).toBe('e7');
    // separate teams are independent
    setSelectedEngagement('t2', 'e9');
    expect(getSelectedEngagement('t1')).toBe('e7');
    expect(getSelectedEngagement('t2')).toBe('e9');
  });

  it('notifies subscribers on change', () => {
    let hits = 0;
    const off = subscribeEngagementSelection('t1', () => {
      hits += 1;
    });
    setSelectedEngagement('t1', 'e7');
    expect(hits).toBe(1);
    setSelectedEngagement('t1', 'e7'); // unchanged → no notify
    expect(hits).toBe(1);
    off();
    setSelectedEngagement('t1', 'e8');
    expect(hits).toBe(1);
  });

  it('defaults to the engagement whose project matches the team (D3)', () => {
    const engagements = [eng('e1', 'pA', 'active', 1), eng('e2', 'pB', 'active', 2)];
    expect(resolveEngagementSelection('t1', engagements, 'pB')).toBe('e2');
  });

  it('falls back to newest active when no project match', () => {
    const engagements = [eng('e1', 'pA', 'active', 1), eng('e3', 'pC', 'active', 9), eng('e2', 'pB', 'archived', 50)];
    expect(resolveEngagementSelection('t1', engagements, null)).toBe('e3');
  });

  it('stored selection wins when still present in the list', () => {
    const engagements = [eng('e1', 'pA', 'active', 1), eng('e2', 'pB', 'active', 2)];
    setSelectedEngagement('t1', 'e1');
    expect(resolveEngagementSelection('t1', engagements, 'pB')).toBe('e1');
  });

  it('ignores a stored id that is no longer in the list', () => {
    const engagements = [eng('e2', 'pB', 'active', 2)];
    setSelectedEngagement('t1', 'gone');
    expect(resolveEngagementSelection('t1', engagements, 'pB')).toBe('e2');
  });

  it('resolves to null when there are no engagements (legacy team)', () => {
    expect(resolveEngagementSelection('t1', [], 'pA')).toBeNull();
  });
});
