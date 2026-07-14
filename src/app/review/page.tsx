'use client';

import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useTaskData } from '@/components/task-data-provider';
import { tokyoDateKey } from '@/lib/date-time';
import { buildReviewSummary } from '@/lib/practical-mvp';

export default function ReviewPage() {
  const { store, isLoading, error, retry } = useTaskData();
  const summary = store ? buildReviewSummary(store, tokyoDateKey()) : null;
  const hasActivity = summary ? summary.weekCompletedTasks + summary.weekRoutineCompletions > 0 : false;

  return <div className="space-y-4">
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-xl font-semibold">振り返り</h2><p className="mt-1 text-sm text-slate-600">今週の実績と、残っている作業を簡潔に確認します。</p></section>
    {error ? <ErrorState title="振り返りを表示できません" description={error} onRetry={retry} /> : null}
    {isLoading ? <LoadingState /> : null}
    {!isLoading && summary ? <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric label="今日の完了タスク" value={`${summary.todayCompletedTasks}件`} />
        <Metric label="今週の完了タスク" value={`${summary.weekCompletedTasks}件`} />
        <Metric label="今週のルーティン" value={`${summary.weekRoutineCompletions}回`} />
        <Metric label="ルーティン実施率" value={`${summary.routineRate}%`} />
        <Metric label="未完了タスク" value={`${summary.openTasks}件`} />
        <Metric label="期限超過" value={`${summary.overdueTasks}件`} warning={summary.overdueTasks > 0} />
      </div>
      {!hasActivity ? <EmptyState title="今週の実績はまだありません" description="タスクやルーティンを完了すると、ここに日別実績が表示されます。" /> : <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-lg font-semibold">日別の実績</h3><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-7">{summary.days.map((day) => <div key={day.date} className={`rounded-2xl p-3 ${day.date === tokyoDateKey() ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-slate-50'}`}><p className="text-xs font-semibold text-slate-500">{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short', month: 'numeric', day: 'numeric' }).format(new Date(`${day.date}T12:00:00+09:00`))}</p><p className="mt-2 text-sm">タスク <strong>{day.taskCount}</strong></p><p className="mt-1 text-sm text-violet-700">習慣 <strong>{day.routineCount}</strong></p></div>)}</div></section>}
    </> : null}
  </div>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={`rounded-2xl border p-4 shadow-sm ${warning ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${warning ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p></div>;
}
