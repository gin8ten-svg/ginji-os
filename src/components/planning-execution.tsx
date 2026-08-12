'use client';

import { useEffect, useState } from 'react';
import { ModalShell } from '@/components/modal-shell';
import { completeCloudPlanningTimeBlock, getCloudPlanningExecutionPreview, skipCloudPlanningTimeBlock } from '@/lib/planning/client';
import type { PlanningExecutionBlock, PlanningExecutionPreview } from '@/types/planning-session';

const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const statusLabel: Record<PlanningExecutionBlock['status'], string> = { approved: '未完了', in_progress: '未完了', completed: '完了', skipped: 'スキップ' };
const skipReasonLabel: Record<'user_skipped' | 'carried_over', string> = { user_skipped: 'スキップ', carried_over: '持ち越し' };

export function PlanningExecution({ sessionId, onTaskUpdated }: { sessionId: string; onTaskUpdated(): void }) {
  const [preview, setPreview] = useState<PlanningExecutionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [actualTarget, setActualTarget] = useState<PlanningExecutionBlock | null>(null);
  const [actualValue, setActualValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number>(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    void getCloudPlanningExecutionPreview(sessionId, controller.signal)
      .then((next) => { if (!controller.signal.aborted) { setPreview(next); setCheckedAt(Date.now()); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '実行記録を取得できませんでした。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionId]);

  async function refresh() {
    setLoading(true); setError(null);
    try { setPreview(await getCloudPlanningExecutionPreview(sessionId)); setCheckedAt(Date.now()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '実行記録を取得できませんでした。'); }
    finally { setLoading(false); }
  }

  async function complete(block: PlanningExecutionBlock, actualMinutes: number | null) {
    if (savingBlockId) return;
    setSavingBlockId(block.planningBlockId); setError(null); setMessage(null);
    try {
      const result = await completeCloudPlanningTimeBlock(sessionId, block.planningBlockId, actualMinutes);
      setPreview((current) => current ? { ...current, blocks: current.blocks.map((item) => item.planningBlockId === block.planningBlockId ? { ...item, status: 'completed', actualMinutes: result.actualMinutes } : item) } : current);
      setActualTarget(null); setActualValue('');
      setMessage(result.outcome === 'actual_recorded' ? '実績時間を記録しました。' : result.outcome === 'already_completed' ? 'このblockはすでに完了しています。' : result.taskCompleted ? 'blockとタスクを完了しました。' : 'blockを完了し、タスクの残り時間を更新しました。');
      if (result.outcome === 'completed') onTaskUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '実行記録を保存できませんでした。'); }
    finally { setSavingBlockId(null); }
  }

  async function skip(block: PlanningExecutionBlock, reason: 'user_skipped' | 'carried_over') {
    if (savingBlockId) return;
    setSavingBlockId(block.planningBlockId); setError(null); setMessage(null);
    try {
      const result = await skipCloudPlanningTimeBlock(sessionId, block.planningBlockId, reason);
      setPreview((current) => current ? { ...current, blocks: current.blocks.map((item) => item.planningBlockId === block.planningBlockId ? { ...item, status: 'skipped', statusReason: result.statusReason } : item) } : current);
      setMessage(result.outcome === 'already_skipped' ? `このblockはすでに${skipReasonLabel[result.statusReason]}済みです。` : reason === 'carried_over' ? '未完了の予定を持ち越しにしました。次の計画作成で再候補になります。' : 'この予定をスキップしました。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '実行記録を保存できませんでした。'); }
    finally { setSavingBlockId(null); }
  }

  function openActual(block: PlanningExecutionBlock) { setActualTarget(block); setActualValue(''); setError(null); }
  function submitActual() {
    if (!actualTarget || savingBlockId) return;
    const minutes = Number(actualValue);
    if (!Number.isInteger(minutes) || minutes < 0) { setError('実績時間は0以上の整数で入力してください。'); return; }
    void complete(actualTarget, minutes);
  }

  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4" aria-label="計画blockの実行記録">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-emerald-950">実行記録</h4><p className="mt-1 text-sm text-emerald-900">完了・スキップした予定blockと実績時間を記録します。Google Calendarへ変更は送りません。</p></div><button type="button" disabled={loading || Boolean(savingBlockId)} onClick={refresh} className="min-h-10 rounded-full bg-white px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">{loading ? '読込中…' : '状態を更新'}</button></div>
    {error ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 rounded-xl bg-white p-3 text-sm font-medium text-emerald-800">{message}</p> : null}
    {!loading && preview?.blocks.length === 0 ? <p className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-600">Google Calendarへ追加済みのタスクblockはありません。予定を追加した後に「状態を更新」を押してください。</p> : null}
    {preview?.blocks.length ? <div className="mt-3 space-y-2">{preview.blocks.map((block) => {
      const saving = savingBlockId === block.planningBlockId;
      const isDone = block.status === 'completed' || block.status === 'skipped';
      const isOverdue = !isDone && new Date(block.end).getTime() < checkedAt;
      return <article key={block.planningBlockId} className={`rounded-xl border p-3 ${isOverdue ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-white'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className={`font-semibold ${isDone ? 'text-slate-500 line-through' : ''}`}>{block.title}</p><p className="mt-1 text-sm text-slate-600">{dateTime(block.start)}〜{dateTime(block.end)}・予定 {block.plannedMinutes}分</p>{isOverdue ? <p className="mt-1 text-sm font-semibold text-amber-800">対応が必要です（予定時刻を過ぎています）</p> : null}</div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${block.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : block.status === 'skipped' ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-700'}`}>{block.status === 'skipped' && block.statusReason ? skipReasonLabel[block.statusReason] : statusLabel[block.status]}</span></div>
        {block.actualMinutes !== null ? <p className="mt-2 text-sm font-medium text-emerald-800">実績 {block.actualMinutes}分</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {!isDone ? <>
            <button type="button" disabled={Boolean(savingBlockId)} onClick={() => void complete(block, null)} className="min-h-10 rounded-full bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '完了'}</button>
            <button type="button" disabled={Boolean(savingBlockId)} onClick={() => openActual(block)} className="min-h-10 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">実績を入力して完了</button>
            {isOverdue
              ? <button type="button" disabled={Boolean(savingBlockId)} onClick={() => void skip(block, 'carried_over')} className="min-h-10 rounded-full bg-amber-100 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50">翌日へ持ち越す</button>
              : <button type="button" disabled={Boolean(savingBlockId)} onClick={() => void skip(block, 'user_skipped')} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">スキップ</button>}
          </> : block.status === 'completed' && block.actualMinutes === null ? <button type="button" disabled={Boolean(savingBlockId)} onClick={() => openActual(block)} className="min-h-10 rounded-full bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">実績時間を記録</button> : null}
        </div>
      </article>;
    })}</div> : null}
    {actualTarget ? <ModalShell labelledBy="actual-time-title" onClose={() => setActualTarget(null)} closeDisabled={Boolean(savingBlockId)}><h4 id="actual-time-title" className="text-lg font-semibold">実績時間を記録</h4><p className="mt-2 break-words text-sm text-slate-600">{actualTarget.title}（予定 {actualTarget.plannedMinutes}分）</p><label className="mt-4 block text-sm font-semibold">実績時間（分）<input required type="number" inputMode="numeric" min="0" step="1" value={actualValue} onChange={(event) => setActualValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={Boolean(savingBlockId)} onClick={() => setActualTarget(null)} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={Boolean(savingBlockId) || actualValue === ''} onClick={submitActual} className="min-h-11 rounded-full bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{savingBlockId ? '保存中…' : actualTarget.status === 'completed' ? '記録する' : '記録して完了'}</button></div></ModalShell> : null}
  </section>;
}
