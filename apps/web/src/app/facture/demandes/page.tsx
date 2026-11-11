'use client';

import { useState } from 'react';
import {
  FACTURE_REQUEST_KIND_LABELS,
  FACTURE_REQUEST_STATUSES,
  FACTURE_REQUEST_STATUS_LABELS,
  type FactureRequestKind,
  type FactureRequestStatus,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface RequestRow {
  id: string;
  kind: FactureRequestKind;
  status: FactureRequestStatus;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  serviceLabel: string | null;
  preferredDate: string | null;
  createdAt: string;
}

const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/**
 * Demandes reçues par le site vitrine (F5) : contact, devis, intervention, rendez-vous. Elles ne créent
 * jamais rien automatiquement : l'équipe les traite (rappel, devis, planification) et les classe.
 */
export default function FactureRequestsPage() {
  return (
    <FacturePage
      title="Demandes du site"
      description="Contacts, devis, interventions et rendez-vous demandés par vos visiteurs."
    >
      {({ canWrite, context }) =>
        context.permissions.includes('facture.requests.manage') ? (
          <Requests editable={canWrite('facture.requests.manage')} />
        ) : (
          <Alert tone="info" title="Les demandes du site ne sont pas accessibles à votre rôle." />
        )
      }
    </FacturePage>
  );
}

function Requests({ editable }: { editable: boolean }) {
  const [status, setStatus] = useState<FactureRequestStatus | ''>('NEW');
  const list = useApi<RequestRow[]>(`/facture/requests${status ? `?status=${status}` : ''}`);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <>
      <Card>
        <CardBody>
          <SelectField
            label="Statut"
            value={status}
            onChange={(e) => setStatus(e.target.value as FactureRequestStatus | '')}
            options={[
              { value: '', label: 'Toutes' },
              ...FACTURE_REQUEST_STATUSES.map((s) => ({
                value: s,
                label: FACTURE_REQUEST_STATUS_LABELS[s],
              })),
            ]}
          />
        </CardBody>
      </Card>
      <ApiErrorAlert error={error} />
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' &&
        (list.data.length === 0 ? (
          <p className="text-center text-sm text-muted">Aucune demande.</p>
        ) : (
          <ul className="space-y-3" data-testid="facture-requests">
            {list.data.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardBody className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {FACTURE_REQUEST_KIND_LABELS[r.kind]} · {r.name}
                      </span>
                      <Badge tone={r.status === 'NEW' ? 'savanna' : 'neutral'}>
                        {FACTURE_REQUEST_STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      Reçue le {dateTimeFr(r.createdAt)}
                      {r.serviceLabel ? ` · ${r.serviceLabel}` : ''}
                      {r.preferredDate
                        ? ` · date souhaitée : ${new Date(r.preferredDate).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`
                        : ''}
                    </p>
                    <p className="whitespace-pre-line">{r.message}</p>
                    <p className="text-charcoal-soft">
                      {[r.phone, r.email].filter(Boolean).join(' · ')}
                    </p>
                    {editable && (
                      <SelectField
                        label="Traitement"
                        value={r.status}
                        onChange={async (e) => {
                          setError(null);
                          try {
                            await api(`/facture/requests/${r.id}`, {
                              method: 'PATCH',
                              body: { status: e.target.value },
                            });
                            list.reload();
                          } catch (err) {
                            setError(
                              err instanceof ApiError
                                ? err
                                : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
                            );
                          }
                        }}
                        options={FACTURE_REQUEST_STATUSES.map((s) => ({
                          value: s,
                          label: FACTURE_REQUEST_STATUS_LABELS[s],
                        }))}
                      />
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
