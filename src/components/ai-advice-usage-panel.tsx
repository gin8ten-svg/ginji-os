'use client';

import { useEffect, useState } from 'react';
import { getCloudAiAdviceUsage } from '@/lib/planning/client';
import type { AiAdviceUsageSummary } from '@/types/planning-session';

const monthLabel = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long' }).format(new Date(value));
const usd = (value: number) => `$${value.toFixed(4)}`;

export function AiAdviceUsagePanel() {
  const [summary, setSummary] = useState<AiAdviceUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getCloudAiAdviceUsage(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setSummary(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI利用状況を取得できませんでした。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-600">AI利用状況を読み込み中…</p></section>;
  if (error) return <section className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-sm"><p role="alert" className="text-sm text-rose-700">{error}</p></section>;
  if (!summary) return null;

  const progress = summary.monthlyCallLimit ? Math.min(100, Math.round((summary.totalCalls / summary.monthlyCallLimit) * 100)) : null;

  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="AI利用状況（概算）">
    <h3 className="text-lg font-semibold">AI利用状況（{monthLabel(summary.monthStart)}・概算）</h3>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">相談回数</p><p className="mt-1 text-2xl font-semibold text-slate-900">{summary.totalCalls}</p></div>
      <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">成功</p><p className="mt-1 text-2xl font-semibold text-emerald-800">{summary.successfulCalls}</p></div>
      <div className="rounded-2xl bg-rose-50 p-3"><p className="text-xs text-rose-700">失敗</p><p className="mt-1 text-2xl font-semibold text-rose-800">{summary.failedCalls}</p></div>
      <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">概算コスト</p><p className="mt-1 text-2xl font-semibold text-slate-900">{usd(summary.estimatedCostUsd)}</p></div>
    </div>
    <p className="mt-2 text-xs text-slate-500">入力{summary.totalInputTokens.toLocaleString('ja-JP')}トークン・出力{summary.totalOutputTokens.toLocaleString('ja-JP')}トークン。コストは単価定数による概算で、実際の請求額とは一致しません。</p>
    {summary.monthlyCallLimit !== null ? <div className="mt-4">
      <div className="flex items-center justify-between text-xs text-slate-500"><span>月間目安 {summary.totalCalls} / {summary.monthlyCallLimit}回</span>{summary.nearMonthlyLimit ? <span className="font-semibold text-amber-700">上限に近づいています</span> : null}</div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${summary.nearMonthlyLimit ? 'bg-amber-500' : 'bg-cyan-600'}`} style={{ width: `${progress}%` }} /></div>
    </div> : null}
  </section>;
}
