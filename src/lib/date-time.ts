import type { Routine, Task, TaskCategory, Weekday } from '@/types/tasks';

export const APP_TIME_ZONE = 'Asia/Tokyo';

function dateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: value('year'), month: value('month'), day: value('day') };
}
export function tokyoDateKey(date = new Date()): string {
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
}

export function shiftTokyoDate(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T12:00:00+09:00`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return tokyoDateKey(shifted);
}

export function tokyoLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isoToTokyoLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const { year, month, day } = dateParts(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${year}-${month}-${day}T${time}`;
}

export function formatDueAt(value: string | null): string {
  if (!value) return '締切なし';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: APP_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function classifyTask(task: Task, today = tokyoDateKey()): TaskCategory {
  if (task.completedAt) return 'completed';
  if (!task.dueAt) return 'inbox';
  const dueDate = tokyoDateKey(new Date(task.dueAt));
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

export function tokyoWeekday(dateKey = tokyoDateKey()): Weekday {
  return new Date(`${dateKey}T12:00:00+09:00`).getUTCDay() as Weekday;
}

export function isRoutineScheduled(routine: Routine, dateKey = tokyoDateKey()): boolean {
  if (!routine.isActive) return false;
  return routine.frequency.type === 'daily' || routine.frequency.weekdays.includes(tokyoWeekday(dateKey));
}
