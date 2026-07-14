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
    const result = buildPlanningResult({ now, events: [event('busy', iso('2026-07-15', '10:00'), iso('2026-07-21', '21:30'))], tasks: [task({ id: 'solid', title: 'solid', splittable: false, estimatedMinutes: 120, remainingMinutes: 120 })], routines: [], completions: [] });
    expect(result.proposedBlocks.filter((item) => item.taskId === 'solid')).toHaveLength(0);
    expect(result.unscheduledTasks[0].reason).toContain('連続した空き時間');
  });

  it('minimumBlockMinutes未満の残り時間を単独ブロックで救済する', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'tiny', title: 'tiny', remainingMinutes: 20, minimumBlockMinutes: 25 })], routines: [], completions: [] });
    const block = result.proposedBlocks.find((item) => item.taskId === 'tiny');
    expect((new Date(block!.end).getTime() - new Date(block!.start).getTime()) / 60_000).toBe(20);
    expect(result.unscheduledTasks).toHaveLength(0);
  });

  it('期限後には配置せず不足分を未配置にする', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'due', title: 'due', estimatedMinutes: 600, remainingMinutes: 600, dueAt: iso('2026-07-15', '12:00') })], routines: [], completions: [] });
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

  it('期限当日priority 5 Taskを自由Routineより優先する', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'urgent', title: 'urgent', priority: 5, splittable: false, estimatedMinutes: 780, remainingMinutes: 780, dueAt: iso('2026-07-15', '22:00') })], routines: [routine({ id: 'flex', name: 'flex', priority: 1, frequency: { type: 'weekdays', weekdays: [3] } })], completions: [] });
    expect(result.proposedBlocks[0].taskId).toBe('urgent');
    expect(result.unscheduledRoutines[0].routineId).toBe('flex');
  });

  it('狭い時間帯Routineを期限が遠いTaskより先に確保する', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'later', title: 'later', dueAt: iso('2026-07-20', '18:00'), estimatedMinutes: 780, remainingMinutes: 780 })], routines: [routine({ id: 'narrow', name: 'narrow', frequency: { type: 'weekdays', weekdays: [3] }, availableStartTime: '09:00', availableEndTime: '09:30' })], completions: [] });
    expect(result.proposedBlocks[0].routineId).toBe('narrow');
  });

  it('分割末尾の小さい残りを次の連続枠へ救済する', () => {
    const blockers = [event('b1', iso('2026-07-15', '09:25'), iso('2026-07-15', '10:00')), event('b2', iso('2026-07-15', '10:25'), iso('2026-07-15', '11:00')), event('b3', iso('2026-07-15', '11:30'), iso('2026-07-15', '22:00')), event('future', '2026-07-16', '2026-07-22', true)];
    const result = buildPlanningResult({ now, events: blockers, tasks: [task({ id: 'tail', title: 'tail', remainingMinutes: 60, minimumBlockMinutes: 25 })], routines: [], completions: [] });
    expect(result.proposedBlocks.filter((item) => item.taskId === 'tail').map((item) => (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000)).toEqual([25, 25, 10]);
  });

  it('残り15分に対して10分の空きしかなければ理由付きで未配置にする', () => {
    const result = buildPlanningResult({ now, events: [event('today', iso('2026-07-15', '09:10'), iso('2026-07-15', '22:00')), event('future', '2026-07-16', '2026-07-22', true)], tasks: [task({ id: 'tiny-no-fit', title: 'tiny-no-fit', remainingMinutes: 15, minimumBlockMinutes: 25 })], routines: [], completions: [] });
    expect(result.proposedBlocks.some((item) => item.taskId === 'tiny-no-fit')).toBe(false);
    expect(result.unscheduledTasks[0].reason).toContain('残り15分');
  });

  it('remainingMinutesを0以上estimatedMinutes以下へ正規化する', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'zero', title: 'zero', remainingMinutes: 0 }), task({ id: 'negative', title: 'negative', remainingMinutes: -5 }), task({ id: 'over', title: 'over', estimatedMinutes: 30, remainingMinutes: 90 })], routines: [], completions: [] });
    expect(result.proposedBlocks.some((item) => item.taskId === 'zero' || item.taskId === 'negative')).toBe(false);
    const over = result.proposedBlocks.filter((item) => item.taskId === 'over');
    expect(over.reduce((sum, item) => sum + (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000, 0)).toBe(30);
  });

  it('7日すべて終日busyならRoutineを理由付きで未配置にする', () => {
    const result = buildPlanningResult({ now, events: [event('all', '2026-07-15', '2026-07-22', true)], tasks: [], routines: [routine({ id: 'r', name: 'r' })], completions: [] });
    expect(result.proposedBlocks).toHaveLength(0);
    expect(result.unscheduledRoutines).toHaveLength(7);
    expect(result.unscheduledRoutines.every((item) => item.reason === 'Google予定と競合')).toBe(true);
  });

  it('同期限・同priorityのTask/Routine候補を安定フィールドで決定する', () => {
    const input = { now, events: [], tasks: [task({ id: 'b', title: 'b', dueAt: iso('2026-07-15', '22:00') }), task({ id: 'a', title: 'a', dueAt: iso('2026-07-15', '22:00') })], routines: [routine({ id: 'r', name: 'r', frequency: { type: 'weekdays' as const, weekdays: [3] } })], completions: [] };
    const one = buildPlanningResult(input); const two = buildPlanningResult(input);
    expect(one).toEqual(two);
    expect(one.proposedBlocks.filter((item) => item.source === 'task').map((item) => item.taskId)).toEqual(['a', 'b']);
  });

  it('期限なしTask複数をpriorityと安定IDで決定論的に並べる', () => {
    const result = buildPlanningResult({ now, events: [], tasks: [task({ id: 'z', title: 'z', priority: 2 }), task({ id: 'b', title: 'b', priority: 5 }), task({ id: 'a', title: 'a', priority: 5 })], routines: [], completions: [] });
    expect(result.proposedBlocks.filter((item) => item.source === 'task').map((item) => item.taskId)).toEqual(['a', 'b', 'z']);
  });

  it('複雑なTask/Routine競合でも全ブロックが重複しない', () => {
    const result = buildPlanningResult({ now, events: [event('meeting', iso('2026-07-15', '12:00'), iso('2026-07-15', '13:00'))], tasks: [task({ id: 't1', title: 't1', remainingMinutes: 180 }), task({ id: 't2', title: 't2', remainingMinutes: 90, priority: 5 })], routines: [routine({ id: 'r1', name: 'r1', frequency: { type: 'weekdays', weekdays: [3] }, availableStartTime: '10:00', availableEndTime: '12:00' }), routine({ id: 'r2', name: 'r2', frequency: { type: 'weekdays', weekdays: [3] } })], completions: [] });
    const blocks = [...result.proposedBlocks].sort((a, b) => a.start.localeCompare(b.start));
    for (let index = 1; index < blocks.length; index += 1) expect(new Date(blocks[index - 1].end) <= new Date(blocks[index].start)).toBe(true);
  });
});
