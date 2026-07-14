'use client';

import { LocalStorageTaskRepository } from '@/lib/task-repository';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset(): void }) {
  const resetLocalData = () => {
    if (!window.confirm('端末内のタスクとルーティンを初期状態へ戻しますか？現在のデータは別キーへ退避されます。')) return;
    try {
      new LocalStorageTaskRepository().resetWithBackup();
      window.location.reload();
    } catch {
      window.alert('ローカルデータを初期化できませんでした。ブラウザのストレージ設定を確認してください。');
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-10">
      <section className="w-full rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-rose-700">予期しないエラー</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">画面を表示できませんでした</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">一時的な問題の可能性があります。まず再試行し、解消しない場合だけローカルデータを初期化してください。</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="min-h-12 rounded-xl bg-brand-600 px-4 font-semibold text-white">再試行</button>
          <button type="button" onClick={resetLocalData} className="min-h-12 rounded-xl bg-rose-50 px-4 font-semibold text-rose-700">ローカルデータを初期化</button>
        </div>
      </section>
    </main>
  );
}
