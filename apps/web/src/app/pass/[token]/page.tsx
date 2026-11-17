'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { PASS_KIND_LABELS } from '@ocall/shared';
import { PassStateBadge, formatPassDay } from '@/components/park/pass-ui';
import { TicketQr } from '@/components/park/ticket-qr';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useWakeLock } from '@/lib/hardware/use-terminal';
import type { PublicPass } from '@/lib/types';

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * Page du titulaire, sans compte, ouverte par son lien personnel. Le QR est calculé par le serveur et
 * redemandé à chaque renouvellement (30 s pour un QR dynamique) : aucune clé n'est dans le navigateur,
 * et une capture d'écran devient inutilisable en moins d'une minute.
 */
export default function PublicPassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicPass | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  useWakeLock(true);

  const load = useCallback(async () => {
    if (!TOKEN.test(token)) {
      setError(new ApiError(404, 'PASS_LINK_INVALID', 'Lien invalide ou révoqué.'));
      return;
    }
    try {
      const pass = await api<PublicPass>(`/public/passes/${token}`);
      setData(pass);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // Compte à rebours jusqu'au prochain QR, puis nouvelle demande au serveur.
  useEffect(() => {
    if (!data?.expiresAt) {
      setLeft(null);
      return;
    }
    const expiresAt = new Date(data.expiresAt).getTime();
    let requested = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setLeft(remaining);
      // Une seule demande par QR ; en cas d'échec, nouvel essai toutes les 5 secondes.
      if (remaining === 0 && !requested) {
        requested = true;
        void load().finally(() => setTimeout(() => (requested = false), 5000));
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data?.expiresAt, load]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-4 bg-ivory px-4 py-6 text-center">
      {!data && !error && <LoadingState label="Chargement du pass…" />}
      {error && !data && (
        <div className="w-full">
          {error.status === 404 ? (
            <div className="rounded-3xl border border-line bg-surface p-6">
              <p className="text-lg font-bold">Lien invalide ou révoqué</p>
              <p className="mt-2 text-sm text-muted">
                Demandez un nouveau lien à l’accueil du parc.
              </p>
            </div>
          ) : (
            <ErrorState error={error} onRetry={() => void load()} />
          )}
        </div>
      )}
      {data && (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">
            {data.organizationName}
          </p>
          <h1 className="font-display text-2xl font-bold">{data.offerName}</h1>
          <p className="text-base">
            {PASS_KIND_LABELS[data.kind]} · {data.holderFirstName}
          </p>
          <PassStateBadge state={data.state} />
          <p className="text-sm text-muted">
            Du {formatPassDay(data.startDate)} au {formatPassDay(data.endDate)}
          </p>
          {data.qr ? (
            <div className="rounded-3xl bg-white p-4 shadow-card" data-testid="public-pass-qr">
              <TicketQr value={data.qr} size={260} label="QR code du pass" />
            </div>
          ) : (
            <div className="rounded-3xl border border-line bg-surface p-6 text-sm">
              Ce pass n’est pas utilisable aujourd’hui : aucun QR n’est affiché.
            </div>
          )}
          {data.qr && data.qrMode === 'DYNAMIC' && left !== null && (
            <p className="text-sm text-muted" aria-live="polite">
              Nouveau QR dans {left} s · une capture d’écran ne fonctionne pas.
            </p>
          )}
          {error && (
            <p className="text-sm text-terracotta-dark">
              Connexion perdue : le QR affiché sera bientôt périmé.
            </p>
          )}
        </>
      )}
    </main>
  );
}
