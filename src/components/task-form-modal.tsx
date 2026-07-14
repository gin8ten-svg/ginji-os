'use client';

import { useRef, useState } from 'react';
import { ModalShell } from '@/components/modal-shell';
import { isoToTokyoLocalInput, tokyoLocalInputToIso } from '@/lib/date-time';
import { SubmissionGate } from '@/lib/submission-gate';
import { createId } from '@/lib/task-repository';
import { taskPlanningDefaults } from '@/lib/task-planning';
import type { Priority, Task } from '@/types/tasks';

interface Props { task?: Task; initialDueAt?: string; isSubmitting?: boolean; onSave(task: Task): Promise<void>; onClose(): void; }

export function TaskFormModal({ task, initialDueAt = '', isSubmitting = false, onSave, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueAt, setDueAt] = useState(isoToTokyoLocalInput(task?.dueAt ?? (initialDueAt || null)));
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 3);
  const [estimatedMinutes, setEstimatedMinutes] = useState(task?.estimatedMinutes ?? 30);
  const [category, setCategory] = useState(task?.category ?? '未分類');
  const [splittable, setSplittable] = useState(task?.splittable ?? true);
  const [minimumBlockMinutes, setMinimumBlockMinutes] = useState(task?.minimumBlockMinutes ?? 25);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const gate = useRef(new SubmissionGate());
  const busy = submitting || isSubmitting;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return setFormError('タスク名を入力してください。');
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1) return setFormError('予想所要時間は1分以上で入力してください。');
    if (!Number.isInteger(minimumBlockMinutes) || minimumBlockMinutes < 1) return setFormError('最小作業単位は1分以上で入力してください。');
    const parsedDueAt = dueAt ? tokyoLocalInputToIso(dueAt) : null;
    if (dueAt && !parsedDueAt) return setFormError('締切日時を確認してください。');
    setSubmitting(true);
    setFormError(null);
    const now = new Date().toISOString();
    const defaults = taskPlanningDefaults(estimatedMinutes, task?.completedAt ?? null);
    const result = await gate.current.run(() => onSave({
      id: task?.id ?? createId('task'), title: title.trim(), description: description.trim(), dueAt: parsedDueAt,
      priority, estimatedMinutes, remainingMinutes: task ? Math.min(task.remainingMinutes, estimatedMinutes) : defaults.remainingMinutes,
      splittable, minimumBlockMinutes, category: category.trim() || '未分類', completedAt: task?.completedAt ?? null,
      createdAt: task?.createdAt ?? now, updatedAt: now, source: task?.source ?? 'user',
    }));
    if (!result.started) return;
    setSubmitting(false);
    if (result.error) setFormError(result.error); else onClose();
  };

  return <ModalShell labelledBy="task-form-title" onClose={onClose} closeDisabled={busy}>
    <div className="flex items-center justify-between"><h2 id="task-form-title" className="text-xl font-semibold">{task ? 'タスクを編集' : '新しいタスク'}</h2><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">閉じる</button></div>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <label className="block text-sm font-medium">タスク名 <span className="text-rose-600">必須</span><input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" autoFocus /></label>
      <label className="block text-sm font-medium">説明（任意）<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
      <label className="block text-sm font-medium">締切日時（Asia/Tokyo・任意）<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">優先度<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5">{[1,2,3,4,5].map((value) => <option key={value}>{value}</option>)}</select></label><label className="block text-sm font-medium">予想時間（分）<input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
      <label className="block text-sm font-medium">カテゴリー<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={splittable} onChange={(event) => setSplittable(event.target.checked)} />分割可能</label><label className="block text-sm font-medium">最小作業単位（分）<input type="number" min="1" value={minimumBlockMinutes} onChange={(event) => setMinimumBlockMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div>
      {formError ? <p role="alert" className="text-sm font-medium text-rose-700">{formError}</p> : null}
      <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '保存中…' : task ? '変更を保存' : 'タスクを作成'}</button>
    </form>
  </ModalShell>;
}
