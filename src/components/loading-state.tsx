export function LoadingState() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 animate-pulse rounded-full bg-brand-500" />
        <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
      </div>
      <div className="mt-4 h-3 w-full animate-pulse rounded-full bg-slate-100" />
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded-full bg-slate-100" />
    </div>
  );
}
