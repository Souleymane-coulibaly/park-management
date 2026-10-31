'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

interface PaymentStatus {
  reference: string;
  status:
    'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVIEW_REQUIRED' | 'REFUNDED';
  amount: number;
  currency: string;
  invoice: { number: string; status: string };
  activationStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REFUSED' | null;
}

const FINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REVIEW_REQUIRED', 'REFUNDED']);

/**
 * Retour du client après le paiement. Cette page ne confirme rien : elle interroge l'API, qui
 * revérifie la transaction auprès du prestataire tant qu'elle n'est pas aboutie.
 */
export default function PaymentReturnPage({ params }: { params: Promise<{ reference: string }> }) {
  const [reference, setReference] = useState<string | null>(null);
  const [data, setData] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void params.then((p) => setReference(p.reference));
  }, [params]);

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    api<PaymentStatus>(`/billing/online-payments/${encodeURIComponent(reference)}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // Encore en cours : nouvelle vérification dans 4 s (au plus 15 fois).
        if (!FINAL.has(d.status) && attempt < 15) {
          setTimeout(() => !cancelled && setAttempt((a) => a + 1), 4000);
        }
      })
      .catch((e: ApiError) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [reference, attempt]);

  if (error) return <ErrorState error={error} onRetry={() => setAttempt((a) => a + 1)} />;
  if (!data) return <LoadingState />;

  const ok = data.status === 'SUCCEEDED';
  const failed = data.status === 'FAILED' || data.status === 'CANCELLED';
  return (
    <>
      <PageHeader title="Paiement de votre facture" description={`Référence ${data.reference}`} />
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            {ok ? (
              <CheckCircle2 className="h-8 w-8 text-forest" aria-hidden />
            ) : failed ? (
              <XCircle className="h-8 w-8 text-terracotta-dark" aria-hidden />
            ) : (
              <Clock className="h-8 w-8 text-savanna" aria-hidden />
            )}
            <div>
              <p className="font-display text-xl font-bold">
                {ok
                  ? 'Paiement confirmé'
                  : data.status === 'CANCELLED'
                    ? 'Paiement annulé'
                    : data.status === 'FAILED'
                      ? 'Paiement non abouti'
                      : data.status === 'REVIEW_REQUIRED'
                        ? 'Paiement en cours d’examen'
                        : 'Paiement en cours de vérification'}
              </p>
              <p className="text-sm text-muted">
                Facture {data.invoice.number} · {formatXof(data.amount)}
              </p>
            </div>
          </div>
          {ok && data.activationStatus === 'PENDING' && (
            <Alert tone="info">
              Votre paiement est enregistré. L’équipe Ocall vérifie votre dossier avant d’activer
              l’abonnement.
            </Alert>
          )}
          {ok && data.activationStatus === 'APPROVED' && (
            <Alert tone="success">Votre abonnement est activé.</Alert>
          )}
          {data.status === 'REVIEW_REQUIRED' && (
            <Alert tone="info">
              Le prestataire a signalé une anomalie. Aucun montant n’est encaissé sans vérification
              : l’équipe Ocall vous recontacte. Gardez votre reçu de paiement.
            </Alert>
          )}
          {!FINAL.has(data.status) && (
            <p className="text-sm text-muted">
              La confirmation vient du prestataire de paiement, pas de votre navigateur. Cette page
              se met à jour automatiquement.
            </p>
          )}
          <Link
            href="/app/abonnement"
            className="inline-block text-sm font-semibold text-forest underline"
          >
            Retour à l’abonnement
          </Link>
        </CardBody>
      </Card>
    </>
  );
}
