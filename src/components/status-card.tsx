interface StatusCardProps {
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

const toneStyles = {
  default: 'border-slate-200 bg-white text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function StatusCard({ title, value, subtitle, tone = 'default' }: StatusCardProps) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneStyles[tone]}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {subtitle ? <p className="mt-1 text-sm opacity-80">{subtitle}</p> : null}
    </div>
  );
}
