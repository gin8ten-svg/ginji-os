'use client';

import { useState } from 'react';
import { getCalendarConnection, getCalendarEvents } from '@/lib/calendar/client';
import { buildPlanningResult, createPlanningWindow } from '@/lib/planner/engine';
import { tokyoDateKey } from '@/lib/date-time';
import type { PlanningResult, ProposedTimeBlock } from '@/types/planning';
import type { TaskStore } from '@/types/tasks';
import type { ExternalCalendarEvent } from '@/types/calendar';

const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dateLabel = (date: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T12:00:00+09:00`));

export function PlannerPanel({ store }: { store: TaskStore }) {
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calculate() {
    setLoading(true); setError(null);
    try {
      const now = new Date();
      const window = createPlanningWindow(now);
      let events: ExternalCalendarEvent[] = [];
      try {
        const connection = await getCalendarConnection();
        if (connection.needsReconnect) throw new Error('Google Calendarを再接続してから計画案を作成してください。');
        if (!connection.connected) throw new Error('Google Calendarを接続してから計画案を作成してください。');
        events = (await getCalendarEvents(window.start, window.end)).events;
      } catch (calendarError) {
        if (!(calendarError instanceof Error) || calendarError.message !== '認証が必要です。') throw calendarError;
      }
      setResult(buildPlanningResult({ now, events, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions }));
    } catch (calculationError) {
      setError(calculationError instanceof Error ? calculationError.message : '計画案を作成できませんでした。');
    } finally { setLoading(false); }
  }

  const days = result?.window.dates.map((date) => ({
    date,
    blocks: result.proposedBlocks.filter((block) => tokyoDateKey(new Date(block.start)) === date),
    fixed: result.busyIntervals.filter((item) => item.source === 'google' && new Date(item.end) > new Date(`${date}T00:00:00+09:00`) && new Date(item.start) < new Date(`${date}T23:59:59+09:00`)),
  })) ?? [];

  return <section className="rounded-3xl border border-cyan-200 bg-white p-4 shadow-sm" aria-label="7日間の計画案">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">7日間の計画案</h3><p className="mt-1 text-sm text-slate-600">8:00〜22:00の空き時間へ、ルーティンとタスクを決定論的に配置します。</p></div><button type="button" disabled={loading} onClick={() => void calculate()} className="min-h-11 rounded-full bg-cyan-700 px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50">{loading ? '計算中…' : result ? '再計算' : '7日間の計画案を作成'}</button></div>
    <p className="mt-2 text-xs font-medium text-cyan-800">確認用の案です。Google Calendarへの追加・変更は行いません。</p>
    {error ? <div role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p><button type="button" onClick={() => void calculate()} className="mt-2 min-h-10 font-semibold underline">再試行</button></div> : null}
    {result ? <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="配置ブロック" value={`${result.proposedBlocks.length}件`} /><Metric label="Google予定" value={`${result.busyIntervals.filter((item) => item.source === 'google').length}区間`} /><Metric label="残り空き枠" value={`${result.freeSlots.length}枠`} /><Metric label="未配置" value={`${result.unscheduledTasks.length}件`} /></div>
      <div className="grid gap-3 lg:grid-cols-2">{days.map(({ date, blocks, fixed }) => <section key={date} className="rounded-2xl border border-slate-200 p-3"><h4 className="font-semibold">{dateLabel(date)}</h4>{fixed.length || blocks.length ? <div className="mt-2 space-y-2">{fixed.map((item) => <article key={`${item.sourceId}:${item.start}`} className="rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{item.title}</p><span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-semibold text-blue-700">Google予定・固定</span></div><p className="mt-1 text-sm text-slate-700">{time(item.start)}〜{time(item.end)}</p></article>)}{blocks.map((block) => <Block key={block.id} block={block} />)}</div> : <p className="mt-2 text-sm text-slate-500">予定と配置案はありません。</p>}</section>)}</div>
      {result.unscheduledTasks.length ? <section className="rounded-2xl bg-amber-50 p-4"><h4 className="font-semibold text-amber-900">配置できなかったタスク</h4><ul className="mt-2 space-y-2">{result.unscheduledTasks.map((task) => <li key={task.taskId} className="text-sm text-amber-900"><span className="font-semibold">{task.title}</span> — 残り{task.remainingMinutes}分・{task.reason}</li>)}</ul></section> : null}
    </div> : null}
  </section>;
}

function Block({ block }: { block: ProposedTimeBlock }) {
  const minutes = Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000);
  return <article className={`rounded-xl border p-3 ${block.source === 'routine' ? 'border-violet-200 bg-violet-50' : 'border-cyan-200 bg-cyan-50'}`}><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{block.title}</p><span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-semibold">{block.source === 'routine' ? 'ルーティン' : block.splitIndex > 1 ? `タスク・分割${block.splitIndex}` : 'タスク'}</span></div><p className="mt-1 text-sm text-slate-700">{time(block.start)}〜{time(block.end)}・{minutes}分</p></article>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
