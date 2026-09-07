'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getCalendarConnection, getCalendarEvents } from '@/lib/calendar/client';
import { shiftTokyoDate } from '@/lib/date-time';
import { buildTodayView, type TodayView } from '@/lib/today';
import type { ExternalCalendarEvent } from '@/types/calendar';
import type { TaskStore } from '@/types/tasks';

const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function TodayNow({ store, today, isAuthenticated }: { store: TaskStore; today: string; isAuthenticated: boolean }) {
  const now = useNow();
  const [events, setEvents] = useState<ExternalCalendarEvent[]>([]);
  const [calendarActive, setCalendarActive] = useState(false);
  const [calendarError, setCalendarError] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || loadedRef.current) return;
    loadedRef.current = true;
    const controller = new AbortController();
    const timeMin = new Date(`${today}T00:00:00+09:00`).toISOString();
    const timeMax = new Date(`${shiftTokyoDate(today, 1)}T00:00:00+09:00`).toISOString();
    void (async () => {
      try {
        const connection = await getCalendarConnection(controller.signal);
        if (!connection.connected || connection.needsReconnect) return;
        const result = await getCalendarEvents(timeMin, timeMax, controller.signal);
        if (controller.signal.aborted) return;
        setEvents(result.events);
        setCalendarActive(true);
      } catch {
        if (!controller.signal.aborted) setCalendarError(true);
      }
    })();
    return () => controller.abort();
  }, [isAuthenticated, today]);

  const view: TodayView = useMemo(
    () => buildTodayView({ now, today, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions, events }),
    [now, today, store.tasks, store.routines, store.routineCompletions, events],
  );

  const nowLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(now);
  const showCalendarSections = calendarActive || view.timeline.length > 0 || view.allDayEvents.length > 0;

  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="いまの状況">
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-lg font-semibold">いまの時間帯</h3>
      <span className="text-sm font-semibold tabular-nums text-slate-500">{nowLabel}・Asia/Tokyo</span>
    </div>

    {view.currentEvent ? (
      <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-semibold text-blue-700">進行中の予定</p>
        <p className="mt-1 break-words font-semibold text-blue-950">{view.currentEvent.title}</p>
        <p className="mt-1 text-sm text-blue-900">{time(view.currentEvent.start)}〜{time(view.currentEvent.end)}</p>
      </div>
    ) : view.suggestion ? (
      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-xs font-semibold text-emerald-700">固定予定がない時間です。取り組むなら</p>
        <p className="mt-1 break-words font-semibold text-emerald-950">{view.suggestion.title}</p>
        <p className="mt-1 text-sm text-emerald-900">{view.suggestion.reason}・約{view.suggestion.minutes}分</p>
      </div>
    ) : (
      <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">いま取り組む必要がある項目はありません。</p>
    )}

    {showCalendarSections ? <>
      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-500">次の予定</p>
        {view.nextEvent
          ? <p className="mt-1 text-sm"><span className="font-semibold tabular-nums">{time(view.nextEvent.start)}</span> {view.nextEvent.title}</p>
          : <p className="mt-1 text-sm text-slate-500">この先、今日の固定予定はありません。</p>}
      </div>

      {view.allDayEvents.length ? <ul className="mt-2 flex flex-wrap gap-2">{view.allDayEvents.map((event) => <li key={event.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">終日・{event.title}</li>)}</ul> : null}

      {view.timeline.length ? <div className="mt-3">
        <p className="text-xs font-semibold text-slate-500">今日の残りのタイムライン</p>
        <ol className="mt-2 space-y-2">{view.timeline.map((event) => <li key={event.id} className={`rounded-2xl border p-3 ${event.state === 'now' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold tabular-nums">{time(event.start)}〜{time(event.end)}</span>
            {event.state === 'now' ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">進行中</span> : null}
          </div>
          <p className="mt-1 break-words text-sm">{event.title}</p>
          {event.htmlLink ? <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold text-blue-700">Google Calendarで開く</a> : null}
        </li>)}</ol>
      </div> : null}
    </> : null}

    {calendarError ? <p role="status" className="mt-3 text-xs text-slate-500">Google Calendarの予定を取得できませんでした。カレンダー画面で接続を確認できます。</p> : null}
  </section>;
}
