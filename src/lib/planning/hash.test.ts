import { describe, expect, it } from 'vitest';
import { canonicalizeForTest, planningInputHash } from '@/lib/planning/hash';
import { createPlanningWindow } from '@/lib/planner/engine';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { Task } from '@/types/tasks';

const now = new Date('2026-07-15T00:00:00.000Z');
const task: Task = { id: 'task-a', title: 'secret title', description: 'secret description', dueAt: '2026-07-16T09:00:00.000Z', priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: true, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user' };
const event: ExternalCalendarEvent = { id: 'event-a', calendarId: 'primary', title: 'private meeting', start: '2026-07-15T03:00:00.000Z', end: '2026-07-15T04:00:00.000Z', allDay: false, status: 'confirmed', htmlLink: null, colorId: null };
const input = () => ({ window: createPlanningWindow(now), now, tasks: [task], routines: [], completions: [], events: [event] });

describe('planning input hash', () => {
  it('同じ入力とkey順違いを同一canonical値にする', () => {
    expect(planningInputHash(input())).toBe(planningInputHash(input()));
    expect(canonicalizeForTest({ b: 2, a: 1 })).toBe(canonicalizeForTest({ a: 1, b: 2 }));
  });
  it('配列順に依存しない', () => {
    const second = { ...task, id: 'task-b' };
    expect(planningInputHash({ ...input(), tasks: [task, second] })).toBe(planningInputHash({ ...input(), tasks: [second, task] }));
  });
  it('Task変更で変化する', () => expect(planningInputHash(input())).not.toBe(planningInputHash({ ...input(), tasks: [{ ...task, remainingMinutes: 35 }] })));
  it('Google busy変更で変化する', () => expect(planningInputHash(input())).not.toBe(planningInputHash({ ...input(), events: [{ ...event, end: '2026-07-15T04:30:00.000Z' }] })));
  it('タイトル・description・token相当の非計画情報を含めない', () => {
    expect(planningInputHash(input())).toBe(planningInputHash({ ...input(), tasks: [{ ...task, title: 'changed', description: 'token' }], events: [{ ...event, title: 'changed' }] }));
  });
});
