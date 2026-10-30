'use client';

import type { ReactNode } from 'react';
import { EstablishmentScope } from '@/components/app/establishment-scope';
import type { RestaurantEstablishment } from '@/lib/types';

/**
 * Choix de l'établissement restaurant (mémorisé sur l'appareil, partagé par les écrans commandes,
 * cuisine, tables, stocks, réservations et tableau de bord).
 */
export function RestaurantScope({
  children,
}: {
  children: (establishment: RestaurantEstablishment) => ReactNode;
}) {
  return (
    <EstablishmentScope<RestaurantEstablishment>
      source="/restaurant/establishments"
      storageKey="ocp.restaurant.establishment"
      emptyTitle="Aucun restaurant disponible"
      emptyDescription="Cet écran fonctionne dans un établissement avec une activité restaurant auquel vous êtes affecté. Contactez votre responsable."
    >
      {children}
    </EstablishmentScope>
  );
}
