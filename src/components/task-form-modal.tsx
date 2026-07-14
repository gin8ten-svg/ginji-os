'use client';

import { useState } from 'react';
import { isoToTokyoLocalInput, tokyoLocalInputToIso } from '@/lib/date-time';
import { createId } from '@/lib/task-repository';
import type { Priority, Task } from '@/types/tasks';

interface TaskFormModalProps {
  task?: Task;
  onSave(task: Task): void;
  onClose(): void;
}
export function TaskFormModal({ task, onSave, onClose }: TaskFormModalProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [dueAt, setDueAt] = useState(isoToTokyoLocalInput(task?.dueAt ?? null));
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 3);
  const [estimatedMinutes, setEstimatedMinutes] = useState(task?.estimatedMinutes ?? 30);
  const [category, setCategory] = useState(task?.category ?? '未分類');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setValidationError('タスク名を入力してください。');
      return;
    }
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1) {
      setValidationError('予想所要時間は1分以上で入力してください。');
      return;
    }
    const parsedDueAt = dueAt ? tokyoLocalInputToIso(dueAt) : null;
    if (dueAt && !parsedDueAt) {
      setValidationError('締切日時を確認してください。');
      return;
    }
    const now = new Date().toISOString();
    onSave({
      id: task?.id ?? createId('task'),
      title: title.trim(),
      description: description.trim(),
      dueAt: parsedDueAt,
      priority,
      estimatedMinutes,
      category: category.trim() || '未分類',
      completedAt: task?.completedAt ?? null,
      createdAt: task?.createdAt ?? now,
      updatedAt: now,
      source: task?.source ?? 'user',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="task-form-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 id="task-form-title" className="text-xl font-semibold">{task ? 'タスクを編集' : '新しいタスク'}</h2>
          <button type="button" onClick={onClose} className="min-h-11 rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">閉じる</button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">タスク名 <span className="text-rose-600">必須</span><input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" autoFocus /></label>
          <label className="block text-sm font-medium">説明（任意）<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <label className="block text-sm font-medium">締切日時（Asia/Tokyo・任意）<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">優先度<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="block text-sm font-medium">予想時間（分）<input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          </div>
          <label className="block text-sm font-medium">カテゴリー<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          {validationError ? <p role="alert" className="text-sm font-medium text-rose-700">{validationError}</p> : null}
          <button type="submit" className="min-h-12 w-full rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-500">{task ? '変更を保存' : 'タスクを作成'}</button>
        </form>
      </section>
    </div>
  );
}
