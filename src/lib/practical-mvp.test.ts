import { describe, expect, it } from 'vitest';
import { buildReviewSummary, filterAndSortTasks, monthGrid, monthShift, todayDashboardTasks } from './practical-mvp';
import type { Routine, Task, TaskStore } from '@/types/tasks';

const base = '2026-07-15T00:00:00.000Z';
const task = (id: string, dueAt: string | null, priority: Task['priority'] = 3, completedAt: string | null = null): Task => ({ id, title: id, description: '', dueAt, priority, estimatedMinutes: 30, category: priority === 5 ? '重要' : '通常', completedAt, createdAt: base, updatedAt: base, source: 'user' });
const routine: Routine = { id: 'routine', name: '毎日', description: '', frequency: { type: 'daily' }, estimatedMinutes: 10, priority: 3, category: '生活', availableStartTime: null, availableEndTime: null, isActive: true, createdAt: base, updatedAt: base, source: 'user' };

describe('practical MVP selectors', () => {
  it('Todayは期限超過、今日、高優先度の順に並べる', () => {
    const values = [task('today-low', '2026-07-15T09:00:00.000Z', 1), task('overdue', '2026-07-13T09:00:00.000Z', 1), task('today-high', '2026-07-15T08:00:00.000Z', 5)];
    expect(todayDashboardTasks(values, '2026-07-15').map((item) => item.id)).toEqual(['overdue', 'today-high', 'today-low']);
  });

  it('status・priority・category・keywordで絞り込む', () => {
    const values = [task('重要な提出', '2026-07-15T09:00:00.000Z', 5), task('通常', null, 2)];
    expect(filterAndSortTasks(values, { status: 'today', priority: 5, category: '重要', query: '提出', sort: 'due', today: '2026-07-15' }).map((item) => item.id)).toEqual(['重要な提出']);
  });

  it('priorityとupdatedで並び替える', () => {
    const older = task('low', null, 1);
    const newer = { ...task('high', null, 5), updatedAt: '2026-07-16T00:00:00.000Z' };
    expect(filterAndSortTasks([older, newer], { status: 'all', priority: 'all', category: 'all', query: '', sort: 'priority' })[0].id).toBe('high');
    expect(filterAndSortTasks([older, newer], { status: 'all', priority: 'all', category: 'all', query: '', sort: 'updated' })[0].id).toBe('high');
  });

  it('月表示を日曜始まり42日で生成し月移動する', () => {
    const grid = monthGrid(2026, 8);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-07-26');
    expect(monthShift(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('週次ReviewをAsia/Tokyo日付で集計する', () => {
    const store: TaskStore = { version: 1, tasks: [task('done', null, 3, '2026-07-14T15:00:00.000Z'), task('late', '2026-07-13T09:00:00.000Z')], routines: [routine], routineCompletions: [{ routineId: 'routine', date: '2026-07-15', completedAt: base }] };
    const summary = buildReviewSummary(store, '2026-07-15');
    expect(summary.todayCompletedTasks).toBe(1);
    expect(summary.weekCompletedTasks).toBe(1);
    expect(summary.weekRoutineCompletions).toBe(1);
    expect(summary.routineRate).toBe(33);
    expect(summary.overdueTasks).toBe(1);
  });
});
