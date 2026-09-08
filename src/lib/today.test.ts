import { describe, expect, it } from 'vitest';
import { buildTodayView } from '@/lib/today';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { Routine, Task } from '@/types/tasks';

const TODAY = '2026-07-15';
const NOW = new Date('2026-07-15T04:00:00.000Z'); // 13:00 Asia/Tokyo

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-1', title: 'タスク', description: '', dueAt: `${TODAY}T23:59:00+09:00`, priority: 3,
    estimatedMinutes: 60, remainingMinutes: 60, splittable: true, minimumBlockMinutes: 25,
    category: 'study', completedAt: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    source: 'user', ...overrides,
  };
}

function routine(overrides: Partial<Routine>): Routine {
  return {
    id: 'routine-1', name: 'ルーティン', description: '', frequency: { type: 'daily' }, estimatedMinutes: 20,
    priority: 3, category: 'health', availableStartTime: null, availableEndTime: null, isActive: true,
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user', ...overrides,
  };
}

function event(overrides: Partial<ExternalCalendarEvent>): ExternalCalendarEvent {
  return {
    id: 'evt-1', calendarId: 'primary', title: '会議', start: `${TODAY}T05:00:00.000Z`, end: `${TODAY}T06:00:00.000Z`,
    allDay: false, status: 'confirmed', htmlLink: null, colorId: null, ...overrides,
  };
}

const base = { now: NOW, today: TODAY, tasks: [], routines: [], completions: [], events: [] };

describe('buildTodayView', () => {
  it('進行中の固定予定を currentEvent にする', () => {
    const view = buildTodayView({ ...base, events: [event({ start: `${TODAY}T03:30:00.000Z`, end: `${TODAY}T04:30:00.000Z` })] });
    expect(view.currentEvent?.state).toBe('now');
    expect(view.nextEvent).toBeNull();
  });

  it('次に始まる固定予定を nextEvent にし、終わった予定は除外する', () => {
    const view = buildTodayView({
      ...base,
      events: [
        event({ id: 'past', start: `${TODAY}T01:00:00.000Z`, end: `${TODAY}T02:00:00.000Z` }),
        event({ id: 'soon', start: `${TODAY}T05:00:00.000Z`, end: `${TODAY}T06:00:00.000Z` }),
      ],
    });
    expect(view.currentEvent).toBeNull();
    expect(view.nextEvent?.id).toBe('primary:soon');
    expect(view.timeline.map((item) => item.id)).toEqual(['primary:soon']);
  });

  it('終日予定は timeline ではなく allDayEvents に入れる', () => {
    const view = buildTodayView({ ...base, events: [event({ id: 'holiday', allDay: true, title: '祝日' })] });
    expect(view.timeline).toHaveLength(0);
    expect(view.allDayEvents).toEqual([{ id: 'primary:holiday', title: '祝日', htmlLink: null }]);
  });

  it('今日締切タスクと今日のルーティンから進捗率を出す', () => {
    const view = buildTodayView({
      ...base,
      tasks: [task({ id: 'a', completedAt: `${TODAY}T02:00:00.000Z` }), task({ id: 'b' })],
      routines: [routine({ id: 'r1' })],
    });
    expect(view.progress).toMatchObject({ doneCount: 1, totalCount: 3 });
    expect(view.progress.percent).toBe(33);
    expect(view.progress.remainingMinutes).toBe(80); // 60 (task b) + 20 (routine r1)
  });

  it('期限超過タスクも進捗の母数に入れる', () => {
    const view = buildTodayView({ ...base, tasks: [task({ id: 'od', dueAt: '2026-07-10T09:00:00+09:00' })] });
    expect(view.progress).toMatchObject({ doneCount: 0, totalCount: 1, remainingMinutes: 60 });
  });

  it('対象が無ければ進捗率は0', () => {
    expect(buildTodayView(base).progress).toEqual({ doneCount: 0, totalCount: 0, percent: 0, remainingMinutes: 0 });
  });

  it('進行中の予定が無ければ最優先タスクを suggestion にする', () => {
    const view = buildTodayView({
      ...base,
      tasks: [task({ id: 'low', priority: 1, dueAt: `${TODAY}T23:00:00+09:00` }), task({ id: 'overdue', dueAt: '2026-07-10T09:00:00+09:00' })],
    });
    expect(view.suggestion).toMatchObject({ kind: 'task', id: 'overdue', reason: '期限超過' });
  });

  it('タスクが無ければ未完了ルーティンを suggestion にする', () => {
    const view = buildTodayView({ ...base, routines: [routine({ id: 'r1', priority: 2 }), routine({ id: 'r2', priority: 5 })] });
    expect(view.suggestion).toMatchObject({ kind: 'routine', id: 'r2', reason: '今日のルーティン' });
  });

  it('進行中の予定があるときは suggestion を出さない', () => {
    const view = buildTodayView({
      ...base,
      tasks: [task({ id: 'x' })],
      events: [event({ start: `${TODAY}T03:30:00.000Z`, end: `${TODAY}T04:30:00.000Z` })],
    });
    expect(view.suggestion).toBeNull();
  });
});
