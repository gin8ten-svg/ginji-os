import 'server-only';
import { createHash } from 'node:crypto';
import { googleEventsToBusyIntervals, mergeBusyIntervals } from '@/lib/planner/engine';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { PlanningWindow } from '@/types/planning';
import type { Routine, RoutineCompletion, Task } from '@/types/tasks';

export const LEGACY_PLANNING_ENGINE_VERSION = 'deterministic-v1';
export { PLANNING_ENGINE_VERSION } from '@/lib/planning/input-snapshot-v2';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function planningInputHash(input: { window: PlanningWindow; now: Date; tasks: readonly Task[]; routines: readonly Routine[]; completions: readonly RoutineCompletion[]; events: readonly ExternalCalendarEvent[]; engineVersion?: string }): string {
  const busy = mergeBusyIntervals(googleEventsToBusyIntervals(input.events, input.window)).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const tasks = input.tasks.map((task) => ({ id: task.id, dueAt: task.dueAt, priority: task.priority, estimatedMinutes: task.estimatedMinutes, remainingMinutes: task.remainingMinutes, splittable: task.splittable, minimumBlockMinutes: task.minimumBlockMinutes, completedAt: task.completedAt, updatedAt: task.updatedAt })).sort((a, b) => a.id.localeCompare(b.id));
  const routines = input.routines.map((routine) => ({ id: routine.id, frequency: routine.frequency, estimatedMinutes: routine.estimatedMinutes, priority: routine.priority, availableStartTime: routine.availableStartTime, availableEndTime: routine.availableEndTime, isActive: routine.isActive, updatedAt: routine.updatedAt })).sort((a, b) => a.id.localeCompare(b.id));
  const completions = input.completions.map((item) => ({ routineId: item.routineId, date: item.date, completedAt: item.completedAt })).sort((a, b) => a.routineId.localeCompare(b.routineId) || a.date.localeCompare(b.date));
  return createHash('sha256').update(canonical({ window: input.window, now: input.now.toISOString(), tasks, routines, completions, busy, engineVersion: input.engineVersion ?? LEGACY_PLANNING_ENGINE_VERSION })).digest('hex');
}

export function canonicalizeForTest(value: unknown): string { return canonical(value); }
