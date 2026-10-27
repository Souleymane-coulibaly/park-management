import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCw } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Button } from './button';

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-forest" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="pattern-kente mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-savanna-light/60 text-forest">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-charcoal">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-terracotta-light text-terracotta-dark">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">
        {error.status === 403 ? 'Accès refusé' : 'Impossible de charger les données'}
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted">{error.message}</p>
      {onRetry && error.status !== 403 && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          icon={<RotateCw className="h-4 w-4" />}
        >
          Réessayer
        </Button>
      )}
    </div>
  );
}

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

/** Affiche une erreur d'API avec ses détails de validation éventuels. */
export function ApiErrorAlert({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const details = error.detailMessages;
  return (
    <Alert tone="error" title={error.message}>
      {details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
