import type { CategoryRow, RoutineCompletionRow, RoutineRow, TaskRow } from '@/types/database';
import type { Priority, Routine, RoutineCompletion, Task, Weekday } from '@/types/tasks';

function priority(value: number): Priority {
  if (value < 1 || value > 5 || !Number.isInteger(value)) throw new Error('DBのpriorityが不正です。');
  return value as Priority;
}

function weekdays(values: number[]): Weekday[] {
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 6)) {
    throw new Error('DBのweekdaysが不正です。');
  }
  return values as Weekday[];
}

export function taskFromRow(row: TaskRow, categories: ReadonlyMap<string, string>): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    dueAt: row.due_at,
    priority: priority(row.priority),
    estimatedMinutes: row.estimated_minutes,
    category: row.category_id ? categories.get(row.category_id) ?? '' : '',
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'user',
  };
}

export function routineFromRow(row: RoutineRow, categories: ReadonlyMap<string, string>): Routine {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    frequency: row.frequency_type === 'daily' ? { type: 'daily' } : { type: 'weekdays', weekdays: weekdays(row.weekdays) },
    estimatedMinutes: row.estimated_minutes,
    priority: priority(row.priority),
    category: row.category_id ? categories.get(row.category_id) ?? '' : '',
    availableStartTime: row.available_start_time?.slice(0, 5) ?? null,
    availableEndTime: row.available_end_time?.slice(0, 5) ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: 'user',
  };
}

export function completionFromRow(row: RoutineCompletionRow): RoutineCompletion {
  return { routineId: row.routine_id, date: row.target_date, completedAt: row.completed_at };
}

export function categoryMap(rows: CategoryRow[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.name]));
}
