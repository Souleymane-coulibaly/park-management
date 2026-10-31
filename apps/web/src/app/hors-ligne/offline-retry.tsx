'use client';

import { useEffect } from 'react';

const RETRY_MS = 5_000;

/** Recharge la page demandée au retour du réseau (la page hors ligne est servie à son adresse). */
function resume() {
  if (window.location.pathname === '/hors-ligne') window.location.assign('/app');
  else window.location.reload();
}

export function OfflineRetry() {
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/v1/health', {
          cache: 'no-store',
          signal: AbortSignal.timeout(RETRY_MS),
        });
        if (res.status < 500) resume();
      } catch {
        // Toujours hors connexion : nouvel essai à l'intervalle suivant.
      }
    };
    const timer = setInterval(() => void check(), RETRY_MS);
    window.addEventListener('online', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', check);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={resume}
      className="min-h-12 rounded-xl bg-forest px-6 font-semibold text-white"
    >
      Réessayer
    </button>
  );
}
