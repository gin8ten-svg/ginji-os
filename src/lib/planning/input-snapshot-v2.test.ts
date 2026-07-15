import { describe, expect, it } from 'vitest';
import { createPlanningWindow } from '@/lib/planner/engine';
import { planningInputHash } from '@/lib/planning/hash';
import { buildPlanningInputSnapshotV2, canonicalPlanningTitle, hashPlanningInputSnapshotV2, PLANNING_SNAPSHOT_MAX_ENTITIES, validatePlanningInputSnapshotV2 } from '@/lib/planning/input-snapshot-v2';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { Routine, Task } from '@/types/tasks';

const now = new Date('2026-07-15T00:00:00.000Z');
const task: Task = { id: 'task-a', title: 'Task title', description: 'must not persist', dueAt: '2026-07-16T09:00:00.000Z', priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: true, minimumBlockMinutes: 25, category: 'private', completedAt: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user' };
const routine: Routine = { id: 'routine-a', name: 'Routine title', description: 'must not persist', frequency: { type: 'weekdays', weekdays: [5, 1, 3] }, estimatedMinutes: 30, priority: 2, category: 'private', availableStartTime: '08:00', availableEndTime: '10:00', isActive: true, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user' };
const event = (id: string, start: string, end: string): ExternalCalendarEvent => ({ id, calendarId: 'private-calendar', title: 'private event', start, end, allDay: false, status: 'confirmed', htmlLink: null, colorId: null });
const input = (overrides: Partial<Parameters<typeof buildPlanningInputSnapshotV2>[0]> = {}) => ({ window: createPlanningWindow(now), now, tasks: [task], routines: [routine], completions: [], events: [event('event-a', '2026-07-15T03:00:00.000Z', '2026-07-15T04:00:00.000Z')], ...overrides });

describe('planning input snapshot v2', () => {
  it('Task titleだけの変更でupdatedAtが同じでもhashが変わる', () => {
    const first = buildPlanningInputSnapshotV2(input()); const second = buildPlanningInputSnapshotV2(input({ tasks: [{ ...task, title: 'Changed', updatedAt: task.updatedAt }] }));
    expect(hashPlanningInputSnapshotV2(first)).not.toBe(hashPlanningInputSnapshotV2(second));
  });
  it('Routine titleだけの変更でupdatedAtが同じでもhashが変わる', () => {
    const first = buildPlanningInputSnapshotV2(input()); const second = buildPlanningInputSnapshotV2(input({ routines: [{ ...routine, name: 'Changed', updatedAt: routine.updatedAt }] }));
    expect(hashPlanningInputSnapshotV2(first)).not.toBe(hashPlanningInputSnapshotV2(second));
  });
  it('canonical titleが同じならhashも同じ', () => {
    const composed = 'é'; const decomposed = 'e\u0301';
    const first = buildPlanningInputSnapshotV2(input({ tasks: [{ ...task, title: ` ${composed} ` }] })); const second = buildPlanningInputSnapshotV2(input({ tasks: [{ ...task, title: decomposed }] }));
    expect(hashPlanningInputSnapshotV2(first)).toBe(hashPlanningInputSnapshotV2(second));
  });
  it('制御文字除去・trim・fallback・長さ上限が決定論的', () => {
    expect(canonicalPlanningTitle('\u0000 title\n', 'task')).toBe('title');
    expect(canonicalPlanningTitle('\u0000\n', 'task')).toBe('名称未設定のタスク');
    expect(canonicalPlanningTitle('', 'routine')).toBe('名称未設定のルーティン');
    expect([...canonicalPlanningTitle('a'.repeat(250), 'task')]).toHaveLength(200);
  });
  it('Task/Routine/busyの入力順だけではhashが変わらない', () => {
    const taskB = { ...task, id: 'task-b' }; const routineB = { ...routine, id: 'routine-b' };
    const eventA = event('a', '2026-07-15T05:00:00.000Z', '2026-07-15T06:00:00.000Z'); const eventB = event('b', '2026-07-15T03:00:00.000Z', '2026-07-15T04:00:00.000Z');
    const first = buildPlanningInputSnapshotV2(input({ tasks: [task, taskB], routines: [routine, routineB], events: [eventA, eventB] }));
    const second = buildPlanningInputSnapshotV2(input({ tasks: [taskB, task], routines: [routineB, routine], events: [eventB, eventA] }));
    expect(hashPlanningInputSnapshotV2(first)).toBe(hashPlanningInputSnapshotV2(second));
  });
  it('既存Planning field変更でhashが変わる', () => {
    const first = buildPlanningInputSnapshotV2(input()); const second = buildPlanningInputSnapshotV2(input({ tasks: [{ ...task, remainingMinutes: 25 }] }));
    expect(hashPlanningInputSnapshotV2(first)).not.toBe(hashPlanningInputSnapshotV2(second));
  });
  it('V1 hashとschemaVersionでversion分離される', () => {
    const snapshot = buildPlanningInputSnapshotV2(input());
    expect(hashPlanningInputSnapshotV2(snapshot)).not.toBe(planningInputHash(input()));
    expect(hashPlanningInputSnapshotV2(snapshot)).not.toBe(hashPlanningInputSnapshotV2({ ...snapshot, schemaVersion: 'planning-input-v3' } as never));
  });
  it('description/category/Google識別子やtitleを保存しない', () => {
    const serialized = JSON.stringify(buildPlanningInputSnapshotV2(input()));
    expect(serialized).not.toMatch(/must not persist|private-calendar|private event|description|category|calendarId|event-a/);
  });
  it('自己整合するsnapshotだけを受理', () => expect(validatePlanningInputSnapshotV2(buildPlanningInputSnapshotV2(input()))).toBe(true));
  it('forbidden field、重複entity、過大entityを拒否', () => {
    const snapshot = buildPlanningInputSnapshotV2(input());
    expect(validatePlanningInputSnapshotV2({ ...snapshot, token: 'secret' })).toBe(false);
    expect(validatePlanningInputSnapshotV2({ ...snapshot, tasks: [...snapshot.tasks, snapshot.tasks[0]] })).toBe(false);
    expect(validatePlanningInputSnapshotV2({ ...snapshot, tasks: Array.from({ length: PLANNING_SNAPSHOT_MAX_ENTITIES + 1 }, (_, index) => ({ ...snapshot.tasks[0], id: `task-${index}` })) })).toBe(false);
  });
});
