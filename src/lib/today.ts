import { classifyTask, isRoutineScheduled, tokyoDateKey } from '@/lib/date-time';
import { todayDashboardTasks } from '@/lib/practical-mvp';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { Routine, RoutineCompletion, Task } from '@/types/tasks';

export interface TodayTimelineEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  htmlLink: string | null;
  /** `now` はいま進行中、`upcoming` はこの先に始まる予定。 */
  state: 'now' | 'upcoming';
}

export interface TodayAllDayEvent {
  id: string;
  title: string;
  htmlLink: string | null;
}

export interface TodaySuggestion {
  kind: 'task' | 'routine';
  id: string;
  title: string;
  /** なぜこれを勧めるか（例: 期限超過 / 今日締切 / 今日のルーティン）。 */
  reason: string;
  minutes: number;
}

export interface TodayProgress {
  doneCount: number;
  totalCount: number;
  /** 0〜100 の整数。対象が無い場合は 0。 */
  percent: number;
  /** 今日締切の未完了タスク + 今日の未完了ルーティンの残り時間合計（分）。 */
  remainingMinutes: number;
}

export interface TodayView {
  /** いまの時間帯に進行中の固定予定（Google Calendar）。 */
  currentEvent: TodayTimelineEvent | null;
  /** 次に始まる固定予定。 */
  nextEvent: TodayTimelineEvent | null;
  /** 終了時刻が現在より後の固定予定を開始順に並べたもの。 */
  timeline: TodayTimelineEvent[];
  allDayEvents: TodayAllDayEvent[];
  progress: TodayProgress;
  /** 進行中の固定予定が無いときに「次にやるとよいこと」。 */
  suggestion: TodaySuggestion | null;
}

function timedEventsAfter(events: readonly ExternalCalendarEvent[], nowMs: number): Array<ExternalCalendarEvent & { startMs: number; endMs: number }> {
  return events
    .filter((event) => !event.allDay)
    .map((event) => ({ ...event, startMs: new Date(event.start).getTime(), endMs: new Date(event.end).getTime() }))
    .filter((event) => Number.isFinite(event.startMs) && Number.isFinite(event.endMs) && event.startMs < event.endMs && event.endMs > nowMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
}

export function buildTodayView(input: {
  now: Date;
  today: string;
  tasks: readonly Task[];
  routines: readonly Routine[];
  completions: readonly RoutineCompletion[];
  events: readonly ExternalCalendarEvent[];
}): TodayView {
  const nowMs = input.now.getTime();
  const timed = timedEventsAfter(input.events, nowMs);
  const toTimelineEvent = (event: (typeof timed)[number]): TodayTimelineEvent => ({
    id: `${event.calendarId}:${event.id}`,
    title: event.title,
    start: event.start,
    end: event.end,
    htmlLink: event.htmlLink,
    state: event.startMs <= nowMs ? 'now' : 'upcoming',
  });

  const currentSource = timed.find((event) => event.startMs <= nowMs && nowMs < event.endMs) ?? null;
  const nextSource = timed.find((event) => event.startMs > nowMs) ?? null;

  const allDaySeen = new Set<string>();
  const allDayEvents: TodayAllDayEvent[] = [];
  for (const event of input.events) {
    if (!event.allDay) continue;
    const id = `${event.calendarId}:${event.id}`;
    if (allDaySeen.has(id)) continue;
    allDaySeen.add(id);
    allDayEvents.push({ id, title: event.title, htmlLink: event.htmlLink });
  }

  const dueTodayTasks = input.tasks.filter((task) => task.dueAt && tokyoDateKey(new Date(task.dueAt)) === input.today);
  const scheduledRoutines = input.routines.filter((routine) => isRoutineScheduled(routine, input.today));
  const completedRoutineIds = new Set(input.completions.filter((item) => item.date === input.today).map((item) => item.routineId));

  const doneCount = dueTodayTasks.filter((task) => task.completedAt).length
    + scheduledRoutines.filter((routine) => completedRoutineIds.has(routine.id)).length;
  const totalCount = dueTodayTasks.length + scheduledRoutines.length;
  const remainingMinutes = dueTodayTasks.filter((task) => !task.completedAt).reduce((sum, task) => sum + Math.max(0, task.remainingMinutes), 0)
    + scheduledRoutines.filter((routine) => !completedRoutineIds.has(routine.id)).reduce((sum, routine) => sum + routine.estimatedMinutes, 0);

  let suggestion: TodaySuggestion | null = null;
  if (!currentSource) {
    const topTask = todayDashboardTasks([...input.tasks], input.today)[0];
    if (topTask) {
      suggestion = {
        kind: 'task',
        id: topTask.id,
        title: topTask.title,
        reason: classifyTask(topTask, input.today) === 'overdue' ? '期限超過' : '今日締切',
        minutes: Math.max(0, topTask.remainingMinutes),
      };
    } else {
      const topRoutine = [...scheduledRoutines]
        .filter((routine) => !completedRoutineIds.has(routine.id))
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];
      if (topRoutine) {
        suggestion = { kind: 'routine', id: topRoutine.id, title: topRoutine.name, reason: '今日のルーティン', minutes: topRoutine.estimatedMinutes };
      }
    }
  }

  return {
    currentEvent: currentSource ? toTimelineEvent(currentSource) : null,
    nextEvent: nextSource ? toTimelineEvent(nextSource) : null,
    timeline: timed.map(toTimelineEvent),
    allDayEvents,
    progress: { doneCount, totalCount, percent: totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100), remainingMinutes },
    suggestion,
  };
}
