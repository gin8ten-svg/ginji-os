'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getCalendarConnection, getCalendars } from '@/lib/calendar/client';
import { getCloudPlanningCalendarEventPreview, PlanningClientError, writeCloudPlanningSessionToCalendar } from '@/lib/planning/client';
import type { GoogleCalendarSummary } from '@/types/calendar';
import type { CalendarEventWriteStatus, PlanningCalendarEventPreview, PlanningCalendarWriteResult } from '@/types/planning-session';

const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const eventKey = (event: { sourceType: string; sourceId: string; blockIndex: number; start: string }) => `${event.sourceType}:${event.sourceId}:${event.blockIndex}:${event.start}`;
const writeStatusText: Record<CalendarEventWriteStatus, string> = { created: '追加済み', already_created: '追加済み・再送なし', failed: '失敗・再試行可', in_progress: '別の処理で追加中', not_attempted: '未送信' };

export function CalendarEventPreview({ sessionId, onStale, onReplan }: { sessionId: string; onStale(): void; onReplan(): void }) {
  const [preview, setPreview] = useState<PlanningCalendarEventPreview | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [canWriteEvents, setCanWriteEvents] = useState(false);
  const [writeResult, setWriteResult] = useState<PlanningCalendarWriteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [requiresReapproval, setRequiresReapproval] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function loadPreview() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null); setCalendarError(null); setRequiresReapproval(false); setWriteResult(null);
    try {
      const nextPreview = await getCloudPlanningCalendarEventPreview(sessionId, controller.signal);
      if (controller.signal.aborted) return;
      setPreview(nextPreview);
      try {
        const connection = await getCalendarConnection(controller.signal);
        setCanWriteEvents(connection.canWriteEvents);
        if (!connection.connected || connection.needsReconnect) { setCalendars([]); setCalendarId(''); setCalendarError('Google Calendarを再接続してください。'); return; }
        const { calendars: available } = await getCalendars(controller.signal);
        const selected = available.filter((calendar) => calendar.selected);
        const writable = (selected.length ? selected : available.filter((calendar) => calendar.primary)).filter((calendar) => calendar.writable);
        setCalendars(writable); setCalendarId((current) => writable.some((calendar) => calendar.calendarId === current) ? current : writable[0]?.calendarId ?? '');
        if (!connection.canWriteEvents) setCalendarError('予定の追加権限がありません。Calendar画面から追加権限を許可してください。');
        else if (!writable.length) setCalendarError('計画時に読み取ったCalendarの中に、書き込み可能な追加先がありません。');
      } catch (cause) {
        if (!controller.signal.aborted) setCalendarError(cause instanceof Error ? cause.message : '追加先Calendarを確認できませんでした。');
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setPreview(null);
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') { setRequiresReapproval(true); onStale(); }
      setError(cause instanceof Error ? cause.message : 'Calendarプレビューを取得できませんでした。');
    } finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }

  async function writeToCalendar() {
    if (!preview || !calendarId || writing) return;
    setWriting(true); setError(null); setConfirming(false);
    try { setWriteResult(await writeCloudPlanningSessionToCalendar(sessionId, calendarId)); }
    catch (cause) {
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') { setRequiresReapproval(true); onStale(); }
      if (cause instanceof PlanningClientError && cause.code === 'CALENDAR_RECONNECT_REQUIRED') setCalendarError(cause.message);
      setError(cause instanceof Error ? cause.message : 'Google Calendarへ追加できませんでした。');
    } finally { setWriting(false); }
  }

  const selectedCalendar = calendars.find((calendar) => calendar.calendarId === calendarId) ?? null;
  const resultByEvent = new Map(writeResult?.events.map((event) => [eventKey(event), event.writeStatus]) ?? []);
  const retryable = Boolean(writeResult && writeResult.status !== 'completed');

  return <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4" aria-label="Google Calendar Event Preview">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-blue-950">Google Calendar追加内容</h4><p className="mt-1 text-sm text-blue-900">Previewと書き込み時の両方で、承認済み計画を最新データから再検証します。</p></div><button type="button" disabled={loading || writing} onClick={() => void loadPreview()} className="min-h-11 rounded-full bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{loading ? '再検証中…' : preview ? 'Previewを再検証' : '追加内容を確認'}</button></div>
    {error ? <div role="alert" className="mt-3 rounded-xl bg-white p-3 text-sm text-rose-700"><p>{error}</p>{requiresReapproval ? <button type="button" onClick={onReplan} className="mt-2 min-h-10 font-semibold underline">新しい計画案を作成</button> : null}</div> : null}
    {preview ? <div className="mt-4"><p role="status" className="rounded-xl bg-white p-3 text-sm font-medium text-blue-900">{preview.events.length}件を再検証しました。確認ボタンを押すまではGoogle Calendarへ追加しません。</p>
      {calendarError ? <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>{calendarError}</p>{!canWriteEvents ? <Link href="/calendar" className="mt-2 inline-flex min-h-10 items-center font-semibold underline">Calendar接続を確認</Link> : null}</div> : null}
      {calendars.length ? <label className="mt-3 block text-sm font-semibold text-blue-950">追加先Calendar<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={writing} className="mt-2 min-h-11 w-full rounded-xl border border-blue-200 bg-white px-3 font-normal text-slate-900 disabled:opacity-50">{calendars.map((calendar) => <option key={calendar.calendarId} value={calendar.calendarId}>{calendar.summary}{calendar.primary ? '（メイン）' : ''}</option>)}</select></label> : null}
      {writeResult ? <div role="status" className={`mt-3 rounded-xl p-3 text-sm ${writeResult.status === 'completed' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}><p className="font-semibold">{writeResult.status === 'completed' ? 'Google Calendarへの追加が完了しました。' : writeResult.status === 'partial' ? '一部を保存しました。失敗・処理中のblockだけ再試行できます。' : '追加は完了していません。失敗・処理中のblockを再試行できます。'}</p><p className="mt-1">新規 {writeResult.createdCount}件・送信済み {writeResult.alreadyCreatedCount}件・失敗 {writeResult.failedCount}件・処理中 {writeResult.inProgressCount}件・未送信 {writeResult.notAttemptedCount}件</p>{writeResult.needsReconnect ? <Link href="/calendar" className="mt-2 inline-flex min-h-10 items-center font-semibold underline">Google Calendarを再接続</Link> : null}</div> : null}
      {preview.events.length ? <div className="mt-3 space-y-2">{preview.events.map((event) => { const writeStatus = resultByEvent.get(eventKey(event)); return <article key={eventKey(event)} className="rounded-xl border border-blue-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{event.title}</p><div className="flex flex-wrap gap-1"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">{event.sourceType === 'routine' ? 'ルーティン' : event.blockIndex > 1 ? `タスク・分割${event.blockIndex}` : 'タスク'}</span>{writeStatus ? <span className={`rounded-full px-2 py-1 text-xs font-semibold ${writeStatus === 'created' || writeStatus === 'already_created' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{writeStatusText[writeStatus]}</span> : null}</div></div><p className="mt-1 text-sm text-slate-700">{dateTime(event.start)}〜{dateTime(event.end)}・{event.durationMinutes}分</p></article>; })}</div> : <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">追加予定のイベントはありません。</p>}
      {preview.events.length ? <button type="button" disabled={writing || !calendarId || !canWriteEvents} onClick={() => setConfirming(true)} className="mt-4 min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{writing ? 'Google Calendarへ追加中…' : retryable ? '失敗・未完了分を再試行' : `この${preview.events.length}件をGoogle Calendarに追加`}</button> : null}
    </div> : null}
    {confirming && preview && selectedCalendar ? <div role="dialog" aria-modal="true" aria-labelledby="calendar-write-title" onMouseDown={(event) => { if (!writing && event.target === event.currentTarget) setConfirming(false); }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"><h4 id="calendar-write-title" className="text-lg font-semibold">Google Calendarへ追加しますか？</h4><p className="mt-2 text-sm text-slate-700">「{selectedCalendar.summary}」へ{preview.events.length}件を追加します。書き込み直前に計画とCalendar権限を再検証します。</p><p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">一部だけ成功した場合、成功分は残し、失敗分だけ再試行します。既存予定の変更・削除は行いません。</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={writing} onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={writing} onClick={() => void writeToCalendar()} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{writing ? '追加中…' : '追加する'}</button></div></div></div> : null}
  </section>;
}
