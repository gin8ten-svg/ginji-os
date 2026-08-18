import { datesCoveredByAllDayEvent } from '@/lib/calendar/event-dates';
import { isRoutineScheduled, shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import { candidateBaseScore } from '@/lib/planner/scoring';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { BusyInterval, FreeSlot, PlanningResult, PlanningWindow, ProposedTimeBlock, UnscheduledRoutine, UnscheduledTask } from '@/types/planning';
import type { Routine, RoutineCompletion, Task, TaskStore } from '@/types/tasks';

const MINUTE = 60_000;
const DAY_START = '08:00';
const DAY_END = '22:00';
const MIN_SLOT = 25;

const instant = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`).getTime();
const iso = (value: number) => new Date(value).toISOString();
const validInterval = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start < end;

export function createPlanningWindow(now = new Date()): PlanningWindow {
  const firstDate = tokyoDateKey(now);
  const dates = Array.from({ length: 7 }, (_, index) => shiftTokyoDate(firstDate, index));
  const start = Math.max(now.getTime(), instant(firstDate, DAY_START));
  return { start: iso(start), end: iso(instant(shiftTokyoDate(firstDate, 7), DAY_START)), timeZone: 'Asia/Tokyo', workdayStart: DAY_START, workdayEnd: DAY_END, minimumSlotMinutes: MIN_SLOT, dates };
}

export function googleEventsToBusyIntervals(events: readonly ExternalCalendarEvent[], window: PlanningWindow): BusyInterval[] {
  const windowStart = new Date(window.start).getTime();
  const windowEnd = new Date(window.end).getTime();
  const intervals: BusyInterval[] = [];
  for (const event of events) {
    if (event.allDay) {
      const covered = datesCoveredByAllDayEvent(event.start, event.end);
      if (covered.length === 0) throw new Error('Google終日予定の期間が不正です。');
      for (const date of covered) {
        const start = instant(date, '00:00');
        const end = instant(shiftTokyoDate(date, 1), '00:00');
        if (end > windowStart && start < windowEnd) intervals.push({ start: iso(Math.max(start, windowStart)), end: iso(Math.min(end, windowEnd)), source: 'google', sourceId: `${event.calendarId}:${event.id}`, title: event.title });
      }
      continue;
    }
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (!validInterval(start, end)) throw new Error('Google予定の期間が不正です。');
    if (end > windowStart && start < windowEnd) intervals.push({ start: iso(Math.max(start, windowStart)), end: iso(Math.min(end, windowEnd)), source: 'google', sourceId: `${event.calendarId}:${event.id}`, title: event.title });
  }
  return intervals;
}

export function mergeBusyIntervals(intervals: readonly BusyInterval[]): BusyInterval[] {
  const sorted = intervals.map((item) => ({ ...item, startMs: new Date(item.start).getTime(), endMs: new Date(item.end).getTime() }))
    .filter((item) => validInterval(item.startMs, item.endMs)).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.sourceId.localeCompare(b.sourceId));
  const merged: BusyInterval[] = [];
  for (const item of sorted) {
    const previous = merged.at(-1);
    if (previous && new Date(item.start).getTime() <= new Date(previous.end).getTime()) {
      if (new Date(item.end).getTime() > new Date(previous.end).getTime()) previous.end = item.end;
      previous.sourceId = `${previous.sourceId}|${item.sourceId}`;
      previous.title = previous.title === item.title ? previous.title : '複数の予定';
    } else merged.push({ start: item.start, end: item.end, source: item.source, sourceId: item.sourceId, title: item.title });
  }
  return merged;
}

export function calculateFreeSlots(window: PlanningWindow, busy: readonly BusyInterval[]): FreeSlot[] {
  const slots: FreeSlot[] = [];
  const now = new Date(window.start).getTime();
  for (const date of window.dates) {
    const dayStart = Math.max(instant(date, window.workdayStart), now);
    const dayEnd = Math.min(instant(date, window.workdayEnd), new Date(window.end).getTime());
    if (dayStart >= dayEnd) continue;
    const occupied = mergeBusyIntervals(busy).map((item) => ({ start: Math.max(new Date(item.start).getTime(), dayStart), end: Math.min(new Date(item.end).getTime(), dayEnd) })).filter((item) => item.start < item.end);
    let cursor = dayStart;
    for (const item of occupied) {
      if (item.start > cursor && item.start - cursor >= MIN_SLOT * MINUTE) slots.push({ start: iso(cursor), end: iso(item.start) });
      cursor = Math.max(cursor, item.end);
    }
    if (dayEnd > cursor && dayEnd - cursor >= MIN_SLOT * MINUTE) slots.push({ start: iso(cursor), end: iso(dayEnd) });
  }
  return slots;
}

function consumeSlot(slots: FreeSlot[], index: number, minutes: number): { start: number; end: number } {
  const start = new Date(slots[index].start).getTime();
  const end = start + minutes * MINUTE;
  const slotEnd = new Date(slots[index].end).getTime();
  if (slotEnd - end < MIN_SLOT * MINUTE) slots.splice(index, 1);
  else slots[index] = { ...slots[index], start: iso(end) };
  return { start, end };
}

export function comparePlanningTasks(a: Task, b: Task, now: Date): number {
  const today = tokyoDateKey(now);
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const aOverdue = a.dueAt ? tokyoDateKey(new Date(aDue)) < today : false;
  const bOverdue = b.dueAt ? tokyoDateKey(new Date(bDue)) < today : false;
  const overdue = Number(bOverdue) - Number(aOverdue);
  return overdue || aDue - bDue || b.priority - a.priority || b.remainingMinutes - a.remainingMinutes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

type PlanningCandidate =
  | { kind: 'task'; task: Task; effectiveDeadline: number; priority: number; isOverdue: boolean; createdAt: string; id: string }
  | { kind: 'routine'; routine: Routine; date: string; effectiveDeadline: number; priority: number; isOverdue: boolean; createdAt: string; id: string };

function taskDeadline(task: Task, window: PlanningWindow, now: Date): number {
  if (!task.dueAt) return new Date(window.end).getTime();
  const due = new Date(task.dueAt).getTime();
  const date = tokyoDateKey(new Date(due));
  const today = tokyoDateKey(now);
  if (date < today) return now.getTime();
  const workdayEnd = instant(date, window.workdayEnd);
  if (date === today && due <= now.getTime()) return workdayEnd;
  return Math.min(due, workdayEnd, new Date(window.end).getTime());
}

export function planningPriorityBand(candidate: { kind: 'task'; dueAt: string | null } | { kind: 'routine'; constrained: boolean }, now: Date): number {
  if (candidate.kind === 'routine') return candidate.constrained ? 4 : 6;
  if (!candidate.dueAt) return 8;
  const due = new Date(candidate.dueAt).getTime();
  const today = tokyoDateKey(now); const dueDate = tokyoDateKey(new Date(due));
  if (dueDate < today) return 1;
  if (dueDate === today) return 2;
  if (dueDate === shiftTokyoDate(today, 1)) return 3;
  return due <= instant(shiftTokyoDate(today, 7), DAY_END) ? 5 : 7;
}

function planningCandidates(window: PlanningWindow, tasks: readonly Task[], routines: readonly Routine[], completions: readonly RoutineCompletion[], now: Date, orderingOverride?: readonly string[]): PlanningCandidate[] {
  const completed = new Set(completions.map((item) => `${item.date}:${item.routineId}`));
  const today = tokyoDateKey(now);
  const candidates: PlanningCandidate[] = [];
  for (const task of tasks) {
    const remaining = Math.max(0, Math.min(task.remainingMinutes, task.estimatedMinutes));
    const isOverdue = task.dueAt ? tokyoDateKey(new Date(task.dueAt)) < today : false;
    if (!task.completedAt && remaining > 0) candidates.push({ kind: 'task', task: { ...task, remainingMinutes: remaining }, effectiveDeadline: taskDeadline(task, window, now), priority: task.priority, isOverdue, createdAt: task.createdAt, id: task.id });
  }
  for (const date of window.dates) for (const routine of routines) {
    if (!isRoutineScheduled(routine, date) || completed.has(`${date}:${routine.id}`)) continue;
    candidates.push({ kind: 'routine', routine, date, effectiveDeadline: instant(date, routine.availableEndTime ?? window.workdayEnd), priority: routine.priority, isOverdue: false, createdAt: routine.createdAt, id: `${routine.id}:${date}` });
  }
  const nowMs = now.getTime();
  const windowEndMs = new Date(window.end).getTime();
  const score = (item: PlanningCandidate) => candidateBaseScore({ priority: item.priority, effectiveDeadline: item.effectiveDeadline, isOverdue: item.isOverdue, now: nowMs, windowEnd: windowEndMs });
  // docs/SCHEDULING_RULES.md §3のscore式をtie-breakとして使う。締切(effectiveDeadline)はハード制約の
  // ため常に最優先で比較し、スコアはそれが同値の場合にのみpriority/urgency/overdueで並び順を決める。
  const baseline = (a: PlanningCandidate, b: PlanningCandidate) => a.effectiveDeadline - b.effectiveDeadline || score(b) - score(a) || (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  if (!orderingOverride?.length) return candidates.sort(baseline);
  const ranks = new Map(orderingOverride.map((id, index) => [id, index]));
  const sourceKey = (item: PlanningCandidate) => item.kind === 'task' ? `task:${item.task.id}` : `routine:${item.routine.id}`;
  const band = (item: PlanningCandidate) => item.kind === 'task' ? planningPriorityBand({ kind: 'task', dueAt: item.task.dueAt }, now) : planningPriorityBand({ kind: 'routine', constrained: Boolean(item.routine.availableStartTime && item.routine.availableEndTime) }, now);
  return candidates.sort((a, b) => band(a) - band(b) || (ranks.get(sourceKey(a)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(sourceKey(b)) ?? Number.MAX_SAFE_INTEGER) || b.priority - a.priority || baseline(a, b));
}

function routineFailureReason(candidate: Extract<PlanningCandidate, { kind: 'routine' }>, window: PlanningWindow, googleBusy: readonly BusyInterval[]): UnscheduledRoutine['reason'] {
  const start = instant(candidate.date, candidate.routine.availableStartTime ?? window.workdayStart);
  const end = instant(candidate.date, candidate.routine.availableEndTime ?? window.workdayEnd);
  const workStart = instant(candidate.date, window.workdayStart);
  const workEnd = instant(candidate.date, window.workdayEnd);
  if (start < workStart || end > workEnd || start >= end) return '稼働可能時間外';
  if (end - start < candidate.routine.estimatedMinutes * MINUTE) return '所要時間を確保できない';
  if (googleBusy.some((item) => new Date(item.end).getTime() > start && new Date(item.start).getTime() < end)) return 'Google予定と競合';
  return '指定時間帯に空きがない';
}

export function buildPlanningResult(input: { now: Date; events: readonly ExternalCalendarEvent[]; tasks: readonly Task[]; routines: readonly Routine[]; completions: readonly RoutineCompletion[]; orderingOverride?: readonly string[] }): PlanningResult {
  const window = createPlanningWindow(input.now);
  const googleBusy = mergeBusyIntervals(googleEventsToBusyIntervals(input.events, window));
  const slots = calculateFreeSlots(window, googleBusy).map((item) => ({ ...item }));
  const proposedBlocks: ProposedTimeBlock[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const unscheduledRoutines: UnscheduledRoutine[] = [];
  for (const candidate of planningCandidates(window, input.tasks, input.routines, input.completions, input.now, input.orderingOverride)) {
    if (candidate.kind === 'routine') {
      const allowedStart = instant(candidate.date, candidate.routine.availableStartTime ?? window.workdayStart);
      const allowedEnd = instant(candidate.date, candidate.routine.availableEndTime ?? window.workdayEnd);
      const index = slots.findIndex((slot) => Math.max(new Date(slot.start).getTime(), allowedStart) + candidate.routine.estimatedMinutes * MINUTE <= Math.min(new Date(slot.end).getTime(), allowedEnd));
      if (index < 0) {
        unscheduledRoutines.push({ routineId: candidate.routine.id, title: candidate.routine.name, targetDate: candidate.date, reason: routineFailureReason(candidate, window, googleBusy) });
        continue;
      }
      const slotStart = new Date(slots[index].start).getTime();
      const slotEnd = new Date(slots[index].end).getTime();
      const start = Math.max(slotStart, allowedStart);
      const end = start + candidate.routine.estimatedMinutes * MINUTE;
      const replacement: FreeSlot[] = [];
      if (start - slotStart >= MIN_SLOT * MINUTE) replacement.push({ start: iso(slotStart), end: iso(start) });
      if (slotEnd - end >= MIN_SLOT * MINUTE) replacement.push({ start: iso(end), end: iso(slotEnd) });
      slots.splice(index, 1, ...replacement);
      const placed = { start, end };
      proposedBlocks.push({ id: `routine:${candidate.routine.id}:${candidate.date}`, source: 'routine', taskId: null, routineId: candidate.routine.id, title: candidate.routine.name, start: iso(placed.start), end: iso(placed.end), splitIndex: 1 });
      continue;
    }
    const task = candidate.task;
    let remaining = task.remainingMinutes;
    let splitIndex = 1;
    const overdueDate = task.dueAt ? tokyoDateKey(new Date(task.dueAt)) < tokyoDateKey(input.now) : false;
    const deadline = overdueDate ? new Date(window.end).getTime() : candidate.effectiveDeadline;
    if (!task.splittable) {
      const index = slots.findIndex((slot) => new Date(slot.start).getTime() + remaining * MINUTE <= Math.min(new Date(slot.end).getTime(), deadline));
      if (index >= 0) {
        const placed = consumeSlot(slots, index, remaining);
        proposedBlocks.push({ id: `task:${task.id}:1`, source: 'task', taskId: task.id, routineId: null, title: task.title, start: iso(placed.start), end: iso(placed.end), splitIndex: 1 });
        remaining = 0;
      }
    } else {
      for (let index = 0; index < slots.length && remaining > 0;) {
        const slotStart = new Date(slots[index].start).getTime();
        const available = Math.floor((Math.min(new Date(slots[index].end).getTime(), deadline) - slotStart) / MINUTE);
        if (available < task.minimumBlockMinutes) { index += 1; continue; }
        const minutes = Math.min(remaining, available);
        if (minutes < task.minimumBlockMinutes && minutes !== remaining) { index += 1; continue; }
        const placed = consumeSlot(slots, index, minutes);
        proposedBlocks.push({ id: `task:${task.id}:${splitIndex}`, source: 'task', taskId: task.id, routineId: null, title: task.title, start: iso(placed.start), end: iso(placed.end), splitIndex });
        remaining -= minutes; splitIndex += 1;
        if (index < slots.length && new Date(slots[index].start).getTime() >= deadline) index += 1;
      }
    }
    if (remaining > 0) unscheduledTasks.push({ taskId: task.id, title: task.title, remainingMinutes: remaining, reason: !task.splittable ? '期限内の連続した空き時間へ配置できませんでした。' : `残り${remaining}分を期限内の連続した空き時間へ配置できませんでした。` });
  }
  const routineBusy = proposedBlocks.filter((block) => block.source === 'routine').map((block) => ({ start: block.start, end: block.end, source: 'routine' as const, sourceId: block.routineId ?? block.id, title: block.title }));
  return { window, busyIntervals: mergeBusyIntervals([...googleBusy, ...routineBusy]), freeSlots: slots, proposedBlocks: proposedBlocks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)), unscheduledTasks, unscheduledRoutines, warnings: [] };
}

/**
 * docs/SCHEDULING_RULES.md §5「Server validation after AI output」のチェック項目を、
 * 手動編集された計画blocksにも適用できる汎用バリデータとして実装する。決定論的Engineの
 * 出力と完全一致するかを見るvalidateStoredPlan(server.ts)とは異なり、hard constraint
 * （所有権・時刻妥当性・稼働時間内・固定予定との非重複・block同士の非重複・remainingMinutes
 * 超過なし）だけを独立に再検証する。
 */
export function validateProposedBlocksAgainstConstraints(blocks: readonly ProposedTimeBlock[], window: PlanningWindow, store: TaskStore, googleBusy: readonly BusyInterval[]): { ok: true } | { ok: false; reason: string } {
  const windowStart = new Date(window.start).getTime();
  const windowEnd = new Date(window.end).getTime();
  const activeTasks = new Map(store.tasks.filter((item) => !item.completedAt).map((item) => [item.id, item]));
  const activeRoutines = new Set(store.routines.filter((item) => item.isActive).map((item) => item.id));
  const busy = mergeBusyIntervals(googleBusy);
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  const usedByTask = new Map<string, number>();

  for (let index = 0; index < sorted.length; index += 1) {
    const block = sorted[index];
    const start = new Date(block.start).getTime();
    const end = new Date(block.end).getTime();
    if (!validInterval(start, end)) return { ok: false, reason: `${block.title}の時刻が不正です。` };
    const duration = (end - start) / MINUTE;
    if (!Number.isInteger(duration) || duration <= 0) return { ok: false, reason: `${block.title}は分単位で指定してください。` };
    if (start < windowStart || end > windowEnd) return { ok: false, reason: `${block.title}が計画対象期間の外にあります。` };

    const dateKey = tokyoDateKey(new Date(start));
    if (!window.dates.includes(dateKey)) return { ok: false, reason: `${block.title}が計画対象日の外にあります。` };
    const dayStart = instant(dateKey, window.workdayStart);
    const dayEnd = instant(dateKey, window.workdayEnd);
    if (start < dayStart || end > dayEnd) return { ok: false, reason: `${block.title}が稼働時間外です。` };

    if (busy.some((item) => new Date(item.end).getTime() > start && new Date(item.start).getTime() < end)) {
      return { ok: false, reason: `${block.title}が固定予定と重複しています。` };
    }
    for (let other = 0; other < index; other += 1) {
      const otherBlock = sorted[other];
      if (new Date(otherBlock.end).getTime() > start && new Date(otherBlock.start).getTime() < end) {
        return { ok: false, reason: `${block.title}が他の予定と重複しています。` };
      }
    }

    if (block.source === 'task') {
      const task = block.taskId ? activeTasks.get(block.taskId) : undefined;
      if (!block.taskId || !task) return { ok: false, reason: 'タスクの参照が不正です。' };
      const used = (usedByTask.get(block.taskId) ?? 0) + duration;
      usedByTask.set(block.taskId, used);
      if (used > Math.max(0, Math.min(task.remainingMinutes, task.estimatedMinutes))) return { ok: false, reason: `${task.title}の残り時間を超えています。` };
    } else {
      if (!block.routineId || !activeRoutines.has(block.routineId)) return { ok: false, reason: 'ルーティンの参照が不正です。' };
    }
  }
  return { ok: true };
}
