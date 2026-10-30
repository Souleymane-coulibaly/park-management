'use client';

import type { ReactNode } from 'react';
import { Store } from 'lucide-react';
import { useRememberedChoice } from '@/components/pos/cash-session';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export interface ScopedEstablishment {
  id: string;
  name: string;
}

/**
 * Choix d'un établissement (mémorisé sur l'appareil par `storageKey`), puis rendu du contenu pour
 * l'établissement choisi. Partagé par les écrans du parc et du restaurant.
 */
export function EstablishmentScope<T extends ScopedEstablishment>({
  source,
  storageKey,
  emptyTitle,
  emptyDescription,
  children,
}: {
  /** Route de l'API listant les établissements accessibles pour cet écran. */
  source: string;
  storageKey: string;
  emptyTitle: string;
  emptyDescription: string;
  children: (establishment: T) => ReactNode;
}) {
  const establishments = useApi<T[]>(source);
  const [selected, choose] = useRememberedChoice(
    storageKey,
    establishments.state === 'success' ? establishments.data.map((e) => e.id) : null,
  );

  if (establishments.state === 'loading') return <LoadingState />;
  if (establishments.state === 'error')
    return <ErrorState error={establishments.error} onRetry={establishments.reload} />;
  if (establishments.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Store className="h-7 w-7" />}
          title={emptyTitle}
          description={emptyDescription}
        />
      </Card>
    );
  }
  const current = establishments.data.find((e) => e.id === selected);
  return (
    <div className="space-y-3">
      {establishments.data.length > 1 ? (
        <div className="w-full max-w-xs">
          <SelectField
            label="Établissement"
            value={selected ?? ''}
            onChange={(e) => choose(e.target.value)}
            options={establishments.data.map((e) => ({ value: e.id, label: e.name }))}
          />
        </div>
      ) : (
        <p className="text-lg font-bold">{establishments.data[0]!.name}</p>
      )}
      {current && (
        <div key={current.id} className="space-y-3">
          {children(current)}
        </div>
      )}
    </div>
  );
}
