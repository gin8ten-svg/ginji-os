'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getCalendarConnection, getCalendars } from '@/lib/calendar/client';
import { deleteCloudPlanningSessionCalendarEvents, getCloudPlanningCalendarEventManagementPreview, getCloudPlanningCalendarEventPreview, PlanningClientError, updateCloudPlanningSessionCalendarEvents, writeCloudPlanningSessionToCalendar } from '@/lib/planning/client';
import type { GoogleCalendarSummary } from '@/types/calendar';
import type { CalendarEventMutationOperation, CalendarEventWriteStatus, PlanningCalendarEventManagementPreview, PlanningCalendarEventMutationResult, PlanningCalendarEventPreview, PlanningCalendarWriteResult } from '@/types/planning-session';

const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const eventKey = (event: { sourceType: string; sourceId: string; blockIndex: number; start: string }) => `${event.sourceType}:${event.sourceId}:${event.blockIndex}:${event.start}`;
const writeStatusText: Record<CalendarEventWriteStatus, string> = { created: '追加済み', already_created: '追加済み・再送なし', failed: '失敗・再試行可', in_progress: '別の処理で追加中', not_attempted: '未送信' };

export function CalendarEventPreview({ sessionId, onStale, onReplan }: { sessionId: string; onStale(): void; onReplan(): void }) {
  const [preview, setPreview] = useState<PlanningCalendarEventPreview | null>(null);
  const [managementPreview, setManagementPreview] = useState<PlanningCalendarEventManagementPreview | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [canWriteEvents, setCanWriteEvents] = useState(false);
  const [writeResult, setWriteResult] = useState<PlanningCalendarWriteResult | null>(null);
  const [mutationResult, setMutationResult] = useState<PlanningCalendarEventMutationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [managementAction, setManagementAction] = useState<CalendarEventMutationOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [requiresReapproval, setRequiresReapproval] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function loadPreview() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null); setCalendarError(null); setRequiresReapproval(false); setWriteResult(null); setMutationResult(null); setManagementPreview(null);
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
        const writableBase = (selected.length ? selected : available.filter((calendar) => calendar.primary)).filter((calendar) => calendar.writable);
        const managedTarget = nextPreview.calendarId ? available.find((calendar) => calendar.calendarId === nextPreview.calendarId && calendar.writable) : null;
        const writable = managedTarget && !writableBase.some((calendar) => calendar.calendarId === managedTarget.calendarId) ? [...writableBase, managedTarget] : writableBase;
        const managedTargetAvailable = !nextPreview.calendarId || writable.some((calendar) => calendar.calendarId === nextPreview.calendarId);
        setCalendars(writable); setCalendarId((current) => nextPreview.calendarId ? managedTargetAvailable ? nextPreview.calendarId : '' : writable.some((calendar) => calendar.calendarId === current) ? current : writable[0]?.calendarId ?? '');
        if (!connection.canWriteEvents) setCalendarError('予定の追加権限がありません。Calendar画面から追加権限を許可してください。');
        else if (!managedTargetAvailable) setCalendarError('作成済み予定のCalendarへ書き込めません。Calendarの選択と権限を確認してください。');
        else if (!writable.length) setCalendarError('計画時に読み取ったCalendarの中に、書き込み可能な追加先がありません。');
      } catch (cause) {
        if (!controller.signal.aborted) setCalendarError(cause instanceof Error ? cause.message : '追加先Calendarを確認できませんでした。');
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setPreview(null);
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') {
        setRequiresReapproval(true); onStale();
        try {
          const managed = await getCloudPlanningCalendarEventManagementPreview(sessionId, controller.signal);
          if (controller.signal.aborted) return;
          setManagementPreview(managed);
          const connection = await getCalendarConnection(controller.signal);
          setCanWriteEvents(connection.canWriteEvents);
          if (connection.connected && !connection.needsReconnect) {
            const { calendars: available } = await getCalendars(controller.signal);
            const target = available.find((calendar) => calendar.calendarId === managed.calendarId && calendar.writable);
            setCalendars(target ? [target] : []); setCalendarId(target?.calendarId ?? '');
            if (!target) setCalendarError('作成済み予定のCalendarへ書き込めません。Calendarの選択と権限を確認してください。');
          } else setCalendarError('Google Calendarを再接続してください。');
        } catch { /* 通常Previewのstale errorを優先して表示する */ }
      }
      setError(cause instanceof Error ? cause.message : 'Calendarプレビューを取得できませんでした。');
    } finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }

  async function writeToCalendar() {
    if (!preview || !calendarId || writing) return;
    setWriting(true); setError(null); setConfirming(false);
    try {
      const result = await writeCloudPlanningSessionToCalendar(sessionId, calendarId);
      setWriteResult(result);
      const successful = new Set(result.events.filter((event) => event.writeStatus === 'created' || event.writeStatus === 'already_created').map(eventKey));
      setPreview((current) => current ? { ...current, calendarId: result.calendarId, events: current.events.map((event) => successful.has(eventKey(event)) ? { ...event, calendarState: 'active' } : event) } : current);
    }
    catch (cause) {
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') { setRequiresReapproval(true); onStale(); }
      if (cause instanceof PlanningClientError && cause.code === 'CALENDAR_RECONNECT_REQUIRED') setCalendarError(cause.message);
      setError(cause instanceof Error ? cause.message : 'Google Calendarへ追加できませんでした。');
    } finally { setWriting(false); }
  }

  async function manageCalendarEvents(operation: CalendarEventMutationOperation) {
    if ((!preview && !managementPreview) || writing) return;
    setWriting(true); setError(null); setManagementAction(null);
    try {
      const result = operation === 'update' ? await updateCloudPlanningSessionCalendarEvents(sessionId) : await deleteCloudPlanningSessionCalendarEvents(sessionId);
      setMutationResult(result); setWriteResult(null);
      if (operation === 'delete') {
        const deleted = new Set(result.events.filter((event) => event.mutationStatus === 'deleted' || event.mutationStatus === 'already_deleted').map(eventKey));
        setPreview((current) => current ? { ...current, events: current.events.map((event) => deleted.has(eventKey(event)) ? { ...event, calendarState: 'deleted' } : event) } : current);
        setManagementPreview((current) => current ? { ...current, events: current.events.map((event) => deleted.has(eventKey(event)) ? { ...event, calendarState: 'deleted' } : event) } : current);
      }
    } catch (cause) {
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') { setRequiresReapproval(true); onStale(); }
      if (cause instanceof PlanningClientError && cause.code === 'CALENDAR_RECONNECT_REQUIRED') setCalendarError(cause.message);
      setError(cause instanceof Error ? cause.message : 'Google Calendar予定を管理できませんでした。');
    } finally { setWriting(false); }
  }

  const displayedPreview = preview ?? managementPreview;
  const selectedCalendar = calendars.find((calendar) => calendar.calendarId === calendarId) ?? null;
  const resultByEvent = new Map(writeResult?.events.map((event) => [eventKey(event), event.writeStatus]) ?? []);
  const retryable = Boolean(writeResult && writeResult.status !== 'completed');
  const activeCount = displayedPreview?.events.filter((event) => event.calendarState === 'active').length ?? 0;
  const addableCount = preview?.events.filter((event) => event.calendarState !== 'active' && event.calendarState !== 'deleted').length ?? 0;

  return <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4" aria-label="Google Calendar Event Preview">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-blue-950">Google Calendar追加内容</h4><p className="mt-1 text-sm text-blue-900">Previewと書き込み時の両方で、承認済み計画を最新データから再検証します。</p></div><button type="button" disabled={loading || writing} onClick={() => void loadPreview()} className="min-h-11 rounded-full bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{loading ? '再検証中…' : preview ? 'Previewを再検証' : '追加内容を確認'}</button></div>
    {error ? <div role="alert" className="mt-3 rounded-xl bg-white p-3 text-sm text-rose-700"><p>{error}</p>{requiresReapproval ? <button type="button" onClick={onReplan} className="mt-2 min-h-10 font-semibold underline">新しい計画案を作成</button> : null}</div> : null}
    {displayedPreview ? <div className="mt-4"><p role="status" className="rounded-xl bg-white p-3 text-sm font-medium text-blue-900">{displayedPreview.events.length}件を再検証しました。確認ボタンを押すまではGoogle Calendarへ変更を送りません。</p>
      {calendarError ? <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>{calendarError}</p>{!canWriteEvents ? <Link href="/calendar" className="mt-2 inline-flex min-h-10 items-center font-semibold underline">Calendar接続を確認</Link> : null}</div> : null}
      {calendars.length ? <label className="mt-3 block text-sm font-semibold text-blue-950">追加先Calendar<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={writing || Boolean(displayedPreview.calendarId)} className="mt-2 min-h-11 w-full rounded-xl border border-blue-200 bg-white px-3 font-normal text-slate-900 disabled:opacity-50">{calendars.map((calendar) => <option key={calendar.calendarId} value={calendar.calendarId}>{calendar.summary}{calendar.primary ? '（メイン）' : ''}</option>)}</select></label> : null}
      {writeResult ? <div role="status" className={`mt-3 rounded-xl p-3 text-sm ${writeResult.status === 'completed' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}><p className="font-semibold">{writeResult.status === 'completed' ? 'Google Calendarへの追加が完了しました。' : writeResult.status === 'partial' ? '一部を保存しました。失敗・処理中のblockだけ再試行できます。' : '追加は完了していません。失敗・処理中のblockを再試行できます。'}</p><p className="mt-1">新規 {writeResult.createdCount}件・送信済み {writeResult.alreadyCreatedCount}件・失敗 {writeResult.failedCount}件・処理中 {writeResult.inProgressCount}件・未送信 {writeResult.notAttemptedCount}件</p>{writeResult.needsReconnect ? <Link href="/calendar" className="mt-2 inline-flex min-h-10 items-center font-semibold underline">Google Calendarを再接続</Link> : null}</div> : null}
      {mutationResult ? <div role="status" className={`mt-3 rounded-xl p-3 text-sm ${mutationResult.status === 'completed' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}><p className="font-semibold">{mutationResult.status === 'completed' ? mutationResult.operation === 'update' ? 'Google Calendar予定の再同期処理が完了しました。' : 'Google Calendar予定の削除処理が完了しました。' : '一部のGoogle Calendar予定を処理できませんでした。失敗分だけ再試行できます。'}</p><p className="mt-1">変更 {mutationResult.changedCount}件・変更不要 {mutationResult.unchangedCount}件・失敗 {mutationResult.failedCount}件・処理中 {mutationResult.inProgressCount}件・未処理 {mutationResult.notAttemptedCount}件</p>{mutationResult.needsReconnect ? <Link href="/calendar" className="mt-2 inline-flex min-h-10 items-center font-semibold underline">Google Calendarを再接続</Link> : null}</div> : null}
      {displayedPreview.events.length ? <div className="mt-3 space-y-2">{displayedPreview.events.map((event) => { const writeStatus = resultByEvent.get(eventKey(event)); const savedState = event.calendarState === 'active' ? '追加済み' : event.calendarState === 'deleted' ? '削除済み' : null; return <article key={eventKey(event)} className="rounded-xl border border-blue-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{event.title}</p><div className="flex flex-wrap gap-1"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">{event.sourceType === 'routine' ? 'ルーティン' : event.blockIndex > 1 ? `タスク・分割${event.blockIndex}` : 'タスク'}</span>{writeStatus ? <span className={`rounded-full px-2 py-1 text-xs font-semibold ${writeStatus === 'created' || writeStatus === 'already_created' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{writeStatusText[writeStatus]}</span> : savedState ? <span className={`rounded-full px-2 py-1 text-xs font-semibold ${event.calendarState === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{savedState}</span> : null}</div></div><p className="mt-1 text-sm text-slate-700">{dateTime(event.start)}〜{dateTime(event.end)}・{event.durationMinutes}分</p></article>; })}</div> : <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">追加予定のイベントはありません。</p>}
      <div className="mt-4 flex flex-wrap gap-2">{addableCount ? <button type="button" disabled={writing || !calendarId || !canWriteEvents} onClick={() => setConfirming(true)} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{writing ? 'Google Calendarへ処理中…' : retryable ? '失敗・未完了分を再試行' : `この${addableCount}件をGoogle Calendarに追加`}</button> : null}{activeCount && !requiresReapproval ? <button type="button" disabled={writing || !canWriteEvents} onClick={() => setManagementAction('update')} className="min-h-11 rounded-full bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{activeCount}件をcanonical内容へ再同期</button> : null}{activeCount ? <button type="button" disabled={writing || !canWriteEvents} onClick={() => setManagementAction('delete')} className="min-h-11 rounded-full bg-rose-50 px-4 font-semibold text-rose-700 disabled:opacity-50">{activeCount}件をGoogle Calendarから削除</button> : null}</div>
    </div> : null}
    {confirming && preview && selectedCalendar ? <div role="dialog" aria-modal="true" aria-labelledby="calendar-write-title" onMouseDown={(event) => { if (!writing && event.target === event.currentTarget) setConfirming(false); }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"><h4 id="calendar-write-title" className="text-lg font-semibold">Google Calendarへ追加しますか？</h4><p className="mt-2 text-sm text-slate-700">「{selectedCalendar.summary}」へ{addableCount}件を追加します。書き込み直前に計画とCalendar権限を再検証します。</p><p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">一部だけ成功した場合、成功分は残し、失敗分だけ再試行します。既存予定の変更・削除は行いません。</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={writing} onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={writing} onClick={() => void writeToCalendar()} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{writing ? '追加中…' : '追加する'}</button></div></div></div> : null}
    {managementAction && selectedCalendar ? <div role="dialog" aria-modal="true" aria-labelledby="calendar-management-title" onMouseDown={(event) => { if (!writing && event.target === event.currentTarget) setManagementAction(null); }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"><h4 id="calendar-management-title" className="text-lg font-semibold">{managementAction === 'update' ? '作成済み予定を再同期しますか？' : '作成済み予定を削除しますか？'}</h4><p className="mt-2 text-sm text-slate-700">「{selectedCalendar.summary}」のGinji OS作成予定{activeCount}件が対象です。操作直前に所有マーカーと最新ETagを再確認します。</p><p className={`mt-3 rounded-xl p-3 text-sm ${managementAction === 'delete' ? 'bg-rose-50 text-rose-800' : 'bg-blue-50 text-blue-900'}`}>{managementAction === 'update' ? '保存済みsnapshotのtitle・開始・終了だけへ戻します。任意の値は送信しません。' : 'Google Calendarから削除します。この操作はGinji OS上で元に戻せません。再追加には新しい計画案の作成・承認が必要です。'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={writing} onClick={() => setManagementAction(null)} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={writing} onClick={() => void manageCalendarEvents(managementAction)} className={`min-h-11 rounded-full px-4 font-semibold text-white disabled:opacity-50 ${managementAction === 'delete' ? 'bg-rose-700' : 'bg-blue-700'}`}>{writing ? '処理中…' : managementAction === 'update' ? '再同期する' : '削除する'}</button></div></div></div> : null}
  </section>;
}
