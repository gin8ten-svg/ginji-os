'use client';

import { useEffect, useRef, useState } from 'react';
import { getCloudPlanningCalendarEventPreview, PlanningClientError } from '@/lib/planning/client';
import type { PlanningCalendarEventPreview } from '@/types/planning-session';

const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function CalendarEventPreview({ sessionId, onStale, onReplan }: { sessionId: string; onStale(): void; onReplan(): void }) {
  const [preview, setPreview] = useState<PlanningCalendarEventPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresReapproval, setRequiresReapproval] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function loadPreview() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null); setRequiresReapproval(false);
    try { setPreview(await getCloudPlanningCalendarEventPreview(sessionId, controller.signal)); }
    catch (cause) {
      if (controller.signal.aborted) return;
      setPreview(null);
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') { setRequiresReapproval(true); onStale(); }
      setError(cause instanceof Error ? cause.message : 'Calendarプレビューを取得できませんでした。');
    } finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  }

  return <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4" aria-label="Google Calendar Event Preview">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-blue-950">Google Calendar追加内容</h4><p className="mt-1 text-sm text-blue-900">読み取り専用プレビューです。Googleへ予定を送信しません。</p></div><button type="button" disabled={loading} onClick={() => void loadPreview()} className="min-h-11 rounded-full bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{loading ? '再検証中…' : preview ? '再検証する' : '追加内容を確認'}</button></div>
    {error ? <div role="alert" className="mt-3 rounded-xl bg-white p-3 text-sm text-rose-700"><p>{error}</p>{requiresReapproval ? <button type="button" onClick={onReplan} className="mt-2 min-h-10 font-semibold underline">新しい計画案を作成</button> : null}</div> : null}
    {preview ? <div className="mt-4"><p role="status" className="rounded-xl bg-white p-3 text-sm font-medium text-blue-900">{preview.events.length}件を再検証しました。以下はまだGoogle Calendarに追加されていません。</p>{preview.events.length ? <div className="mt-3 space-y-2">{preview.events.map((event) => <article key={`${event.sourceType}:${event.sourceId}:${event.blockIndex}:${event.start}`} className="rounded-xl border border-blue-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{event.title}</p><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">{event.sourceType === 'routine' ? 'ルーティン' : event.blockIndex > 1 ? `タスク・分割${event.blockIndex}` : 'タスク'}</span></div><p className="mt-1 text-sm text-slate-700">{dateTime(event.start)}〜{dateTime(event.end)}・{event.durationMinutes}分</p></article>)}</div> : <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">追加予定のイベントはありません。</p>}</div> : null}
  </section>;
}
