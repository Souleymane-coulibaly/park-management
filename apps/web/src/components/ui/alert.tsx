import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

type AlertTone = 'error' | 'success' | 'info';
const ALERT_STYLES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  error: {
    box: 'border-terracotta/40 bg-terracotta-light/60 text-terracotta-dark',
    icon: <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />,
  },
  success: {
    box: 'border-forest/30 bg-forest-light text-forest-dark',
    icon: <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />,
  },
  info: {
    box: 'border-savanna/40 bg-savanna-light/60 text-charcoal',
    icon: <Info className="h-5 w-5 shrink-0" aria-hidden />,
  },
};

export function Alert({
  tone,
  title,
  children,
}: {
  tone: AlertTone;
  title?: string;
  children?: ReactNode;
}) {
  const style = ALERT_STYLES[tone];
  return (
    <div
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${style.box}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {style.icon}
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
