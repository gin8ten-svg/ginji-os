'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { RoutineFormModal } from '@/components/routine-form-modal';
import { TaskFormModal } from '@/components/task-form-modal';
import { useTaskData } from '@/components/task-data-provider';
import { classifyTask, formatDueAt } from '@/lib/date-time';
import type { Routine, Task, TaskCategory } from '@/types/tasks';

const tabs = ['Inbox', 'Today', 'Upcoming', 'Overdue', 'Routines', 'Completed'] as const;
type TabKey = (typeof tabs)[number];
const taskCategoryByTab: Record<Exclude<TabKey, 'Routines'>, TaskCategory> = { Inbox: 'inbox', Today: 'today', Upcoming: 'upcoming', Overdue: 'overdue', Completed: 'completed' };
const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

export default function TasksPage() {
  const { store, isLoading, error, recoveryNotice, saveTask, deleteTask, saveRoutine, deleteRoutine } = useTaskData();
  const [activeTab, setActiveTab] = useState<TabKey>('Today');
  const [taskForm, setTaskForm] = useState<Task | 'new' | null>(null);
  const [routineForm, setRoutineForm] = useState<Routine | 'new' | null>(null);

  const visibleTasks = useMemo(() => {
    if (!store || activeTab === 'Routines') return [];
    return store.tasks.filter((task) => classifyTask(task) === taskCategoryByTab[activeTab]);
  }, [activeTab, store]);

  const toggleTaskComplete = (task: Task) => saveTask({ ...task, completedAt: task.completedAt ? null : new Date().toISOString(), updatedAt: new Date().toISOString() });
  const confirmDeleteTask = (task: Task) => { if (window.confirm(`「${task.title}」を削除しますか？`)) deleteTask(task.id); };
  const confirmDeleteRoutine = (routine: Routine) => { if (window.confirm(`ルーティン「${routine.name}」と実行履歴を削除しますか？`)) deleteRoutine(routine.id); };

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Tasks</h2><p className="mt-1 text-xs text-slate-500">端末内に保存・Asia/Tokyo基準</p></div><button type="button" onClick={() => activeTab === 'Routines' ? setRoutineForm('new') : setTaskForm('new')} className="min-h-11 rounded-full bg-brand-600 px-4 text-sm font-medium text-white">{activeTab === 'Routines' ? 'ルーティン追加' : 'タスク追加'}</button></div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="タスク分類フィルター">{tabs.map((tab) => <button type="button" aria-pressed={activeTab === tab} key={tab} onClick={() => setActiveTab(tab)} className={`min-h-10 shrink-0 rounded-full px-3 text-sm font-medium ${activeTab === tab ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{tab}</button>)}</div>
      </section>

      {error ? <ErrorState title="保存データを利用できません" description={error} /> : null}
      {recoveryNotice ? <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{recoveryNotice}</p> : null}
      {isLoading ? <LoadingState /> : null}

      {!isLoading && store && activeTab !== 'Routines' ? <div className="space-y-3">{visibleTasks.length === 0 ? <EmptyState title={`${activeTab} は空です`} description="タスクを追加するか、締切・完了状態を変更すると自動で分類されます。" /> : visibleTasks.map((task) => <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">通常タスク</span>{task.source === 'sample' ? <span className="text-xs text-slate-500">サンプル</span> : null}</div><h3 className="mt-2 font-semibold">{task.title}</h3>{task.description ? <p className="mt-1 text-sm text-slate-600">{task.description}</p> : null}</div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{task.category}</span></div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600"><span>予想 {task.estimatedMinutes}分</span><span>締切 {formatDueAt(task.dueAt)}</span><span>優先度 {task.priority}</span></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => toggleTaskComplete(task)} className="min-h-10 rounded-full bg-emerald-50 px-3 text-sm font-medium text-emerald-700">{task.completedAt ? '未完了に戻す' : '完了にする'}</button><button type="button" onClick={() => setTaskForm(task)} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-medium text-slate-700">編集</button><button type="button" onClick={() => confirmDeleteTask(task)} className="min-h-10 rounded-full bg-rose-50 px-3 text-sm font-medium text-rose-700">削除</button></div></article>)}</div> : null}

      {!isLoading && store && activeTab === 'Routines' ? <div className="space-y-3">{store.routines.length === 0 ? <EmptyState title="ルーティンはまだありません" description="毎日または曜日指定の繰り返し作業を追加できます。" /> : store.routines.map((routine) => <article key={routine.id} className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">ルーティン</span><span className={`text-xs font-medium ${routine.isActive ? 'text-emerald-700' : 'text-slate-500'}`}>{routine.isActive ? '有効' : '停止中'}</span>{routine.source === 'sample' ? <span className="text-xs text-slate-500">サンプル</span> : null}</div><h3 className="mt-2 font-semibold">{routine.name}</h3>{routine.description ? <p className="mt-1 text-sm text-slate-600">{routine.description}</p> : null}</div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{routine.category}</span></div><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600"><span>{routine.frequency.type === 'daily' ? '毎日' : routine.frequency.weekdays.map((day) => weekdayLabels[day]).join('・')}</span><span>予想 {routine.estimatedMinutes}分</span><span>優先度 {routine.priority}</span>{routine.availableStartTime && routine.availableEndTime ? <span>{routine.availableStartTime}–{routine.availableEndTime}</span> : <span>時間帯指定なし</span>}</div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => saveRoutine({ ...routine, isActive: !routine.isActive, updatedAt: new Date().toISOString() })} className="min-h-10 rounded-full bg-violet-50 px-3 text-sm font-medium text-violet-800">{routine.isActive ? '停止する' : '有効にする'}</button><button type="button" onClick={() => setRoutineForm(routine)} className="min-h-10 rounded-full bg-slate-100 px-3 text-sm font-medium text-slate-700">編集</button><button type="button" onClick={() => confirmDeleteRoutine(routine)} className="min-h-10 rounded-full bg-rose-50 px-3 text-sm font-medium text-rose-700">削除</button></div></article>)}</div> : null}

      {taskForm ? <TaskFormModal task={taskForm === 'new' ? undefined : taskForm} onClose={() => setTaskForm(null)} onSave={(task) => { saveTask(task); setTaskForm(null); }} /> : null}
      {routineForm ? <RoutineFormModal routine={routineForm === 'new' ? undefined : routineForm} onClose={() => setRoutineForm(null)} onSave={(routine) => { saveRoutine(routine); setRoutineForm(null); }} /> : null}
    </div>
  );
}
