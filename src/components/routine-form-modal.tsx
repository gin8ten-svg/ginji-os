'use client';

import { useState } from 'react';
import { createId } from '@/lib/task-repository';
import type { Priority, Routine, Weekday } from '@/types/tasks';
import { ModalShell } from '@/components/modal-shell';

const weekdayOptions: { value: Weekday; label: string }[] = [
  { value: 1, label: '月' }, { value: 2, label: '火' }, { value: 3, label: '水' }, { value: 4, label: '木' }, { value: 5, label: '金' }, { value: 6, label: '土' }, { value: 0, label: '日' },
];

interface RoutineFormModalProps {
  routine?: Routine;
  isSubmitting?: boolean;
  onSave(routine: Routine): void;
  onClose(): void;
}
export function RoutineFormModal({ routine, isSubmitting = false, onSave, onClose }: RoutineFormModalProps) {
  const [name, setName] = useState(routine?.name ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [frequencyType, setFrequencyType] = useState<'daily' | 'weekdays'>(routine?.frequency.type ?? 'daily');
  const [weekdays, setWeekdays] = useState<Weekday[]>(routine?.frequency.type === 'weekdays' ? routine.frequency.weekdays : [1, 2, 3, 4, 5]);
  const [estimatedMinutes, setEstimatedMinutes] = useState(routine?.estimatedMinutes ?? 30);
  const [priority, setPriority] = useState<Priority>(routine?.priority ?? 3);
  const [category, setCategory] = useState(routine?.category ?? '未分類');
  const [availableStartTime, setAvailableStartTime] = useState(routine?.availableStartTime ?? '');
  const [availableEndTime, setAvailableEndTime] = useState(routine?.availableEndTime ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const toggleWeekday = (value: Weekday) => setWeekdays((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return setValidationError('ルーティン名を入力してください。');
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1) return setValidationError('予想所要時間は1分以上で入力してください。');
    if (frequencyType === 'weekdays' && weekdays.length === 0) return setValidationError('実行する曜日を1つ以上選択してください。');
    if ((availableStartTime && !availableEndTime) || (!availableStartTime && availableEndTime)) return setValidationError('時間帯は開始と終了を両方入力してください。');
    if (availableStartTime && availableEndTime && availableStartTime >= availableEndTime) return setValidationError('実行可能時間帯は開始を終了より前にしてください。');
    const now = new Date().toISOString();
    onSave({
      id: routine?.id ?? createId('routine'),
      name: name.trim(),
      description: description.trim(),
      frequency: frequencyType === 'daily' ? { type: 'daily' } : { type: 'weekdays', weekdays },
      estimatedMinutes,
      priority,
      category: category.trim() || '未分類',
      availableStartTime: availableStartTime || null,
      availableEndTime: availableEndTime || null,
      isActive: routine?.isActive ?? true,
      createdAt: routine?.createdAt ?? now,
      updatedAt: now,
      source: routine?.source ?? 'user',
    });
  };

  return (
    <ModalShell labelledBy="routine-form-title" onClose={onClose}>
        <div className="flex items-center justify-between"><h2 id="routine-form-title" className="text-xl font-semibold">{routine ? 'ルーティンを編集' : '新しいルーティン'}</h2><button type="button" onClick={onClose} className="min-h-11 rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">閉じる</button></div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">名前 <span className="text-rose-600">必須</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" autoFocus /></label>
          <label className="block text-sm font-medium">説明（任意）<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <fieldset><legend className="text-sm font-medium">実行頻度</legend><div className="mt-2 flex gap-2"><button type="button" onClick={() => setFrequencyType('daily')} className={`rounded-full px-3 py-2 text-sm ${frequencyType === 'daily' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}>毎日</button><button type="button" onClick={() => setFrequencyType('weekdays')} className={`rounded-full px-3 py-2 text-sm ${frequencyType === 'weekdays' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}>曜日指定</button></div>{frequencyType === 'weekdays' ? <div className="mt-2 flex flex-wrap gap-2">{weekdayOptions.map((day) => <button type="button" key={day.value} aria-pressed={weekdays.includes(day.value)} onClick={() => toggleWeekday(day.value)} className={`h-10 w-10 rounded-full text-sm font-medium ${weekdays.includes(day.value) ? 'bg-violet-100 text-violet-800 ring-2 ring-violet-500' : 'bg-slate-100 text-slate-600'}`}>{day.label}</button>)}</div> : null}</fieldset>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium">予想時間（分）<input type="number" min="1" value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="block text-sm font-medium">優先度<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label></div>
          <label className="block text-sm font-medium">カテゴリー<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <fieldset><legend className="text-sm font-medium">実行可能な時間帯（任意・Asia/Tokyo）</legend><div className="mt-1 grid grid-cols-2 gap-3"><label className="text-xs text-slate-600">開始<input type="time" value={availableStartTime} onChange={(event) => setAvailableStartTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label><label className="text-xs text-slate-600">終了<input type="time" value={availableEndTime} onChange={(event) => setAvailableEndTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label></div></fieldset>
          {validationError ? <p role="alert" className="text-sm font-medium text-rose-700">{validationError}</p> : null}
          <button type="submit" disabled={isSubmitting} className="min-h-12 w-full rounded-xl bg-violet-600 px-4 font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? '保存中…' : routine ? '変更を保存' : 'ルーティンを作成'}</button>
        </form>
    </ModalShell>
  );
}
