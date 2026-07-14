import { describe, expect, it } from 'vitest';
import { completionFromRow, routineFromRow, taskFromRow } from './converters';
import type { RoutineCompletionRow, RoutineRow, TaskRow } from '@/types/database';

const timestamps = { created_at: '2026-07-15T00:00:00.000Z', updated_at: '2026-07-15T01:00:00.000Z' };

describe('Supabase row converters', () => {
  it('task行をアプリ型へ変換する', () => {
    const row: TaskRow = { id: 'task-id', user_id: 'user-id', title: 'Task', description: null, status: 'inbox', priority: 4, due_at: null, estimated_minutes: 30, remaining_minutes: 30, splittable: true, minimum_block_minutes: 25, category_id: 'category-id', completed_at: null, ...timestamps };
    expect(taskFromRow(row, new Map([['category-id', '仕事']]))).toMatchObject({ id: 'task-id', description: '', priority: 4, category: '仕事', remainingMinutes: 30, splittable: true, minimumBlockMinutes: 25, source: 'user' });
  });

  it('曜日ルーティンとtime型を変換する', () => {
    const row: RoutineRow = { id: 'routine-id', user_id: 'user-id', name: 'Routine', description: null, frequency_type: 'weekdays', weekdays: [1, 3, 5], estimated_minutes: 20, priority: 3, category_id: null, available_start_time: '07:00:00', available_end_time: '08:00:00', is_active: true, ...timestamps };
    expect(routineFromRow(row, new Map())).toMatchObject({ frequency: { type: 'weekdays', weekdays: [1, 3, 5] }, availableStartTime: '07:00', availableEndTime: '08:00' });
  });

  it('不正なDB priorityを拒否する', () => {
    const row: TaskRow = { id: 'task-id', user_id: 'user-id', title: 'Task', description: null, status: 'inbox', priority: 6, due_at: null, estimated_minutes: 30, remaining_minutes: 30, splittable: true, minimum_block_minutes: 25, category_id: null, completed_at: null, ...timestamps };
    expect(() => taskFromRow(row, new Map())).toThrow('priority');
  });

  it('実行履歴の日付を維持する', () => {
    const row: RoutineCompletionRow = { id: 'completion-id', user_id: 'user-id', routine_id: 'routine-id', target_date: '2026-07-15', completed_at: '2026-07-15T03:00:00.000Z', ...timestamps };
    expect(completionFromRow(row)).toEqual({ routineId: 'routine-id', date: '2026-07-15', completedAt: '2026-07-15T03:00:00.000Z' });
  });
});
