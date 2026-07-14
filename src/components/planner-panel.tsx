'use client';

import { useEffect, useRef, useState } from 'react';
import { getCalendarConnection, getCalendarEvents } from '@/lib/calendar/client';
import { buildPlanningResult, createPlanningWindow } from '@/lib/planner/engine';
import { PlanningRequestCoordinator, resolvePlanningCalendarInput } from '@/lib/planner/calendar-input';
import { approveCloudPlanningSession, createCloudPlanningSession, getCloudPlanningSession, listCloudPlanningSessions, PlanningClientError, rejectCloudPlanningSession } from '@/lib/planning/client';
import { tokyoDateKey } from '@/lib/date-time';
import type { PlanningResult, ProposedTimeBlock } from '@/types/planning';
import type { PlanningSessionDetail, PlanningSessionStatus } from '@/types/planning-session';
import type { TaskStore } from '@/types/tasks';

const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const fullDate = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const statusText: Record<PlanningSessionStatus, string> = { draft: '下書き', approved: '承認済み', rejected: '却下済み', superseded: '更新済み' };

function localDetail(result: PlanningResult): PlanningSessionDetail {
  return { sessionId: 'local', status: 'draft', windowStart: result.window.start, windowEnd: result.window.end, blocks: result.proposedBlocks, unscheduledTasks: result.unscheduledTasks, unscheduledRoutines: result.unscheduledRoutines, warnings: result.warnings, inputHash: '', engineVersion: 'deterministic-v1', createdAt: new Date().toISOString(), approvedAt: null, rejectedAt: null };
}

export function PlannerPanel({ store, isAuthenticated }: { store: TaskStore; isAuthenticated: boolean }) {
  const [session, setSession] = useState<PlanningSessionDetail | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const coordinator = useRef(new PlanningRequestCoordinator());

  useEffect(() => {
    const activeCoordinator = coordinator.current;
    if (!isAuthenticated) return () => activeCoordinator.abort();
    const request = activeCoordinator.begin();
    void listCloudPlanningSessions(request.signal).then(async ({ sessions }) => {
      if (!sessions[0] || !activeCoordinator.isCurrent(request.generation)) return;
      const restored = await getCloudPlanningSession(sessions[0].sessionId, request.signal);
      if (activeCoordinator.isCurrent(request.generation)) setSession(restored);
    }).catch((restoreError: unknown) => {
      if (!(restoreError instanceof DOMException && restoreError.name === 'AbortError')) setError(restoreError instanceof Error ? restoreError.message : '計画履歴を復元できませんでした。');
    }).finally(() => { if (activeCoordinator.isCurrent(request.generation)) setRestoring(false); });
    return () => activeCoordinator.abort();
  }, [isAuthenticated]);

  async function calculate() {
    const request = coordinator.current.begin();
    setLoading(true); setError(null); setStale(false);
    try {
      let next: PlanningSessionDetail;
      if (isAuthenticated) next = await createCloudPlanningSession(request.signal);
      else {
        const now = new Date(); const window = createPlanningWindow(now);
        const calendar = await resolvePlanningCalendarInput(false, window, request.signal, { getConnection: getCalendarConnection, getEvents: getCalendarEvents });
        next = localDetail({ ...buildPlanningResult({ now, events: calendar.events, tasks: store.tasks, routines: store.routines, completions: store.routineCompletions }), warnings: calendar.warnings });
      }
      if (coordinator.current.isCurrent(request.generation)) setSession(next);
    } catch (cause) {
      if (coordinator.current.isCurrent(request.generation) && !request.signal.aborted) setError(cause instanceof Error ? cause.message : '計画案を作成できませんでした。');
    } finally { if (coordinator.current.isCurrent(request.generation)) setLoading(false); coordinator.current.finish(request.generation); }
  }

  async function approve() {
    if (!session || loading || session.status !== 'draft') return;
    setConfirming(false); setLoading(true); setError(null);
    try {
      setSession(isAuthenticated ? await approveCloudPlanningSession(session.sessionId) : { ...session, status: 'approved', approvedAt: new Date().toISOString() });
    } catch (cause) {
      if (cause instanceof PlanningClientError && cause.code === 'PLAN_STALE') setStale(true);
      setError(cause instanceof Error ? cause.message : '計画案を承認できませんでした。');
    } finally { setLoading(false); }
  }

  async function reject() {
    if (!session || loading || session.status !== 'draft') return;
    setLoading(true); setError(null);
    try { setSession(isAuthenticated ? await rejectCloudPlanningSession(session.sessionId) : { ...session, status: 'rejected', rejectedAt: new Date().toISOString() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '計画案を却下できませんでした。'); }
    finally { setLoading(false); }
  }

  const grouped = session?.blocks.reduce<Record<string, ProposedTimeBlock[]>>((result, block) => { (result[tokyoDateKey(new Date(block.start))] ??= []).push(block); return result; }, {}) ?? {};
  const minutes = session?.blocks.reduce((sum, block) => sum + Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000), 0) ?? 0;

  return <section className="rounded-3xl border border-cyan-200 bg-white p-4 shadow-sm" aria-label="7日間の計画案">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">7日間の計画案</h3><p className="mt-1 text-sm text-slate-600">空き時間へルーティンとタスクを決定論的に配置し、確認状態を保存します。</p></div><button type="button" disabled={loading || restoring} onClick={() => void calculate()} className="min-h-11 rounded-full bg-cyan-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{loading ? '処理中…' : session ? '再計算' : '計画案を作成'}</button></div>
    <p className="mt-2 text-xs font-medium text-cyan-800">確認・承認してもGoogle Calendarへの追加・変更は行いません。</p>
    {!isAuthenticated ? <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">Localモードです。確認状態はこの画面・この端末内だけで、クラウドへ保存されません。Google Calendar予定は反映されません。</p> : null}
    {restoring ? <p role="status" className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm">最新の計画案を復元しています…</p> : null}
    {error ? <div role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700"><p>{error}</p>{stale ? <button type="button" onClick={() => void calculate()} className="mt-2 min-h-10 font-semibold underline">計画案を再作成</button> : null}</div> : null}
    {session ? <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-sm font-semibold ${stale ? 'bg-amber-100 text-amber-900' : session.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{stale ? '古くなった計画' : statusText[session.status]}</span><span className="text-xs text-slate-500">{session.engineVersion}</span></div>
      {session.warnings.map((warning) => <p key={warning} role="status" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="期間" value={`${fullDate(session.windowStart)}〜`} /><Metric label="配置" value={`${session.blocks.length}件`} /><Metric label="合計予定" value={`${minutes}分`} /><Metric label="未配置" value={`${session.unscheduledTasks.length + session.unscheduledRoutines.length}件`} /></div>
      {session.status === 'draft' && !stale ? <div className="flex flex-wrap gap-2"><button type="button" disabled={loading} onClick={() => setConfirming(true)} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">計画案を承認</button><button type="button" disabled={loading} onClick={() => void reject()} className="min-h-11 rounded-full bg-rose-50 px-4 font-semibold text-rose-700 disabled:opacity-50">却下</button></div> : null}
      {session.approvedAt ? <p className="text-sm text-emerald-800">承認日時: {fullDate(session.approvedAt)}。Google Calendarは未書き込みです。</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">{Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, blocks]) => <section key={date} className="rounded-2xl border border-slate-200 p-3"><h4 className="font-semibold">{date}</h4><div className="mt-2 space-y-2">{blocks.map((block) => <Block key={block.id} block={block} />)}</div></section>)}</div>
      {session.unscheduledTasks.length ? <section className="rounded-2xl bg-amber-50 p-4"><h4 className="font-semibold">配置できなかったタスク</h4>{session.unscheduledTasks.map((item) => <p key={item.taskId} className="mt-2 text-sm">{item.title} — {item.reason}</p>)}</section> : null}
    </div> : null}
    {confirming ? <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"><h4 id="approval-title" className="text-lg font-semibold">計画案を承認しますか？</h4><p className="mt-2 text-sm text-slate-600">最新データで再検証します。この時点ではGoogle Calendarへ書き込みません。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-4">キャンセル</button><button type="button" onClick={() => void approve()} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white">承認する</button></div></div></div> : null}
  </section>;
}

function Block({ block }: { block: ProposedTimeBlock }) { const minutes = Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000); return <article className={`rounded-xl border p-3 ${block.source === 'routine' ? 'border-violet-200 bg-violet-50' : 'border-cyan-200 bg-cyan-50'}`}><div className="flex flex-wrap justify-between gap-2"><p className="min-w-0 break-words font-semibold">{block.title}</p><span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{block.source === 'routine' ? 'ルーティン' : block.splitIndex > 1 ? `タスク・分割${block.splitIndex}` : 'タスク'}</span></div><p className="mt-1 text-sm">{time(block.start)}〜{time(block.end)}・{minutes}分</p></article>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-semibold">{value}</p></div>; }
