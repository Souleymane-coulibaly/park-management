'use client';

import type { ReactNode } from 'react';
import { EstablishmentScope } from '@/components/app/establishment-scope';
import type { ParkEstablishment } from '@/lib/types';

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
  return (
    <EstablishmentScope<ParkEstablishment>
      source={source}
      storageKey="ocp.park.establishment"
      emptyTitle="Aucun parc disponible"
      emptyDescription="Cet écran fonctionne dans un établissement parc actif auquel vous êtes affecté. Contactez votre responsable."
    >
      {children}
    </EstablishmentScope>
  );
}
