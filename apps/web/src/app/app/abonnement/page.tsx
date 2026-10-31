'use client';

import { CreditCard, Info } from 'lucide-react';
import { BUSINESS_TYPE_LABELS, SUBSCRIPTION_STATUS_LABELS, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { ClientInvoices } from '@/components/billing/client-invoices';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Subscription } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Abonnement créé',
  PLAN_CHANGED: 'Changement d’offre',
  STATUS_CHANGED: 'Changement de statut',
};

export default function AbonnementPage() {
  const canRead = useCan('subscription.read');
  const sub = useApi<Subscription>(canRead ? '/subscription' : null);

  if (!canRead) return <AccessDenied />;
  if (sub.state === 'loading') return <LoadingState />;
  if (sub.state === 'error') return <ErrorState error={sub.error} onRetry={sub.reload} />;

  const s = sub.data;
  return (
    <>
      <PageHeader title="Abonnement" description="Offre souscrite et historique." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardBody>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Offre</p>
                <p className="font-display text-2xl font-bold">{s.plan.name}</p>
                <p className="text-sm text-muted">{BUSINESS_TYPE_LABELS[s.plan.businessType]}</p>
              </div>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-savanna-light text-charcoal">
                <CreditCard className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-5 font-display text-3xl font-bold">
              {formatXof(s.plan.monthlyPrice)}{' '}
              <span className="text-base font-medium text-muted">/ mois</span>
            </p>
            <dl className="mt-5 space-y-2.5 border-t border-line/70 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Statut</dt>
                <dd>
                  <Badge
                    tone={
                      s.status === 'ACTIVE'
                        ? 'forest'
                        : s.status === 'NOT_ACTIVATED'
                          ? 'savanna'
                          : 'terracotta'
                    }
                  >
                    {SUBSCRIPTION_STATUS_LABELS[s.status]}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Début</dt>
                <dd>{formatDate(s.startedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Échéance</dt>
                <dd>{formatDate(s.expiresAt)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <div className="space-y-6">
          {(s.status === 'NOT_ACTIVATED' || s.status === 'PENDING_ACTIVATION') && (
            <Alert
              tone="info"
              title={
                s.status === 'PENDING_ACTIVATION'
                  ? 'Paiement reçu, activation en cours'
                  : 'Abonnement non activé'
              }
            >
              {s.status === 'PENDING_ACTIVATION'
                ? 'Votre paiement est enregistré. L’équipe Ocall vérifie votre dossier avant d’activer l’abonnement.'
                : 'Votre abonnement est activé après confirmation de votre paiement : en ligne (vérifié par notre serveur) ou auprès d’Ocall.'}
            </Alert>
          )}
          <Card>
            <CardHeader title="Historique" />
            {s.events.length === 0 ? (
              <CardBody className="flex items-center gap-2 text-sm text-muted">
                <Info className="h-4 w-4" /> Aucun événement.
              </CardBody>
            ) : (
              <ul className="divide-y divide-line/70">
                {s.events.map((e, i) => (
                  <li key={i} className="px-6 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                      <span className="text-muted">{formatDateTime(e.createdAt)}</span>
                    </div>
                    {e.reason && <p className="mt-0.5 text-muted">{e.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-6">
        <ClientInvoices />
      </div>
    </>
  );
}
