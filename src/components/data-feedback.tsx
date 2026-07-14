export function DataFeedback({ message }: { message: string | null }) {
  return message ? <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{message}</p> : null;
}
