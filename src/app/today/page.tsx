import { StatusCard } from '@/components/status-card';
import { timeline, tasks } from '@/lib/mock-data';

export default function TodayPage() {
  const todayTasks = tasks.filter((task) => task.status === 'today' || task.status === 'completed');
  const progress = Math.round((todayTasks.filter((task) => task.completed).length / todayTasks.length) * 100);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-600 p-5 text-white shadow-sm">
        <p className="text-sm font-medium text-brand-100">現在の作業</p>
        <h2 className="mt-2 text-2xl font-semibold">営業資料の修正</h2>
        <p className="mt-2 text-sm text-brand-50">次の予定まで 20 分。集中を切らさずに進めましょう。</p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard title="次の予定" value="10:00 / AI作業枠" subtitle="英語の復習" />
        <StatusCard title="今日の進捗" value={`${progress}%`} subtitle="2 / 3 完了" tone="success" />
        <StatusCard title="再計画" value="今から組み直す" subtitle="空き時間を見直す" tone="warning" />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">今日のタイムライン</h3>
          <button className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">今日を組む</button>
        </div>
        <div className="mt-4 space-y-3">
          {timeline.map((item) => (
            <div key={item.time} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <div className={`mt-1 h-3 w-3 rounded-full ${item.type === 'ai' ? 'bg-brand-500' : 'bg-slate-400'}`} />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{item.title}</p>
                  <span className="text-sm text-slate-500">{item.time}</span>
                </div>
                {item.note ? <p className="mt-1 text-sm text-slate-600">{item.note}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
