'use client';

import { useState } from 'react';
import { ModalShell } from '@/components/modal-shell';
import { isoToTokyoLocalInput, tokyoLocalInputToIso } from '@/lib/date-time';
import { deleteCloudPlanningBlock, PlanningClientError, updateCloudPlanningBlockTask, updateCloudPlanningBlockTime } from '@/lib/planning/client';
import type { ProposedTimeBlock } from '@/types/planning';
import type { PlanningSessionDetail } from '@/types/planning-session';
import type { Task } from '@/types/tasks';

const time = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function PlanningBlockEditor({ sessionId, block, tasks, onChanged, disabled }: { sessionId: string; block: ProposedTimeBlock; tasks: Task[]; onChanged(next: PlanningSessionDetail): void; disabled: boolean }) {
  const minutes = Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000);
  const [mode, setMode] = useState<'idle' | 'time' | 'task' | 'delete'>('idle');
  const [startValue, setStartValue] = useState(() => isoToTokyoLocalInput(block.start));
  const [endValue, setEndValue] = useState(() => isoToTokyoLocalInput(block.end));
  const [taskValue, setTaskValue] = useState(block.taskId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openTime() { setStartValue(isoToTokyoLocalInput(block.start)); setEndValue(isoToTokyoLocalInput(block.end)); setError(null); setMode('time'); }
  function openTask() { setTaskValue(block.taskId ?? ''); setError(null); setMode('task'); }
  function openDelete() { setError(null); setMode('delete'); }
  function close() { if (!saving) setMode('idle'); }

  async function submitTime() {
    const start = tokyoLocalInputToIso(startValue);
    const end = tokyoLocalInputToIso(endValue);
    if (!start || !end) { setError('時刻の形式が正しくありません。'); return; }
    setSaving(true); setError(null);
    try { onChanged(await updateCloudPlanningBlockTime(sessionId, block.id, start, end)); setMode('idle'); }
    catch (cause) { setError(cause instanceof PlanningClientError ? cause.message : '時刻を更新できませんでした。'); }
    finally { setSaving(false); }
  }

  async function submitTask() {
    if (!taskValue) { setError('差し替え先のタスクを選択してください。'); return; }
    setSaving(true); setError(null);
    try { onChanged(await updateCloudPlanningBlockTask(sessionId, block.id, taskValue)); setMode('idle'); }
    catch (cause) { setError(cause instanceof PlanningClientError ? cause.message : 'タスクを差し替えできませんでした。'); }
    finally { setSaving(false); }
  }

  async function submitDelete() {
    setSaving(true); setError(null);
    try { onChanged(await deleteCloudPlanningBlock(sessionId, block.id)); setMode('idle'); }
    catch (cause) { setError(cause instanceof PlanningClientError ? cause.message : 'この予定を削除できませんでした。'); }
    finally { setSaving(false); }
  }

  return <article className={`rounded-xl border p-3 ${block.source === 'routine' ? 'border-violet-200 bg-violet-50' : 'border-cyan-200 bg-cyan-50'}`}>
    <div className="flex flex-wrap justify-between gap-2">
      <p className="min-w-0 break-words font-semibold">{block.title}</p>
      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{block.source === 'routine' ? 'ルーティン' : block.splitIndex > 1 ? `タスク・分割${block.splitIndex}` : 'タスク'}</span>
    </div>
    <p className="mt-1 text-sm">{time(block.start)}〜{time(block.end)}・{minutes}分</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={disabled} onClick={openTime} className="min-h-9 rounded-full bg-white px-3 text-xs font-semibold text-cyan-800 disabled:opacity-50">時刻を変更</button>
      {block.source === 'task' ? <button type="button" disabled={disabled || tasks.length === 0} onClick={openTask} className="min-h-9 rounded-full bg-white px-3 text-xs font-semibold text-cyan-800 disabled:opacity-50">タスクを差し替え</button> : null}
      <button type="button" disabled={disabled} onClick={openDelete} className="min-h-9 rounded-full bg-white px-3 text-xs font-semibold text-rose-700 disabled:opacity-50">削除</button>
    </div>

    {mode === 'time' ? <ModalShell labelledBy="block-time-title" onClose={close} closeDisabled={saving}>
      <h4 id="block-time-title" className="text-lg font-semibold">時刻を変更</h4>
      <p className="mt-2 break-words text-sm text-slate-600">{block.title}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <label className="mt-4 block text-sm font-semibold">開始<input required type="datetime-local" value={startValue} onChange={(event) => setStartValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
      <label className="mt-4 block text-sm font-semibold">終了<input required type="datetime-local" value={endValue} onChange={(event) => setEndValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={saving} onClick={() => void submitTime()} className="min-h-11 rounded-full bg-cyan-700 px-4 font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '保存する'}</button></div>
    </ModalShell> : null}

    {mode === 'task' ? <ModalShell labelledBy="block-task-title" onClose={close} closeDisabled={saving}>
      <h4 id="block-task-title" className="text-lg font-semibold">タスクを差し替え</h4>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <label className="mt-4 block text-sm font-semibold">差し替え先のタスク
        <select value={taskValue} onChange={(event) => setTaskValue(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal">
          <option value="">選択してください</option>
          {tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={saving || !taskValue} onClick={() => void submitTask()} className="min-h-11 rounded-full bg-cyan-700 px-4 font-semibold text-white disabled:opacity-50">{saving ? '保存中…' : '差し替える'}</button></div>
    </ModalShell> : null}

    {mode === 'delete' ? <ModalShell labelledBy="block-delete-title" onClose={close} closeDisabled={saving}>
      <h4 id="block-delete-title" className="text-lg font-semibold">この予定を削除しますか？</h4>
      <p className="mt-2 break-words text-sm text-slate-600">{block.title}（{time(block.start)}〜{time(block.end)}）を計画案から削除します。</p>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-full px-4 disabled:opacity-50">キャンセル</button><button type="button" disabled={saving} onClick={() => void submitDelete()} className="min-h-11 rounded-full bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">{saving ? '削除中…' : '削除する'}</button></div>
    </ModalShell> : null}
  </article>;
}
