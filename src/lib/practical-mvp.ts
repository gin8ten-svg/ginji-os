import { classifyTask, isRoutineScheduled, shiftTokyoDate, tokyoDateKey, tokyoWeekday } from '@/lib/date-time';
import type { Priority, Task, TaskCategory, TaskStore } from '@/types/tasks';

export type TaskSort = 'due' | 'priority' | 'updated';

export interface TaskFilters {
  status: TaskCategory | 'all';
  priority: Priority | 'all';
  category: string;
  query: string;
  sort: TaskSort;
  today?: string;
}

export function isOverdueTask(task: Task, today = tokyoDateKey()): boolean {
  return classifyTask(task, today) === 'overdue';
}

export function compareTodayTasks(left: Task, right: Task, today = tokyoDateKey()): number {
  const rank = (task: Task) => classifyTask(task, today) === 'overdue' ? 0 : 1;
  return rank(left) - rank(right)
    || right.priority - left.priority
    || (left.dueAt ?? '').localeCompare(right.dueAt ?? '')
    || right.updatedAt.localeCompare(left.updatedAt);
}

export function todayDashboardTasks(tasks: Task[], today = tokyoDateKey()): Task[] {
  return tasks
    .filter((task) => !task.completedAt && ['overdue', 'today'].includes(classifyTask(task, today)))
    .sort((left, right) => compareTodayTasks(left, right, today));
}

export function filterAndSortTasks(tasks: Task[], filters: TaskFilters): Task[] {
  const today = filters.today ?? tokyoDateKey();
  const query = filters.query.trim().toLocaleLowerCase('ja');
  return tasks.filter((task) => {
    const statusMatches = filters.status === 'all' || classifyTask(task, today) === filters.status;
    const priorityMatches = filters.priority === 'all' || task.priority === filters.priority;
    const categoryMatches = filters.category === 'all' || task.category === filters.category;
    const queryMatches = !query || `${task.title} ${task.description} ${task.category}`.toLocaleLowerCase('ja').includes(query);
    return statusMatches && priorityMatches && categoryMatches && queryMatches;
  }).sort((left, right) => {
    if (filters.sort === 'priority') return right.priority - left.priority || right.updatedAt.localeCompare(left.updatedAt);
    if (filters.sort === 'updated') return right.updatedAt.localeCompare(left.updatedAt);
    return Number(left.dueAt === null) - Number(right.dueAt === null)
      || (left.dueAt ?? '').localeCompare(right.dueAt ?? '')
      || right.priority - left.priority;
  });
}

export function monthGrid(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = shiftTokyoDate(first, -tokyoWeekday(first));
  return Array.from({ length: 42 }, (_, index) => shiftTokyoDate(start, index));
}

export function monthShift(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export interface ReviewSummary {
  todayCompletedTasks: number;
  weekCompletedTasks: number;
  weekRoutineCompletions: number;
  routineRate: number;
  openTasks: number;
  overdueTasks: number;
  days: Array<{ date: string; taskCount: number; routineCount: number }>;
}

export function weekStart(dateKey: string): string {
  const weekday = tokyoWeekday(dateKey);
  return shiftTokyoDate(dateKey, -(weekday === 0 ? 6 : weekday - 1));
}

export function buildReviewSummary(store: TaskStore, today = tokyoDateKey()): ReviewSummary {
  const start = weekStart(today);
  const days = Array.from({ length: 7 }, (_, index) => shiftTokyoDate(start, index));
  const throughToday = days.filter((date) => date <= today);
  const completedDate = (task: Task) => task.completedAt ? tokyoDateKey(new Date(task.completedAt)) : null;
  const scheduledCount = throughToday.reduce((total, date) => total + store.routines.filter((routine) => isRoutineScheduled(routine, date)).length, 0);
  const daily = days.map((date) => ({
    date,
    taskCount: store.tasks.filter((task) => completedDate(task) === date).length,
    routineCount: store.routineCompletions.filter((completion) => completion.date === date).length,
  }));
  const weekRoutineCompletions = daily.reduce((total, day) => total + day.routineCount, 0);
  return {
    todayCompletedTasks: daily.find((day) => day.date === today)?.taskCount ?? 0,
    weekCompletedTasks: daily.reduce((total, day) => total + day.taskCount, 0),
    weekRoutineCompletions,
    routineRate: scheduledCount === 0 ? 0 : Math.min(100, Math.round((weekRoutineCompletions / scheduledCount) * 100)),
    openTasks: store.tasks.filter((task) => !task.completedAt).length,
    overdueTasks: store.tasks.filter((task) => isOverdueTask(task, today)).length,
    days: daily,
  };
}
