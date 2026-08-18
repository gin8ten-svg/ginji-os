'use client';

import { useEffect, useState } from 'react';
import { getCloudPlanningExecutionReview } from '@/lib/planning/client';
import type { PlanningReview as PlanningReviewData } from '@/types/planning-session';

const weekday = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short', month: 'numeric', day: 'numeric' });

export function PlanningReview() {
  const [review, setReview] = useState<PlanningReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getCloudPlanningExecutionReview(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setReview(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '予定時間・実績時間を取得できませんでした。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">予定時間・実績時間を読み込み中…</p></section>;
  if (error) return <section className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-sm"><p role="alert" className="text-sm text-rose-700">{error}</p></section>;
  if (!review) return null;

  const totalPlanned = review.days.reduce((sum, day) => sum + day.plannedMinutes, 0);
  const totalActual = review.days.reduce((sum, day) => sum + day.actualMinutes, 0);
  const unrecorded = review.days.reduce((sum, day) => sum + (day.completedBlocks - day.recordedActualBlocks), 0);
  const hasBlocks = review.days.some((day) => day.totalBlocks > 0);

  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="今週の予定時間と実績時間">
    <h3 className="text-lg font-semibold">今週の予定時間と実績時間</h3>
    {!hasBlocks ? <p className="mt-2 text-sm text-slate-600">Google Calendarへ追加済みのタスクblockはまだありません。</p> : <>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-medium text-slate-500">予定時間の合計</p><p className="mt-1 text-2xl font-semibold text-slate-900">{totalPlanned}分</p></div>
        <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs font-medium text-emerald-700">実績時間の合計</p><p className="mt-1 text-2xl font-semibold text-emerald-800">{totalActual}分</p></div>
      </div>
      {unrecorded > 0 ? <p className="mt-2 text-sm text-slate-600">実績時間が未記録のblockが{unrecorded}件あります。</p> : null}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-7">{review.days.map((day) => <div key={day.date} className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{weekday.format(new Date(`${day.date}T12:00:00+09:00`))}</p><p className="mt-2 text-sm">予定 <strong>{day.plannedMinutes}</strong>分</p><p className="mt-1 text-sm text-emerald-700">実績 <strong>{day.actualMinutes}</strong>分</p></div>)}</div>
    </>}
  </section>;
}
