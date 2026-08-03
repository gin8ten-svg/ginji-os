import 'server-only';
import { createHash } from 'node:crypto';
import { googleEventsToBusyIntervals, mergeBusyIntervals } from '@/lib/planner/engine';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { PlanningWindow } from '@/types/planning';
import type { Routine, RoutineCompletion, Task } from '@/types/tasks';

export const PLANNING_INPUT_SNAPSHOT_VERSION = 'planning-input-v2' as const;
export const PLANNING_ENGINE_VERSION = 'deterministic-v2' as const;
export const PLANNING_TITLE_MAX_LENGTH = 200;
export const PLANNING_SNAPSHOT_MAX_BYTES = 1_000_000;
export const PLANNING_SNAPSHOT_MAX_ENTITIES = 1_000;
export const PLANNING_SNAPSHOT_MAX_COMPLETIONS = 5_000;
export const PLANNING_SNAPSHOT_MAX_BUSY_INTERVALS = 5_000;

type SnapshotTask = Pick<Task, 'id' | 'dueAt' | 'priority' | 'estimatedMinutes' | 'remainingMinutes' | 'splittable' | 'minimumBlockMinutes' | 'completedAt' | 'updatedAt'> & { title: string };
type SnapshotRoutine = Pick<Routine, 'id' | 'frequency' | 'estimatedMinutes' | 'priority' | 'availableStartTime' | 'availableEndTime' | 'isActive' | 'updatedAt'> & { title: string };

export interface PlanningInputSnapshotV2 {
  schemaVersion: typeof PLANNING_INPUT_SNAPSHOT_VERSION;
  engineVersion: typeof PLANNING_ENGINE_VERSION;
  window: PlanningWindow;
  now: string;
  tasks: SnapshotTask[];
  routines: SnapshotRoutine[];
  completions: Array<{ routineId: string; date: string; completedAt: string }>;
  busy: Array<{ start: string; end: string }>;
}

export function canonicalPlanningTitle(value: unknown, sourceType: 'task' | 'routine'): string {
  const fallback = sourceType === 'task' ? '名称未設定のタスク' : '名称未設定のルーティン';
  if (typeof value !== 'string') return fallback;
  const cleaned = value.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (!cleaned) return fallback;
  return [...cleaned].slice(0, PLANNING_TITLE_MAX_LENGTH).join('');
}

export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildPlanningInputSnapshotV2(input: { window: PlanningWindow; now: Date; tasks: readonly Task[]; routines: readonly Routine[]; completions: readonly RoutineCompletion[]; events: readonly ExternalCalendarEvent[] }): PlanningInputSnapshotV2 {
  const tasks = input.tasks.map((task) => ({ id: task.id, title: canonicalPlanningTitle(task.title, 'task'), dueAt: task.dueAt, priority: task.priority, estimatedMinutes: task.estimatedMinutes, remainingMinutes: task.remainingMinutes, splittable: task.splittable, minimumBlockMinutes: task.minimumBlockMinutes, completedAt: task.completedAt, updatedAt: task.updatedAt })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const routines = input.routines.map((routine) => ({ id: routine.id, title: canonicalPlanningTitle(routine.name, 'routine'), frequency: routine.frequency.type === 'daily' ? { type: 'daily' as const } : { type: 'weekdays' as const, weekdays: [...routine.frequency.weekdays].sort((a, b) => a - b) }, estimatedMinutes: routine.estimatedMinutes, priority: routine.priority, availableStartTime: routine.availableStartTime, availableEndTime: routine.availableEndTime, isActive: routine.isActive, updatedAt: routine.updatedAt })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const completions = input.completions.map((item) => ({ routineId: item.routineId, date: item.date, completedAt: item.completedAt })).sort((a, b) => a.routineId.localeCompare(b.routineId) || a.date.localeCompare(b.date) || a.completedAt.localeCompare(b.completedAt));
  const busy = mergeBusyIntervals(googleEventsToBusyIntervals(input.events, input.window)).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { schemaVersion: PLANNING_INPUT_SNAPSHOT_VERSION, engineVersion: PLANNING_ENGINE_VERSION, window: { ...input.window, dates: [...input.window.dates] }, now: input.now.toISOString(), tasks, routines, completions, busy };
}

export function hashPlanningInputSnapshotV2(snapshot: PlanningInputSnapshotV2): string {
  return createHash('sha256').update(canonicalStringify(snapshot)).digest('hex');
}

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validatePlanningInputSnapshotV2(value: unknown): value is PlanningInputSnapshotV2 {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'engineVersion', 'window', 'now', 'tasks', 'routines', 'completions', 'busy'])) return false;
  if (value.schemaVersion !== PLANNING_INPUT_SNAPSHOT_VERSION || value.engineVersion !== PLANNING_ENGINE_VERSION || !iso(value.now)) return false;
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > PLANNING_SNAPSHOT_MAX_BYTES || !record(value.window) || !exactKeys(value.window, ['start', 'end', 'timeZone', 'workdayStart', 'workdayEnd', 'minimumSlotMinutes', 'dates']) || !iso(value.window.start) || !iso(value.window.end) || value.window.timeZone !== 'Asia/Tokyo' || value.window.workdayStart !== '08:00' || value.window.workdayEnd !== '22:00' || value.window.minimumSlotMinutes !== 25 || !Array.isArray(value.window.dates) || !value.window.dates.every((date) => typeof date === 'string')) return false;
  if (!Array.isArray(value.tasks) || !Array.isArray(value.routines) || value.tasks.length + value.routines.length > PLANNING_SNAPSHOT_MAX_ENTITIES || !Array.isArray(value.completions) || value.completions.length > PLANNING_SNAPSHOT_MAX_COMPLETIONS || !Array.isArray(value.busy) || value.busy.length > PLANNING_SNAPSHOT_MAX_BUSY_INTERVALS) return false;
  const tasks = value.tasks; const routines = value.routines; const completions = value.completions; const busy = value.busy;
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!record(task) || !exactKeys(task, ['id', 'title', 'dueAt', 'priority', 'estimatedMinutes', 'remainingMinutes', 'splittable', 'minimumBlockMinutes', 'completedAt', 'updatedAt']) || typeof task.id !== 'string' || ids.has(`task:${task.id}`) || typeof task.title !== 'string' || [...task.title].length > PLANNING_TITLE_MAX_LENGTH || canonicalPlanningTitle(task.title, 'task') !== task.title || !(task.dueAt === null || iso(task.dueAt)) || typeof task.priority !== 'number' || typeof task.estimatedMinutes !== 'number' || typeof task.remainingMinutes !== 'number' || typeof task.splittable !== 'boolean' || typeof task.minimumBlockMinutes !== 'number' || !(task.completedAt === null || iso(task.completedAt)) || !iso(task.updatedAt)) return false;
    ids.add(`task:${task.id}`);
  }
  for (const routine of routines) {
    if (!record(routine) || !exactKeys(routine, ['id', 'title', 'frequency', 'estimatedMinutes', 'priority', 'availableStartTime', 'availableEndTime', 'isActive', 'updatedAt']) || typeof routine.id !== 'string' || ids.has(`routine:${routine.id}`) || typeof routine.title !== 'string' || [...routine.title].length > PLANNING_TITLE_MAX_LENGTH || canonicalPlanningTitle(routine.title, 'routine') !== routine.title || !record(routine.frequency) || (routine.frequency.type === 'daily' ? !exactKeys(routine.frequency, ['type']) : routine.frequency.type === 'weekdays' ? !exactKeys(routine.frequency, ['type', 'weekdays']) || !Array.isArray(routine.frequency.weekdays) || !routine.frequency.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) : true) || typeof routine.estimatedMinutes !== 'number' || typeof routine.priority !== 'number' || !(routine.availableStartTime === null || typeof routine.availableStartTime === 'string') || !(routine.availableEndTime === null || typeof routine.availableEndTime === 'string') || typeof routine.isActive !== 'boolean' || !iso(routine.updatedAt)) return false;
    ids.add(`routine:${routine.id}`);
  }
  if (!completions.every((item) => record(item) && exactKeys(item, ['routineId', 'date', 'completedAt']) && typeof item.routineId === 'string' && typeof item.date === 'string' && iso(item.completedAt))) return false;
  if (!busy.every((item) => record(item) && exactKeys(item, ['start', 'end']) && iso(item.start) && iso(item.end) && new Date(item.start) < new Date(item.end))) return false;
  const checkedTasks = tasks as SnapshotTask[]; const checkedRoutines = routines as SnapshotRoutine[]; const checkedCompletions = completions as PlanningInputSnapshotV2['completions']; const checkedBusy = busy as PlanningInputSnapshotV2['busy'];
  if (checkedTasks.some((item, index) => index > 0 && checkedTasks[index - 1].id >= item.id)) return false;
  if (checkedRoutines.some((item, index) => index > 0 && checkedRoutines[index - 1].id >= item.id)) return false;
  if (checkedCompletions.some((item, index) => index > 0 && `${checkedCompletions[index - 1].routineId}\u0000${checkedCompletions[index - 1].date}\u0000${checkedCompletions[index - 1].completedAt}` > `${item.routineId}\u0000${item.date}\u0000${item.completedAt}`)) return false;
  if (checkedBusy.some((item, index) => index > 0 && `${checkedBusy[index - 1].start}\u0000${checkedBusy[index - 1].end}` > `${item.start}\u0000${item.end}`)) return false;
  return true;
}
