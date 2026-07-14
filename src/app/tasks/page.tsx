'use client';

import { useMemo, useState } from 'react';
import { DataFeedback } from '@/components/data-feedback';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { RoutineFormModal } from '@/components/routine-form-modal';
import { TaskFormModal } from '@/components/task-form-modal';
import { useTaskData } from '@/components/task-data-provider';
import { formatDueAt, tokyoDateKey } from '@/lib/date-time';
import { filterAndSortTasks, isOverdueTask, type TaskSort } from '@/lib/practical-mvp';
import { toggleTaskCompletion } from '@/lib/task-planning';
import type { Priority, Routine, Task, TaskCategory } from '@/types/tasks';

const statusOptions: Array<{ value: TaskCategory | 'all'; label: string }> = [
  { value: 'all', label: 'すべて' }, { value: 'inbox', label: 'Inbox' }, { value: 'today', label: '今日' },
  { value: 'upcoming', label: '今後' }, { value: 'overdue', label: '期限超過' }, { value: 'completed', label: '完了' },
];
const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

export default function TasksPage() {
  const { store, isLoading, isSaving, error, successMessage, recoveryNotice, retry, saveTask, deleteTask, saveRoutine, deleteRoutine, toggleRoutineCompletion } = useTaskData();
  const [mode, setMode] = useState<'tasks' | 'routines'>('tasks');
  const [status, setStatus] = useState<TaskCategory | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TaskSort>('due');
  const [taskForm, setTaskForm] = useState<Task | 'new' | null>(null);
  const [routineForm, setRoutineForm] = useState<Routine | 'new' | null>(null);
  const today = tokyoDateKey();
  const categories = useMemo(() => Array.from(new Set(store?.tasks.map((task) => task.category).filter(Boolean) ?? [])).sort(), [store?.tasks]);
  const visibleTasks = useMemo(() => filterAndSortTasks(store?.tasks ?? [], { status, priority, category, query, sort, today }), [category, priority, query, sort, status, store?.tasks, today]);
  const completedRoutineIds = new Set(store?.routineCompletions.filter((completion) => completion.date === today).map((completion) => completion.routineId) ?? []);

  const toggleTask = (task: Task) => { void saveTask(toggleTaskCompletion(task)).catch(() => undefined); };
  const confirmDeleteTask = (task: Task) => { if (window.confirm(`「${task.title}」を削除しますか？`)) void deleteTask(task.id).catch(() => undefined); };
  const confirmDeleteRoutine = (routine: Routine) => { if (window.confirm(`ルーティン「${routine.name}」と実行履歴を削除しますか？`)) void deleteRoutine(routine.id).catch(() => undefined); };

  return <div className="space-y-4">
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">タスク管理</h2><p className="mt-1 text-xs text-slate-500">Asia/Tokyo基準・{store ? `${store.tasks.length}件` : '読込中'}</p></div><button disabled={isSaving} type="button" onClick={() => mode === 'tasks' ? setTaskForm('new') : setRoutineForm('new')} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{mode === 'tasks' ? 'タスク追加' : 'ルーティン追加'}</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button type="button" aria-pressed={mode === 'tasks'} onClick={() => setMode('tasks')} className={`min-h-11 rounded-xl text-sm font-semibold ${mode === 'tasks' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'}`}>タスク</button><button type="button" aria-pressed={mode === 'routines'} onClick={() => setMode('routines')} className={`min-h-11 rounded-xl text-sm font-semibold ${mode === 'routines' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'}`}>ルーティン</button></div>
    </section>

    {error ? <ErrorState title="保存データを利用できません" description={error} onRetry={retry} /> : null}
    <DataFeedback message={successMessage} />
    {recoveryNotice ? <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{recoveryNotice}</p> : null}
    {isLoading ? <LoadingState /> : null}

    {!isLoading && store && mode === 'tasks' ? <>
      <section aria-label="タスク絞り込み" className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium">キーワード検索<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・説明・カテゴリー" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label>
        <div className="flex gap-2 overflow-x-auto pb-1">{statusOptions.map((option) => <button key={option.value} type="button" aria-pressed={status === option.value} onClick={() => setStatus(option.value)} className={`min-h-10 shrink-0 rounded-full px-3 text-sm font-medium ${status === option.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{option.label}</button>)}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">優先度<select value={priority} onChange={(event) => setPriority(event.target.value === 'all' ? 'all' : Number(event.target.value) as Priority)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"><option value="all">すべて</option>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium">カテゴリー<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"><option value="all">すべて</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm font-medium">並び順<select value={sort} onChange={(event) => setSort(event.target.value as TaskSort)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3"><option value="due">期限順</option><option value="priority">優先度順</option><option value="updated">更新順</option></select></label>
        </div>
      </section>
      <div className="space-y-3">{visibleTasks.length === 0 ? <EmptyState title="条件に一致するタスクはありません" description="絞り込みを変更するか、新しいタスクを追加してください。" /> : visibleTasks.map((task) => <article key={task.id} className={`rounded-2xl border p-4 shadow-sm ${task.completedAt ? 'border-emerald-200 bg-emerald-50/60' : isOverdueTask(task, today) ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className={`break-words font-semibold ${task.completedAt ? 'text-slate-500 line-through' : ''}`}>{task.title}</h3>{task.description ? <p className="mt-1 break-words text-sm text-slate-600">{task.description}</p> : null}</div><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">{task.category}</span></div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600"><span>{task.estimatedMinutes}分</span><span>{formatDueAt(task.dueAt)}</span><span>優先度 {task.priority}</span>{task.completedAt ? <span className="font-semibold text-emerald-700">完了</span> : null}</div><div className="mt-4 flex flex-wrap gap-2"><Action disabled={isSaving} onClick={() => toggleTask(task)}>{task.completedAt ? '未完了に戻す' : '完了にする'}</Action><Action disabled={isSaving} onClick={() => setTaskForm(task)}>編集</Action><Action disabled={isSaving} danger onClick={() => confirmDeleteTask(task)}>削除</Action></div></article>)}</div>
    </> : null}

    {!isLoading && store && mode === 'routines' ? <div className="space-y-3">{store.routines.length === 0 ? <EmptyState title="ルーティンはまだありません" description="毎日または曜日指定の繰り返し作業を追加できます。" /> : store.routines.map((routine) => { const completed = completedRoutineIds.has(routine.id); return <article key={routine.id} className={`rounded-2xl border p-4 shadow-sm ${routine.isActive ? 'border-violet-200 bg-white' : 'border-slate-200 bg-slate-100'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{routine.name}</h3>{routine.description ? <p className="mt-1 break-words text-sm text-slate-600">{routine.description}</p> : null}</div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${routine.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{routine.isActive ? '有効' : '無効'}</span></div><div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600"><span>{routine.frequency.type === 'daily' ? '毎日' : routine.frequency.weekdays.map((day) => weekdayLabels[day]).join('・')}</span><span>{routine.estimatedMinutes}分</span><span>優先度 {routine.priority}</span><span>{routine.category}</span></div><div className="mt-4 flex flex-wrap gap-2"><Action disabled={isSaving || !routine.isActive} onClick={() => toggleRoutineCompletion(routine.id, today)}>{completed ? '今日を未完了に戻す' : '今日完了'}</Action><Action disabled={isSaving} onClick={() => saveRoutine({ ...routine, isActive: !routine.isActive, updatedAt: new Date().toISOString() })}>{routine.isActive ? '無効にする' : '有効にする'}</Action><Action disabled={isSaving} onClick={() => setRoutineForm(routine)}>編集</Action><Action disabled={isSaving} danger onClick={() => confirmDeleteRoutine(routine)}>削除</Action></div></article>; })}</div> : null}

    {taskForm ? <TaskFormModal task={taskForm === 'new' ? undefined : taskForm} isSubmitting={isSaving} onClose={() => setTaskForm(null)} onSave={saveTask} /> : null}
    {routineForm ? <RoutineFormModal routine={routineForm === 'new' ? undefined : routineForm} isSubmitting={isSaving} onClose={() => setRoutineForm(null)} onSave={saveRoutine} /> : null}
  </div>;
}

function Action({ children, disabled, danger = false, onClick }: { children: React.ReactNode; disabled: boolean; danger?: boolean; onClick: () => void | Promise<void> }) {
  const handleClick = () => { void Promise.resolve(onClick()).catch(() => undefined); };
  return <button type="button" disabled={disabled} onClick={handleClick} className={`min-h-10 rounded-full px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{children}</button>;
}
