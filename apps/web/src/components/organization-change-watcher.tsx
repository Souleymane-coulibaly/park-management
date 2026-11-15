'use client';

import { useEffect } from 'react';
import { isMemberArea, onOrganizationChange } from '@/lib/organization-change';

/**
 * Recharge un onglet des espaces connectés quand un autre onglet change d'organisation : aucun écran
 * ne reste affiché sur l'organisation quittée avec la session de la nouvelle.
 */
export function OrganizationChangeWatcher() {
  useEffect(
    () =>
      onOrganizationChange(() => {
        if (isMemberArea(window.location.pathname)) window.location.assign('/suite');
      }),
    [],
  );
  return null;
}
