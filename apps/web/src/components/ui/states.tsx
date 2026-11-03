import type { ReactNode } from 'react';

export { Alert } from './alert';
// États qui lisent les textes de l'interface (langue de l'application) : composants client.
export { ApiErrorAlert, ErrorState, LoadingState } from './ui-text';

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
