import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { OfflineRetry } from './offline-retry';

export const metadata: Metadata = {
  title: 'Hors connexion',
  robots: { index: false, follow: false },
};

/** Page servie par le Service Worker quand une page de l'application ne peut pas être chargée. */
export default function HorsLignePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-ivory p-6 text-center">
      <div className="max-w-md space-y-4">
        <WifiOff className="mx-auto h-16 w-16 text-terracotta-dark" aria-hidden />
        <h1 className="font-display text-3xl font-bold">Pas de connexion</h1>
        <p className="text-lg">
          Ocall Park a besoin du réseau pour vendre et contrôler les billets. Aucune entrée ne peut
          être validée pour le moment.
        </p>
        <p className="text-sm text-muted">La page se recharge dès que le réseau revient.</p>
        <OfflineRetry />
      </div>
    </main>
  );
}
