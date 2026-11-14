'use client';

import { useState } from 'react';
import {
  STOCK_SHOWCASE_REQUEST_KIND_LABELS,
  STOCK_SHOWCASE_REQUEST_STATUSES,
  STOCK_SHOWCASE_REQUEST_STATUS_LABELS,
  type StockShowcaseRequestKind,
  type StockShowcaseRequestStatus,
  formatStockQuantity,
} from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface RequestRow {
  id: string;
  kind: StockShowcaseRequestKind;
  status: StockShowcaseRequestStatus;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  items: { productId: string; name: string; quantity: number }[];
  /** Boutique choisie par le visiteur (S10). */
  site?: { id: string; name: string } | null;
  createdAt: string;
}

const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/**
 * Demandes reçues par le site vitrine Stock (S7) : renseignements et demandes de devis, avec les articles
 * choisis par le visiteur. Elles ne créent jamais de vente ni de commande : l'équipe rappelle le client,
 * prépare le devis ou la vente, puis classe la demande.
 */
export default function StockShowcaseRequestsPage() {
  return (
    <StockPage
      title="Demandes du site"
      description="Renseignements et demandes de devis reçus par votre site vitrine."
    >
      {({ canWrite, can }) =>
        can('stock.showcase.requests') ? (
          <Requests editable={canWrite('stock.showcase.requests')} />
        ) : (
          <Alert tone="info" title="Les demandes du site ne sont pas accessibles à votre rôle." />
        )
      }
    </StockPage>
  );
}

function Requests({ editable }: { editable: boolean }) {
  const [status, setStatus] = useState<StockShowcaseRequestStatus | ''>('NEW');
  const list = useApi<RequestRow[]>(
    `/ocall-stock/showcase/requests${status ? `?status=${status}` : ''}`,
  );
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <>
      <Card>
        <CardBody>
          <SelectField
            label="Statut"
            value={status}
            onChange={(e) => setStatus(e.target.value as StockShowcaseRequestStatus | '')}
            options={[
              { value: '', label: 'Toutes' },
              ...STOCK_SHOWCASE_REQUEST_STATUSES.map((s) => ({
                value: s,
                label: STOCK_SHOWCASE_REQUEST_STATUS_LABELS[s],
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
          <ul className="space-y-3" data-testid="stock-showcase-requests">
            {list.data.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardBody className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {STOCK_SHOWCASE_REQUEST_KIND_LABELS[r.kind]} · {r.name}
                      </span>
                      <Badge tone={r.status === 'NEW' ? 'savanna' : 'neutral'}>
                        {STOCK_SHOWCASE_REQUEST_STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      Reçue le {dateTimeFr(r.createdAt)}
                      {r.site && (
                        <span data-testid="stock-request-site"> · Boutique : {r.site.name}</span>
                      )}
                    </p>
                    {r.items.length > 0 && (
                      <ul className="list-disc pl-5">
                        {r.items.map((i) => (
                          <li key={i.productId}>
                            {i.name} : {formatStockQuantity(i.quantity)}
                          </li>
                        ))}
                      </ul>
                    )}
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
                            await api(`/ocall-stock/showcase/requests/${r.id}`, {
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
                        options={STOCK_SHOWCASE_REQUEST_STATUSES.map((s) => ({
                          value: s,
                          label: STOCK_SHOWCASE_REQUEST_STATUS_LABELS[s],
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
