import { reviewData } from '@/lib/mock-data';

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Review</h2>
          <p className="mt-2 text-sm text-slate-600">今日の計画と実績をざっと確認できます。</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">完了率</p>
          <p className="mt-2 text-3xl font-semibold text-brand-600">75%</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold">カテゴリー別の簡易表示</h3>
        <div className="mt-4 space-y-3">
          {reviewData.map((item) => (
            <div key={item.label} className="rounded-2xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{item.label}</p>
                <span className="text-sm text-slate-500">{item.rate}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                <span>計画 {item.planned}</span>
                <span>実績 {item.actual}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
