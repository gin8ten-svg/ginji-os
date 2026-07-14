'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useTaskData } from '@/components/task-data-provider';
import { formatDueAt, isRoutineScheduled, tokyoDateKey } from '@/lib/date-time';
import { isOverdueTask, monthGrid, monthShift } from '@/lib/practical-mvp';
import { useTokyoDateKey } from '@/lib/use-tokyo-date';

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

export default function CalendarPage() {
  const { store, isLoading, error, retry } = useTaskData();
  const today = useTokyoDateKey();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const initialMonth = today ? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) } : null;
  const yearMonth = initialMonth ? monthShift(initialMonth.year, initialMonth.month, monthOffset) : null;
  const selected = selectedDate ?? today;
  const dates = useMemo(() => yearMonth ? monthGrid(yearMonth.year, yearMonth.month) : [], [yearMonth]);
  const selectedTasks = useMemo(() => store?.tasks.filter((task) => task.dueAt && tokyoDateKey(new Date(task.dueAt)) === selected).sort((a, b) => b.priority - a.priority) ?? [], [selected, store?.tasks]);
  const selectedRoutines = useMemo(() => selected ? store?.routines.filter((routine) => isRoutineScheduled(routine, selected)) ?? [] : [], [selected, store?.routines]);
  const completionSet = new Set(store?.routineCompletions.map((item) => `${item.date}:${item.routineId}`) ?? []);

  const moveMonth = (offset: number) => setMonthOffset((current) => current + offset);
  const backToToday = () => { setSelectedDate(null); setMonthOffset(0); };

  return <div className="space-y-4">
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">カレンダー</h2><p className="mt-1 text-xs text-slate-500">Asia/Tokyo・タスク期限と実績</p></div><button type="button" onClick={backToToday} className="min-h-11 rounded-full bg-brand-50 px-4 text-sm font-semibold text-brand-700">今日へ戻る</button></div>
    </section>
    {error ? <ErrorState title="カレンダーを表示できません" description={error} onRetry={retry} /> : null}
    {isLoading || !today ? <LoadingState /> : null}
    {!isLoading && store && today && selected && yearMonth ? <>
      <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex items-center justify-between"><button type="button" aria-label="前の月" onClick={() => moveMonth(-1)} className="h-11 w-11 rounded-full bg-slate-100 text-lg">‹</button><h3 className="text-lg font-semibold">{yearMonth.year}年{yearMonth.month}月</h3><button type="button" aria-label="次の月" onClick={() => moveMonth(1)} className="h-11 w-11 rounded-full bg-slate-100 text-lg">›</button></div>
        <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold text-slate-500">{weekdayLabels.map((label) => <div key={label} className="py-2">{label}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">{dates.map((date) => {
          const inMonth = Number(date.slice(5, 7)) === yearMonth.month;
          const taskCount = store.tasks.filter((task) => task.dueAt && tokyoDateKey(new Date(task.dueAt)) === date).length;
          const scheduled = store.routines.filter((routine) => isRoutineScheduled(routine, date));
          const completed = scheduled.filter((routine) => completionSet.has(`${date}:${routine.id}`)).length;
          return <button key={date} type="button" onClick={() => setSelectedDate(date)} aria-pressed={selected === date} aria-label={`${date} タスク${taskCount}件 ルーティン${completed}/${scheduled.length}`} className={`min-h-20 rounded-xl border p-1 text-left align-top transition ${selected === date ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-transparent hover:bg-slate-50'} ${inMonth ? '' : 'opacity-35'}`}><span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${date === today ? 'bg-brand-600 font-semibold text-white' : ''}`}>{Number(date.slice(8, 10))}</span><span className="mt-1 block text-[10px] text-slate-600">タスク {taskCount}</span>{scheduled.length > 0 ? <span className="block text-[10px] text-violet-700">習慣 {completed}/{scheduled.length}</span> : null}</button>;
        })}</div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-lg font-semibold">{selected.replaceAll('-', '/')} の予定</h3>
        {selectedTasks.length === 0 && selectedRoutines.length === 0 ? <div className="mt-4"><EmptyState title="この日の予定はありません" description="Tasks画面から期限やルーティンを登録できます。" /></div> : <div className="mt-4 space-y-3">{selectedTasks.map((task) => <article key={task.id} className={`rounded-2xl border p-3 ${isOverdueTask(task, today) && selected < today ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start justify-between gap-2"><h4 className={`break-words font-semibold ${task.completedAt ? 'text-slate-500 line-through' : ''}`}>{task.title}</h4>{isOverdueTask(task, today) ? <span className="shrink-0 text-xs font-semibold text-rose-700">期限超過</span> : null}</div><p className="mt-1 text-sm text-slate-600">{formatDueAt(task.dueAt)}・優先度 {task.priority}</p></article>)}{selectedRoutines.map((routine) => { const completed = completionSet.has(`${selected}:${routine.id}`); return <article key={routine.id} className="rounded-2xl bg-violet-50 p-3"><div className="flex items-center justify-between gap-2"><h4 className={`break-words font-semibold ${completed ? 'text-slate-500 line-through' : ''}`}>{routine.name}</h4><span className="shrink-0 text-xs font-semibold text-violet-700">{completed ? '完了' : '未完了'}</span></div><p className="mt-1 text-sm text-slate-600">ルーティン・{routine.estimatedMinutes}分</p></article>; })}</div>}
      </section>
    </> : null}
  </div>;
}
