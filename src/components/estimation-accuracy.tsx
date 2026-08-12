'use client';

import { useEffect, useState } from 'react';
import { getCloudPlanningEstimationAccuracy } from '@/lib/planning/client';
import type { EstimationAccuracySummary } from '@/types/planning-session';

export function EstimationAccuracy() {
  const [summary, setSummary] = useState<EstimationAccuracySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getCloudPlanningEstimationAccuracy(30, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setSummary(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '見積もり誤差を取得できませんでした。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">見積もり誤差を読み込み中…</p></section>;
  if (error) return <section className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-sm"><p role="alert" className="text-sm text-rose-700">{error}</p></section>;
  if (!summary) return null;

  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="見積もり誤差（概算）">
    <h3 className="text-lg font-semibold">見積もり誤差（直近{summary.rangeDays}日・概算）</h3>
    {summary.sampleSize === 0 ? <p className="mt-2 text-sm text-slate-600">実績時間を記録した完了タスクがまだありません。</p> : <>
      <p className="mt-1 text-sm text-slate-600">対象タスク {summary.sampleSize}件・予定 {summary.totalPlannedMinutes}分・実績 {summary.totalActualMinutes}分</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-medium text-slate-500">平均誤差</p><p className="mt-1 text-2xl font-semibold text-slate-900">{summary.averageVarianceMinutes > 0 ? '+' : ''}{summary.averageVarianceMinutes}分</p>{summary.averageVariancePercent !== null ? <p className="mt-1 text-xs text-slate-500">予定比 {summary.averageVariancePercent > 0 ? '+' : ''}{summary.averageVariancePercent}%</p> : null}</div>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm"><p>見積もりより長くかかった: <strong>{summary.underEstimatedCount}</strong>件</p><p className="mt-1">見積もりより短く済んだ: <strong>{summary.overEstimatedCount}</strong>件</p><p className="mt-1">ほぼ一致: <strong>{summary.accurateCount}</strong>件</p></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">実行blockのstart/endから算出した予定時間との差分による概算値です。正式な見積もり分析ではありません。</p>
      <ul className="mt-3 space-y-2">{summary.items.map((item) => <li key={item.taskId} className="rounded-xl border border-slate-200 p-3"><p className="font-semibold">{item.title}</p><p className="mt-1 text-sm text-slate-600">予定 {item.plannedMinutes}分・実績 {item.actualMinutes}分・誤差 {item.varianceMinutes > 0 ? '+' : ''}{item.varianceMinutes}分</p></li>)}</ul>
    </>}
  </section>;
}
