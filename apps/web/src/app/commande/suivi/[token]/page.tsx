'use client';

import { use, useEffect } from 'react';
import { CheckCircle2, ChefHat, Clock } from 'lucide-react';
import { PREPARATION_STATUS_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import type { PublicOrderStatus } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Rafraîchissement du suivi : le client n'a pas de connexion temps réel (page publique). */
const REFRESH_MS = 10_000;

const STEPS = ['Demande envoyée', 'Validée', 'En cuisine', 'Prête', 'Servie'] as const;

function currentStep(s: PublicOrderStatus): number {
  if (s.status !== 'ACCEPTED' || !s.order) return 0;
  switch (s.order.preparationStatus) {
    case 'NOT_SENT':
      return 1;
    case 'SENT':
    case 'IN_PREPARATION':
      return 2;
    case 'READY':
      return 3;
    case 'SERVED':
      return 4;
  }
}

/** Suivi d'une demande de commande par le client (lien conservé sur son téléphone). */
export default function PublicOrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const status = useApi<PublicOrderStatus>(`/public/order-requests/${encodeURIComponent(token)}`);
  const { reload } = status;
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  if (status.state === 'loading') return <LoadingState label="Chargement de votre commande…" />;
  if (status.state === 'error') return <ErrorState error={status.error} onRetry={reload} />;
  const s = status.data;
  const step = currentStep(s);
  const rejected = s.status === 'REJECTED';
  const cancelled = s.order?.cancelled;

  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-forest p-5 text-white">
        <p className="text-sm opacity-90">{s.establishmentName}</p>
        <h1 className="mt-1 text-2xl font-bold">
          {s.order ? `Commande n° ${formatSaleNumber(s.order.number)}` : 'Votre demande'}
        </h1>
        {s.location && <p className="mt-1 text-sm opacity-90">{s.location}</p>}
      </header>

      {rejected ? (
        <Alert tone="error" title="Demande refusée">
          {s.rejectedReason} — adressez-vous au personnel.
        </Alert>
      ) : cancelled ? (
        <Alert tone="error" title="Commande annulée">
          Adressez-vous au personnel.
        </Alert>
      ) : (
        <ol className="space-y-2" aria-label="Avancement" data-testid="order-steps">
          {STEPS.map((label, index) => {
            const done = index <= step;
            return (
              <li
                key={label}
                aria-current={index === step ? 'step' : undefined}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${done ? 'border-forest/40 bg-forest-light' : 'border-line bg-surface text-muted'}`}
              >
                {index === 2 && done ? (
                  <ChefHat className="h-5 w-5 text-forest" aria-hidden />
                ) : done ? (
                  <CheckCircle2 className="h-5 w-5 text-forest" aria-hidden />
                ) : (
                  <Clock className="h-5 w-5" aria-hidden />
                )}
                <span className="font-semibold">{label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {s.status === 'PENDING_VALIDATION' && (
        <Alert tone="info">
          Votre demande attend la validation du personnel. Elle n’est ni payée ni envoyée en cuisine
          pour l’instant.
        </Alert>
      )}
      {s.order && !cancelled && (
        <Alert tone="info">
          Préparation : {PREPARATION_STATUS_LABELS[s.order.preparationStatus].toLowerCase()} ·
          Paiement : {s.order.paymentStatus === 'PAID' ? 'réglé' : 'à régler auprès du personnel'}.
        </Alert>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-2 font-semibold">Détail</h2>
        <ul className="space-y-1 text-sm">
          {s.lines.map((l, i) => (
            <li key={i}>
              {l.quantity} × {l.productName} ({l.variantName})
              {l.notes && <span className="text-terracotta-dark"> — {l.notes}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between font-semibold">
          <span>{s.order ? 'Total' : 'Total indicatif'}</span>
          <span>{formatXof(s.order?.total ?? s.estimatedTotal)}</span>
        </p>
      </section>
      <p className="text-center text-xs text-muted">Cette page se met à jour automatiquement.</p>
    </div>
  );
}
