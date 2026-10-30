'use client';

import type { ReactNode } from 'react';
import { Store } from 'lucide-react';
import { useRememberedChoice } from '@/components/pos/cash-session';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { ParkEstablishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STORAGE_KEY = 'ocp.park.establishment';

/**
 * Choix de l'établissement parc (mémorisé sur l'appareil, partagé par les écrans de la billetterie
 * et du contrôle d'accès), puis rendu du contenu pour l'établissement choisi.
 */
export function ParkEstablishmentScope({
  source,
  children,
}: {
  /** /ticketing/establishments (vente, gestion) ou /access/establishments (contrôle d'accès). */
  source: string;
  children: (establishment: ParkEstablishment) => ReactNode;
}) {
  const establishments = useApi<ParkEstablishment[]>(source);
  const [selected, choose] = useRememberedChoice(
    STORAGE_KEY,
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
          title="Aucun parc disponible"
          description="Cet écran fonctionne dans un établissement parc actif auquel vous êtes affecté. Contactez votre responsable."
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
