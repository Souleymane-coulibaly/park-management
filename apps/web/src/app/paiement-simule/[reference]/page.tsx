'use client';

import { useEffect, useState } from 'react';
import { type ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ApiErrorAlert } from '@/components/ui/states';

/**
 * Page de paiement SIMULÉE (tests et démonstration, jamais en production) : elle tient le rôle de
 * la page sécurisée du prestataire. L'issue choisie est notifiée au serveur, qui la revérifie.
 */
export default function SimulatedCheckoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void params.then((p) => setReference(p.reference));
  }, [params]);

  async function choose(
    outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    method?: 'CARD' | 'MOBILE_MONEY',
  ) {
    if (!reference) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/online-payments/simulated/${encodeURIComponent(reference)}/complete`, {
        method: 'POST',
        body: { outcome, ...(method ? { method } : {}) },
      });
      window.location.assign(`/app/abonnement/paiement/${encodeURIComponent(reference)}`);
    } catch (e) {
      setError(e as ApiError);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardBody className="space-y-4">
          <h1 className="font-display text-xl font-bold">Paiement simulé</h1>
          <Alert tone="info">
            Environnement de test : aucun argent n’est débité. En production, cette étape se fait
            sur la page sécurisée du prestataire.
          </Alert>
          <p className="text-sm text-muted">Référence {reference ?? '…'}</p>
          <div className="grid gap-2">
            <Button loading={busy} onClick={() => choose('SUCCEEDED', 'MOBILE_MONEY')}>
              Payer par mobile money
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => choose('SUCCEEDED', 'CARD')}>
              Payer par carte
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => choose('FAILED')}>
              Simuler un échec
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => choose('CANCELLED')}>
              Annuler le paiement
            </Button>
          </div>
          <ApiErrorAlert error={error} />
        </CardBody>
      </Card>
    </main>
  );
}
