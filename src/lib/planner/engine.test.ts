import { describe, expect, it } from 'vitest';
import { buildPlanningResult, calculateFreeSlots, comparePlanningTasks, createPlanningWindow, googleEventsToBusyIntervals, mergeBusyIntervals } from '@/lib/planner/engine';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { BusyInterval } from '@/types/planning';
import type { Routine, Task } from '@/types/tasks';

const now = new Date('2026-07-15T00:00:00.000Z'); // 09:00 Asia/Tokyo
const iso = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`).toISOString();
const event = (id: string, start: string, end: string, allDay = false): ExternalCalendarEvent => ({ id, calendarId: 'primary', title: id, start, end, allDay, status: 'confirmed', htmlLink: null, colorId: null });
const busy = (id: string, start: string, end: string): BusyInterval => ({ source: 'google', sourceId: id, title: id, start: iso('2026-07-15', start), end: iso('2026-07-15', end) });
const task = (value: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({ description: '', dueAt: null, priority: 3, estimatedMinutes: 60, remainingMinutes: 60, splittable: true, minimumBlockMinutes: 25, category: '', completedAt: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user', ...value });
const routine = (value: Partial<Routine> & Pick<Routine, 'id' | 'name'>): Routine => ({ description: '', frequency: { type: 'daily' }, estimatedMinutes: 30, priority: 3, category: '', availableStartTime: null, availableEndTime: null, isActive: true, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', source: 'user', ...value });

describe('Planner busy/free normalization', () => {
  it('overlapと隣接区間を決定論的にmergeする', () => {
    const result = mergeBusyIntervals([busy('b', '10:30', '11:00'), busy('a', '09:00', '10:30'), busy('c', '12:00', '13:00')]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ start: iso('2026-07-15', '09:00'), end: iso('2026-07-15', '11:00') });
  });

  it('1日・複数日all-dayを[start,end)の終日busyへ変換する', () => {
    const window = createPlanningWindow(now);
    const intervals = googleEventsToBusyIntervals([event('one', '2026-07-15', '2026-07-16', true), event('multi', '2026-07-31', '2026-08-02', true)], { ...window, start: iso('2026-07-15', '08:00'), end: iso('2026-08-03', '08:00'), dates: ['2026-07-15', '2026-07-31', '2026-08-01'] });
    expect(intervals.map((item) => item.start)).toEqual([iso('2026-07-15', '08:00'), iso('2026-07-31', '00:00'), iso('2026-08-01', '00:00')]);
    expect(() => googleEventsToBusyIntervals([event('bad', '2026-07-16', '2026-07-15', true)], window)).toThrow('不正');
  });

  it('複数Calendarの重複timed eventを統合し、不正区間を拒否する', () => {
    const window = createPlanningWindow(now);
    const first = event('first', iso('2026-07-15', '10:00'), iso('2026-07-15', '11:00'));
    const second = { ...event('second', iso('2026-07-15', '10:30'), iso('2026-07-15', '12:00')), calendarId: 'holidays' };
    expect(mergeBusyIntervals(googleEventsToBusyIntervals([first, second], window))).toHaveLength(1);
    expect(() => googleEventsToBusyIntervals([event('bad', iso('2026-07-15', '12:00'), iso('2026-07-15', '11:00'))], window)).toThrow('不正');
  });

  it('稼働時間との差分を求め25分未満を除外する', () => {
    const window = { ...createPlanningWindow(now), dates: ['2026-07-15'], end: iso('2026-07-16', '08:00') };
    const slots = calculateFreeSlots(window, [busy('a', '09:20', '10:00'), busy('b', '21:40', '22:00')]);
    expect(slots[0]).toEqual({ start: iso('2026-07-15', '10:00'), end: iso('2026-07-15', '21:40') });
    expect(slots).toHaveLength(1);
  });

  it.each([
    ['月末', '2026-07-31T14:30:00.000Z', '2026-07-31'],
    ['年末', '2026-12-31T14:30:00.000Z', '2026-12-31'],
  ])('%sとAsia/Tokyoの0時境界で7日windowを作る', (_label, value, firstDate) => { expect(createPlanningWindow(new Date(value)).dates[0]).toBe(firstDate); });

  it('日をまたぐbusyを日別稼働枠から差し引く', () => {
    const window = { ...createPlanningWindow(now), dates: ['2026-07-15', '2026-07-16'], end: iso('2026-07-17', '08:00') };
    const crossing: BusyInterval = { source: 'google', sourceId: 'cross', title: 'cross', start: iso('2026-07-15', '21:00'), end: iso('2026-07-16', '09:00') };
    const slots = calculateFreeSlots(window, [crossing]);
    expect(slots).toContainEqual({ start: iso('2026-07-15', '09:00'), end: iso('2026-07-15', '21:00') });
    expect(slots).toContainEqual({ start: iso('2026-07-16', '09:00'), end: iso('2026-07-16', '22:00') });
  });
});

describe('Deterministic task and routine placement', () => {
  it('期限超過→期限→優先度→remaining→createdAtで並べる', () => {
    const values = [task({ id: 'low', title: 'low', dueAt: iso('2026-07-16', '18:00'), priority: 1 }), task({ id: 'high', title: 'high', dueAt: iso('2026-07-16', '18:00'), priority: 5 }), task({ id: 'overdue', title: 'overdue', dueAt: iso('2026-07-14', '18:00') })];
    expect(values.sort((a, b) => comparePlanningTasks(a, b, now)).map((item) => item.id)).toEqual(['overdue', 'high', 'low']);
  });

  it('分割可能タスクをminimumBlockMinutes以上で分割しremainingMinutesだけ配置する', () => {
    const result = buildPlanningResult({ now, events: [event('middle', iso('2026-07-15', '09:30'), iso('2026-07-15', '21:30'))], tasks: [task({ id: 'split', title: 'split', remainingMinutes: 60, estimatedMinutes: 90, minimumBlockMinutes: 25 })], routines: [], completions: [] });
    const blocks = result.proposedBlocks.filter((item) => item.taskId === 'split');
    expect(blocks.map((item) => (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000)).toEqual([30, 30]);
    expect(result.unscheduledTasks).toHaveLength(0);
  });

  it('分割不可タスクは連続枠がなければ配置しない', () => {
    const result = buildPlanningResult({ now, events: [event('busy', iso('2026-07-15', '10:00'), iso('2026-07-21', '21:30'))], tasks: [task({ id: 'solid', title: 'solid', splittable: false, remainingMinutes: 120 })], routines: [], completions: [] });
    expect(result.proposedBlocks.filter((item) => item.taskId === 'solid')).toHaveLength(0);
    expect(result.unscheduledTasks[0].reason).toBe('連続した空き時間不足');
  });

  it('minimumBlockMinutes未満の残り時間を単独ブロックにしない', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'tiny', title: 'tiny', remainingMinutes: 20, minimumBlockMinutes: 25 })], routines: [], completions: [] });
    expect(result.proposedBlocks.some((item) => item.taskId === 'tiny')).toBe(false);
    expect(result.unscheduledTasks[0].reason).toBe('最小ブロックを確保できない');
  });

  it('期限後には配置せず不足分を未配置にする', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'due', title: 'due', remainingMinutes: 600, dueAt: iso('2026-07-15', '12:00') })], routines: [], completions: [] });
    expect(result.proposedBlocks.every((item) => item.taskId !== 'due' || new Date(item.end) <= new Date(iso('2026-07-15', '12:00')))).toBe(true);
    expect(result.unscheduledTasks[0].taskId).toBe('due');
  });

  it('曜日と利用可能時間内へRoutineを先に置き、完了日は除外する', () => {
    const routines = [routine({ id: 'weekday', name: 'weekday', frequency: { type: 'weekdays', weekdays: [3] }, availableStartTime: '10:00', availableEndTime: '11:00' })];
    const placed = buildPlanningResult({ now, events: [], tasks: [], routines, completions: [] }).proposedBlocks.filter((item) => item.routineId === 'weekday');
    expect(placed).toHaveLength(1);
    expect(placed[0].start).toBe(iso('2026-07-15', '10:00'));
    expect(buildPlanningResult({ now, events: [], tasks: [], routines, completions: [{ routineId: 'weekday', date: '2026-07-15', completedAt: now.toISOString() }] }).proposedBlocks).toHaveLength(0);
  });

  it('完了タスクを除外し同一タスクの配置時間を重複させない', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'done', title: 'done', completedAt: now.toISOString(), remainingMinutes: 0 }), task({ id: 'active', title: 'active', remainingMinutes: 900 })], routines: [], completions: [] });
    expect(result.proposedBlocks.some((item) => item.taskId === 'done')).toBe(false);
    const blocks = result.proposedBlocks.filter((item) => item.taskId === 'active');
    for (let index = 1; index < blocks.length; index += 1) expect(new Date(blocks[index - 1].end) <= new Date(blocks[index].start)).toBe(true);
  });

  it('同じ入力は同じ結果を返す', () => {
    const input = { now, events: [event('fixed', iso('2026-07-15', '12:00'), iso('2026-07-15', '13:00'))], tasks: [task({ id: 'a', title: 'A' })], routines: [routine({ id: 'r', name: 'R' })], completions: [] };
    expect(buildPlanningResult(input)).toEqual(buildPlanningResult(input));
  });
});
