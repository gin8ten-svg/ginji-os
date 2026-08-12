'use client';

import { useEffect, useState } from 'react';
import { getCloudPlanningDailyReview } from '@/lib/planning/client';
import { shiftTokyoDate, tokyoDateKey } from '@/lib/date-time';
import type { PlanningDailyReview, PlanningDailyReviewBlock } from '@/types/planning-session';

const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateLabel = (date: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full' }).format(new Date(`${date}T12:00:00+09:00`));
const statusLabel: Record<PlanningDailyReviewBlock['status'], string> = { approved: '未完了', in_progress: '未完了', completed: '完了', skipped: 'スキップ' };
const skipReasonLabel: Record<'user_skipped' | 'carried_over', string> = { user_skipped: 'スキップ', carried_over: '持ち越し' };

export function PlanningDailyReviewCard() {
  const [date, setDate] = useState(() => tokyoDateKey());
  const [review, setReview] = useState<PlanningDailyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getCloudPlanningDailyReview(date, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setReview(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '日次振り返りを取得できませんでした。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date]);

  function goTo(next: string) { setDate(next); setLoading(true); setError(null); }

  const today = tokyoDateKey();
  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="日次振り返り">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">日次振り返り</h3>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => goTo(shiftTokyoDate(date, -1))} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700" aria-label="前日">前日</button>
        <button type="button" disabled={date === today} onClick={() => goTo(today)} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">今日</button>
        <button type="button" onClick={() => goTo(shiftTokyoDate(date, 1))} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700" aria-label="翌日">翌日</button>
      </div>
    </div>
    <p className="mt-1 text-sm text-slate-600">{dateLabel(date)}</p>
    {loading ? <p className="mt-3 text-sm text-slate-600">読み込み中…</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    {!loading && review && review.blocks.length === 0 ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">この日にGoogle Calendarへ追加済みのタスクblockはありません。</p> : null}
    {!loading && review && review.blocks.length > 0 ? <>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-emerald-50 p-2"><p className="text-xs font-medium text-emerald-700">完了</p><p className="mt-1 text-xl font-semibold text-emerald-800">{review.summary.completed}</p></div>
        <div className="rounded-2xl bg-slate-100 p-2"><p className="text-xs font-medium text-slate-600">スキップ・持ち越し</p><p className="mt-1 text-xl font-semibold text-slate-800">{review.summary.skipped}</p></div>
        <div className="rounded-2xl bg-amber-50 p-2"><p className="text-xs font-medium text-amber-700">未対応</p><p className="mt-1 text-xl font-semibold text-amber-800">{review.summary.pending}</p></div>
      </div>
      <p className="mt-2 text-sm text-slate-600">予定 {review.summary.plannedMinutes}分・実績 {review.summary.actualMinutes}分</p>
      <ul className="mt-3 space-y-2">{review.blocks.map((block) => <li key={`${block.taskId}-${block.start}`} className="rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className={`font-semibold ${block.status !== 'approved' && block.status !== 'in_progress' ? 'text-slate-500' : ''}`}>{block.title}</p><p className="mt-1 text-sm text-slate-600">{time(block.start)}〜{time(block.end)}・予定 {block.plannedMinutes}分</p></div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{block.status === 'skipped' && block.statusReason ? skipReasonLabel[block.statusReason] : statusLabel[block.status]}</span>
        </div>
        {block.actualMinutes !== null ? <p className="mt-2 text-sm font-medium text-emerald-800">実績 {block.actualMinutes}分</p> : null}
      </li>)}</ul>
    </> : null}
  </section>;
}
