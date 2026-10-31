'use client';

import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnectivity } from '@/lib/connectivity';
import { applyUpdate, startPwa, usePwa } from '@/lib/pwa';

/** Indicateur de coupure, visible en permanence dans l'en-tête de l'application. */
export function ConnectivityBadge() {
  const online = useConnectivity();
  if (online) return null;
  return (
    <span
      role="status"
      data-testid="connectivity-badge"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-terracotta-dark px-3 py-1 text-xs font-bold text-white"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden /> Hors ligne
    </span>
  );
}

/** Démarre la PWA ; une nouvelle version est proposée, jamais imposée pendant un contrôle. */
export function PwaRuntime() {
  const { updateReady } = usePwa();
  useEffect(() => startPwa(), []);
  if (!updateReady) return null;
  return (
    <div
      role="status"
      data-testid="pwa-update"
      className="fixed inset-x-3 bottom-24 z-40 flex items-center justify-between gap-3 rounded-2xl bg-charcoal p-3 text-sm text-ivory shadow-lift lg:bottom-4 lg:left-auto lg:w-96"
    >
      <span>Nouvelle version disponible.</span>
      <Button size="sm" onClick={applyUpdate}>
        Mettre à jour
      </Button>
    </div>
  );
}
