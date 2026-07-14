interface ErrorStateProps {
  title: string;
  description: string;
  onRetry?: () => void;
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-rose-700">{title}</h2>
      <p className="mt-2 text-sm text-rose-700/80">{description}</p>
      {onRetry ? <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-full bg-rose-700 px-4 text-sm font-semibold text-white">再試行</button> : null}
    </div>
  );
}
