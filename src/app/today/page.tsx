'use client';

import { useMemo, useState } from 'react';
import { DataFeedback } from '@/components/data-feedback';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { TaskFormModal } from '@/components/task-form-modal';
import { PlannerPanel } from '@/components/planner-panel';
import { useTaskData } from '@/components/task-data-provider';
import { formatDueAt, isRoutineScheduled, tokyoDateKey } from '@/lib/date-time';
import { isOverdueTask, todayDashboardTasks } from '@/lib/practical-mvp';
import { toggleTaskCompletion } from '@/lib/task-planning';
import { useTokyoDateKey } from '@/lib/use-tokyo-date';
import type { Task } from '@/types/tasks';

export default function TodayPage() {
  const { store, isAuthenticated, isLoading, isSaving, error, successMessage, recoveryNotice, retry, saveTask, toggleRoutineCompletion } = useTaskData();
  const [quickAdd, setQuickAdd] = useState(false);
  const today = useTokyoDateKey();
  const tasks = useMemo(() => today ? todayDashboardTasks(store?.tasks ?? [], today) : [], [store?.tasks, today]);
  const routines = useMemo(() => today ? store?.routines.filter((routine) => isRoutineScheduled(routine, today)) ?? [] : [], [store?.routines, today]);
  const completedRoutineIds = new Set(store?.routineCompletions.filter((completion) => completion.date === today).map((completion) => completion.routineId) ?? []);
  const todayCompletedTasks = today ? store?.tasks.filter((task) => task.completedAt && tokyoDateKey(new Date(task.completedAt)) === today).length ?? 0 : 0;
  const completedRoutines = routines.filter((routine) => completedRoutineIds.has(routine.id)).length;
  const remainingMinutes = tasks.reduce((sum, task) => sum + task.remainingMinutes, 0)
    + routines.filter((routine) => !completedRoutineIds.has(routine.id)).reduce((sum, routine) => sum + routine.estimatedMinutes, 0);
  const dateLabel = today ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${today}T12:00:00+09:00`)) : '日付を確認中';

  const toggleTask = (task: Task) => { void saveTask(toggleTaskCompletion(task)).catch(() => undefined); };

  return <div className="space-y-4">
    <section className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-5 text-white shadow-sm">
      <p className="text-sm font-medium text-brand-100">{dateLabel}・Asia/Tokyo</p>
      <div className="mt-2 flex items-end justify-between gap-3"><div><h2 className="text-2xl font-semibold">今日やること</h2><p className="mt-1 text-sm text-brand-50">期限と優先度から、次の行動を整理します。</p></div><button type="button" onClick={() => setQuickAdd(true)} className="min-h-11 shrink-0 rounded-full bg-white px-4 text-sm font-semibold text-brand-700">＋ クイック追加</button></div>
    </section>

    {error ? <ErrorState title="データを利用できません" description={error} onRetry={retry} /> : null}
    <DataFeedback message={successMessage} />
    {recoveryNotice ? <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{recoveryNotice}</p> : null}
    {isLoading || !today ? <LoadingState /> : null}

    {!isLoading && today && store ? <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="今日の完了" value={`${todayCompletedTasks + completedRoutines}件`} />
        <Metric label="残り時間" value={`${remainingMinutes}分`} />
        <Metric label="未完了タスク" value={`${tasks.length}件`} />
        <Metric label="ルーティン" value={`${completedRoutines}/${routines.length}`} />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold">今日のタスク</h3><p className="mt-1 text-xs text-slate-500">期限超過 → 今日締切 → 優先度順</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{tasks.length}件</span></div>
        {tasks.length === 0 ? <div className="mt-4"><EmptyState title="今日の未完了タスクはありません" description="クイック追加から今日やることを登録できます。" /></div> : <div className="mt-4 space-y-3">{tasks.map((task) => <article key={task.id} className={`rounded-2xl border p-3 ${isOverdueTask(task, today) ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start gap-3"><button disabled={isSaving} type="button" onClick={() => toggleTask(task)} aria-label={`${task.title}を完了にする`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500 bg-white text-emerald-700 disabled:opacity-50">○</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="break-words font-semibold">{task.title}</h4>{isOverdueTask(task, today) ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">期限超過</span> : null}</div><p className="mt-1 text-sm text-slate-600">{formatDueAt(task.dueAt)}・優先度 {task.priority}・{task.estimatedMinutes}分</p></div></div></article>)}</div>}
      </section>

      <section className="rounded-3xl border border-violet-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold">今日のルーティン</h3><p className="mt-1 text-xs text-slate-500">曜日設定に基づく実施対象</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">{completedRoutines}/{routines.length}</span></div>
        {routines.length === 0 ? <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">今日実施するルーティンはありません。</p> : <div className="mt-4 space-y-3">{routines.map((routine) => { const completed = completedRoutineIds.has(routine.id); return <article key={routine.id} className="flex items-start gap-3 rounded-2xl bg-violet-50 p-3"><button disabled={isSaving} type="button" onClick={() => toggleRoutineCompletion(routine.id, today)} aria-label={`${routine.name}を${completed ? '未完了に戻す' : '完了にする'}`} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 disabled:opacity-50 ${completed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-violet-400 bg-white text-violet-700'}`}>{completed ? '✓' : '○'}</button><div className="min-w-0"><h4 className={`break-words font-semibold ${completed ? 'text-slate-500 line-through' : ''}`}>{routine.name}</h4><p className="mt-1 text-sm text-slate-600">{routine.estimatedMinutes}分・優先度 {routine.priority}</p></div></article>; })}</div>}
      </section>

      <PlannerPanel store={store} isAuthenticated={isAuthenticated} />
    </> : null}

    {quickAdd && today ? <TaskFormModal initialDueAt={new Date(`${today}T23:59:00+09:00`).toISOString()} isSubmitting={isSaving} onClose={() => setQuickAdd(false)} onSave={saveTask} /> : null}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p></div>;
}
