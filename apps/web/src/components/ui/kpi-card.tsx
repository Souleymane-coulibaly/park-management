import type { ReactNode } from 'react';

type Accent = 'forest' | 'savanna' | 'terracotta';

const ACCENTS: Record<Accent, string> = {
  forest: 'bg-forest-light text-forest',
  savanna: 'bg-savanna-light text-charcoal',
  terracotta: 'bg-terracotta-light text-terracotta-dark',
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  accent = 'forest',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  accent?: Accent;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line/80 bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold text-charcoal sm:text-3xl">{value}</p>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ACCENTS[accent]}`}>
          {icon}
        </div>
      </div>
      {hint && <div className="mt-3 text-sm text-muted">{hint}</div>}
    </div>
  );
}
