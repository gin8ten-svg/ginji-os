import { describe, expect, it } from 'vitest';
import { classifyTask, isRoutineScheduled, shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import type { Routine, Task } from '@/types/tasks';

const createdAt = '2026-07-14T00:00:00.000Z';

function task(dueAt: string | null): Task {
  return { id: 'task-1', title: 'Test', description: '', dueAt, priority: 3, estimatedMinutes: 30, remainingMinutes: 30, splittable: true, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt, updatedAt: createdAt, source: 'user' };
}

function routine(frequency: Routine['frequency']): Routine {
  return { id: 'routine-1', name: 'Test', description: '', frequency, estimatedMinutes: 30, priority: 3, category: '', availableStartTime: null, availableEndTime: null, isActive: true, createdAt, updatedAt: createdAt, source: 'user' };
}

describe('date-time', () => {
  it('Asia/Tokyoの日付境界を15:00 UTCで切り替える', () => {
    expect(tokyoDateKey(new Date('2026-07-14T14:59:59.999Z'))).toBe('2026-07-14');
    expect(tokyoDateKey(new Date('2026-07-14T15:00:00.000Z'))).toBe('2026-07-15');
  });

  it('dueAtなしをInboxへ分類する', () => expect(classifyTask(task(null), '2026-07-14')).toBe('inbox'));
  it('今日締切をTodayへ分類する', () => expect(classifyTask(task('2026-07-14T09:00:00.000Z'), '2026-07-14')).toBe('today'));
  it('期限超過をOverdueへ分類する', () => expect(classifyTask(task('2026-07-13T08:00:00.000Z'), '2026-07-14')).toBe('overdue'));
  it('将来締切をUpcomingへ分類する', () => expect(classifyTask(task('2026-07-15T08:00:00.000Z'), '2026-07-14')).toBe('upcoming'));
  it('毎日の有効なルーティンを対象にする', () => expect(isRoutineScheduled(routine({ type: 'daily' }), '2026-07-14')).toBe(true));
  it('曜日指定ルーティンを対象曜日だけ表示する', () => {
    const value = routine({ type: 'weekdays', weekdays: [2] });
    expect(isRoutineScheduled(value, '2026-07-14')).toBe(true);
    expect(isRoutineScheduled(value, '2026-07-15')).toBe(false);
  });
  it('weekdaysが空なら対象日にしない', () => expect(isRoutineScheduled(routine({ type: 'weekdays', weekdays: [] }), '2026-07-14')).toBe(false));
  it('月末をまたいで日付移動する', () => expect(shiftTokyoDate('2026-01-31', 1)).toBe('2026-02-01'));
  it('年末をまたいで日付移動する', () => expect(shiftTokyoDate('2026-12-31', 1)).toBe('2027-01-01'));
});
