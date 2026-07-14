import { datesCoveredByAllDayEvent } from '@/lib/calendar/event-dates';
import { isRoutineScheduled, shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { BusyInterval, FreeSlot, PlanningResult, PlanningWindow, ProposedTimeBlock, UnscheduledTask } from '@/types/planning';
import type { Routine, RoutineCompletion, Task } from '@/types/tasks';

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

function routineBlocks(window: PlanningWindow, routines: readonly Routine[], completions: readonly RoutineCompletion[], googleBusy: readonly BusyInterval[]): { blocks: ProposedTimeBlock[]; busy: BusyInterval[] } {
  const blocks: ProposedTimeBlock[] = [];
  const busy = [...googleBusy];
  const completed = new Set(completions.map((item) => `${item.date}:${item.routineId}`));
  const ordered = [...routines].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const date of window.dates) for (const routine of ordered) {
    if (!isRoutineScheduled(routine, date) || completed.has(`${date}:${routine.id}`)) continue;
    const allowedStart = instant(date, routine.availableStartTime ?? window.workdayStart);
    const allowedEnd = instant(date, routine.availableEndTime ?? window.workdayEnd);
    const slots = calculateFreeSlots(window, busy);
    const slot = slots.find((item) => Math.max(new Date(item.start).getTime(), allowedStart) + routine.estimatedMinutes * MINUTE <= Math.min(new Date(item.end).getTime(), allowedEnd));
    if (!slot) continue;
    const start = Math.max(new Date(slot.start).getTime(), allowedStart);
    const end = start + routine.estimatedMinutes * MINUTE;
    const block: ProposedTimeBlock = { id: `routine:${routine.id}:${date}`, source: 'routine', taskId: null, routineId: routine.id, title: routine.name, start: iso(start), end: iso(end), splitIndex: 1 };
    blocks.push(block);
    busy.push({ start: block.start, end: block.end, source: 'routine', sourceId: routine.id, title: routine.name });
  }
  return { blocks, busy };
}

export function comparePlanningTasks(a: Task, b: Task, now: Date): number {
  const nowMs = now.getTime();
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const overdue = Number(bDue < nowMs) - Number(aDue < nowMs);
  return overdue || aDue - bDue || b.priority - a.priority || b.remainingMinutes - a.remainingMinutes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function buildPlanningResult(input: { now: Date; events: readonly ExternalCalendarEvent[]; tasks: readonly Task[]; routines: readonly Routine[]; completions: readonly RoutineCompletion[] }): PlanningResult {
  const window = createPlanningWindow(input.now);
  const googleBusy = mergeBusyIntervals(googleEventsToBusyIntervals(input.events, window));
  const routine = routineBlocks(window, input.routines, input.completions, googleBusy);
  const busyIntervals = mergeBusyIntervals(routine.busy);
  const slots = calculateFreeSlots(window, busyIntervals).map((item) => ({ ...item }));
  const proposedBlocks = [...routine.blocks];
  const unscheduledTasks: UnscheduledTask[] = [];
  const tasks = input.tasks.filter((task) => !task.completedAt && task.remainingMinutes > 0).sort((a, b) => comparePlanningTasks(a, b, input.now));
  for (const task of tasks) {
    let remaining = task.remainingMinutes;
    let splitIndex = 1;
    const overdue = task.dueAt ? new Date(task.dueAt).getTime() < input.now.getTime() : false;
    const deadline = task.dueAt && !overdue ? Math.min(new Date(task.dueAt).getTime(), new Date(window.end).getTime()) : new Date(window.end).getTime();
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
        if (minutes < task.minimumBlockMinutes) { index += 1; continue; }
        const placed = consumeSlot(slots, index, minutes);
        proposedBlocks.push({ id: `task:${task.id}:${splitIndex}`, source: 'task', taskId: task.id, routineId: null, title: task.title, start: iso(placed.start), end: iso(placed.end), splitIndex });
        remaining -= minutes; splitIndex += 1;
        if (index < slots.length && new Date(slots[index].start).getTime() >= deadline) index += 1;
      }
    }
    if (remaining > 0) unscheduledTasks.push({ taskId: task.id, title: task.title, remainingMinutes: remaining, reason: !task.splittable ? '連続した空き時間不足' : task.minimumBlockMinutes > remaining ? '最小ブロックを確保できない' : '期限内の空き時間不足' });
  }
  return { window, busyIntervals, freeSlots: slots, proposedBlocks: proposedBlocks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)), unscheduledTasks };
}
