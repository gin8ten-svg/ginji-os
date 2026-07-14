'use client';

import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusCard } from '@/components/status-card';
import { useTaskData } from '@/components/task-data-provider';
import { classifyTask, isRoutineScheduled, tokyoDateKey } from '@/lib/date-time';
import { timeline } from '@/lib/mock-data';

export default function TodayPage() {
  const { store, isLoading, error, recoveryNotice, toggleRoutineCompletion } = useTaskData();
  const today = tokyoDateKey();
  const todayTasks = store?.tasks.filter((task) => classifyTask(task, today) === 'today') ?? [];
  const routines = store?.routines.filter((routine) => isRoutineScheduled(routine, today)) ?? [];
  const completedRoutineIds = new Set(store?.routineCompletions.filter((completion) => completion.date === today).map((completion) => completion.routineId) ?? []);
  const completedCount = routines.filter((routine) => completedRoutineIds.has(routine.id)).length;
  const totalItems = todayTasks.length + routines.length;
  const progress = totalItems === 0 ? 0 : Math.round((completedCount / totalItems) * 100);
  const currentTask = todayTasks[0];

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-600 p-5 text-white shadow-sm">
        <p className="text-sm font-medium text-brand-100">現在の作業</p>
        <h2 className="mt-2 text-2xl font-semibold">{currentTask?.title ?? '現在の作業はありません'}</h2>
        <p className="mt-2 text-sm text-brand-50">{currentTask ? `予想 ${currentTask.estimatedMinutes}分・優先度 ${currentTask.priority}` : 'Tasksから今日締切のタスクを追加できます。'}</p>
      </section>

      {error ? <ErrorState title="保存データを利用できません" description={error} /> : null}
      {recoveryNotice ? <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{recoveryNotice}</p> : null}
      {isLoading ? <LoadingState /> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard title="サンプル予定" value="10:00 / AI作業枠" subtitle="AI Planner実装後に実データを反映" />
        <StatusCard title="今日の進捗" value={`${progress}%`} subtitle={`${completedCount} / ${totalItems} 完了`} tone="success" />
        <StatusCard title="再計画" value="今から組み直す" subtitle="空き時間を見直す" tone="warning" />
      </div>

      {!isLoading && store ? <section className="rounded-3xl border border-violet-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">今日のルーティン</h3><p className="mt-1 text-xs text-slate-500">{today}・Asia/Tokyo</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">繰り返し</span></div>
        {routines.length === 0 ? <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">今日実行する有効なルーティンはありません。</p> : <div className="mt-4 space-y-3">{routines.map((routine) => {
          const completed = completedRoutineIds.has(routine.id);
          return <article key={routine.id} className="flex items-start gap-3 rounded-2xl bg-violet-50/70 p-3"><button type="button" onClick={() => toggleRoutineCompletion(routine.id, today)} aria-label={`${routine.name}を${completed ? '未完了に戻す' : '今日完了にする'}`} className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${completed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-violet-400 bg-white text-violet-700'}`}>{completed ? '✓' : '○'}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className={`font-semibold ${completed ? 'text-slate-500 line-through' : ''}`}>{routine.name}</h4><span className="text-xs font-medium text-violet-800">予想 {routine.estimatedMinutes}分</span></div>{routine.description ? <p className="mt-1 text-sm text-slate-600">{routine.description}</p> : null}<p className="mt-1 text-xs text-slate-500">{routine.availableStartTime && routine.availableEndTime ? `${routine.availableStartTime}–${routine.availableEndTime}` : '時間帯指定なし'}・優先度 {routine.priority}</p></div></article>;
        })}</div>}
      </section> : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">今日のタイムライン</h3><p className="mt-1 text-xs text-slate-500">サンプル表示・AI Planner実装後に反映</p></div><button type="button" className="min-h-10 rounded-full bg-brand-50 px-3 text-sm font-medium text-brand-700">今日を組む</button></div>
        <div className="mt-4 space-y-3">{timeline.map((item) => <div key={item.time} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3"><div className={`mt-1 h-3 w-3 rounded-full ${item.type === 'ai' ? 'bg-brand-500' : 'bg-slate-400'}`} /><div className="flex-1"><div className="flex items-center justify-between gap-2"><p className="font-medium">{item.title}</p><span className="text-sm text-slate-500">{item.time}</span></div>{item.note ? <p className="mt-1 text-sm text-slate-600">{item.note}</p> : null}</div></div>)}</div>
      </section>
    </div>
  );
}
