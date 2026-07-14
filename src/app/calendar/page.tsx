import { timeline } from '@/lib/mock-data';

export default function CalendarPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Calendar</h2>
          <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">1日表示</span>
        </div>
        <div className="mt-4 space-y-3">
          {timeline.map((item) => (
            <div key={item.time} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${item.type === 'ai' ? 'bg-brand-500' : 'bg-slate-500'}`} />
                  <p className="font-medium">{item.title}</p>
                </div>
                <span className="text-sm text-slate-500">{item.time}</span>
              </div>
              {item.note ? <p className="mt-2 text-sm text-slate-600">{item.note}</p> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold">空き時間</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-sm text-slate-500">午前</p>
            <p className="mt-1 font-semibold">09:00 - 10:00</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-sm text-slate-500">午後</p>
            <p className="mt-1 font-semibold">15:00 - 16:00</p>
          </div>
        </div>
      </div>
    </div>
  );
}
