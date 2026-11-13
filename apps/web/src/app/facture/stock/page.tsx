'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  STOCK_FACTURE_SOURCE_LABELS,
  type StockFactureSource,
  type StockFactureSyncStatus,
  formatStockQuantity,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { StockSyncNote } from '@/components/facture/stock-picker';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SyncRow {
  id: string;
  source: StockFactureSource;
  reference: string;
  status: StockFactureSyncStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  document: { id: string; type: string; number: string | null } | null;
  intervention: { id: string; number: string } | null;
  lines: { variantId: string; quantity: number; label: string }[];
}

const STATUS_FILTERS = [
  { value: '', label: 'Toutes les demandes' },
  { value: 'FAILED', label: 'En échec' },
  { value: 'PENDING', label: 'En cours' },
  { value: 'DONE', label: 'Stock mis à jour' },
  { value: 'SKIPPED', label: 'Stock non mis à jour' },
];

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Ocall Stock depuis Facture (S5) : facture d'une vente en caisse, et suivi des demandes de mouvement
 * (factures, pièces d'interventions, avoirs) avec relance de celles en échec.
 */
export default function FactureStockPage() {
  return (
    <FacturePage
      title="Ocall Stock"
      description="Facturer une vente en caisse et suivre la mise à jour du stock par vos factures, interventions et avoirs."
    >
      {({ canWrite }) => (
        <StockScreen
          canInvoice={canWrite('facture.documents.manage')}
          canRetry={canWrite('facture.settings.manage')}
        />
      )}
    </FacturePage>
  );
}

function StockScreen({ canInvoice, canRetry }: { canInvoice: boolean; canRetry: boolean }) {
  const status = useApi<{ available: boolean; writable: boolean }>('/facture/stock/status');
  if (status.state === 'loading') return <LoadingState />;
  if (status.state === 'error') return <ErrorState error={status.error} onRetry={status.reload} />;
  if (!status.data.available) {
    return (
      <Alert tone="info" title="Ocall Stock n’est pas activé pour votre organisation">
        Ocall Facture fonctionne sans Ocall Stock, avec son propre catalogue. Avec les deux
        applications, les articles Stock se recherchent dans vos documents et le stock se met à jour
        à l’émission des factures. Voir{' '}
        <Link href="/suite" className="font-semibold underline">
          Mes applications
        </Link>
        .
      </Alert>
    );
  }
  return (
    <>
      {!status.data.writable && (
        <Alert tone="info" title="Ocall Stock en consultation seule">
          L’abonnement Ocall Stock est échu : les factures émises maintenant ne mettent pas le stock
          à jour (« stock non mis à jour »). Vos documents et articles restent intacts.
        </Alert>
      )}
      {canInvoice && <InvoiceSale />}
      <SyncList canRetry={canRetry} />
    </>
  );
}

function InvoiceSale() {
  const router = useRouter();
  const clients = useApi<{ id: string; name: string }[]>('/facture/clients');
  const [sale, setSale] = useState('');
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const doc = await api<{ id: string }>('/facture/stock/sales/invoice', {
        method: 'POST',
        body: { sale: sale.trim(), clientId },
      });
      router.push(`/facture/documents/${doc.id}`);
    } catch (e) {
      setError(toError(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Facturer une vente en caisse" />
      <CardBody className="space-y-4">
        <p className="text-sm text-muted">
          Crée un brouillon de facture reprenant les articles et les montants encaissés de la vente.
          Ses articles sont déjà sortis du stock : la facture ne les ressortira pas. Une seule
          facture par vente.
        </p>
        <ApiErrorAlert error={error} />
        <form
          className="grid gap-4 sm:grid-cols-3 sm:items-end"
          data-testid="facture-stock-invoice-sale"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <InputField
            label="Numéro de la vente"
            placeholder="VTE-000123"
            required
            maxLength={40}
            value={sale}
            onChange={(e) => setSale(e.target.value)}
          />
          <SelectField
            label="Client"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Choisir un client' },
              ...(clients.state === 'success' ? clients.data : []).map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
          <Button type="submit" loading={busy} disabled={!sale.trim() || !clientId}>
            Créer la facture
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function SyncList({ canRetry }: { canRetry: boolean }) {
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = useApi<SyncRow[]>(
    `/facture/stock/sync${filter ? `?${new URLSearchParams({ status: filter })}` : ''}`,
  );

  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/facture/stock/sync/${id}/retry`, { method: 'POST' });
      rows.reload();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Mise à jour du stock" />
      <CardBody className="space-y-4">
        <div className="max-w-xs">
          <SelectField
            label="Afficher"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={STATUS_FILTERS}
          />
        </div>
        <ApiErrorAlert error={error} />
        {rows.state === 'loading' && <LoadingState />}
        {rows.state === 'error' && <ErrorState error={rows.error} onRetry={rows.reload} />}
        {rows.state === 'success' && rows.data.length === 0 && (
          <p className="text-sm text-muted">Aucune demande.</p>
        )}
        {rows.state === 'success' && rows.data.length > 0 && (
          <ul className="divide-y divide-line" data-testid="facture-stock-sync-list">
            {rows.data.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {r.document ? (
                      <Link
                        href={`/facture/documents/${r.document.id}`}
                        className="text-forest underline"
                      >
                        {r.reference}
                      </Link>
                    ) : r.intervention ? (
                      <Link
                        href={`/facture/interventions/${r.intervention.id}`}
                        className="text-forest underline"
                      >
                        {r.reference}
                      </Link>
                    ) : (
                      r.reference
                    )}{' '}
                    <span className="font-normal text-muted">
                      · {STOCK_FACTURE_SOURCE_LABELS[r.source]} ·{' '}
                      {new Date(r.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </p>
                  {canRetry && r.status === 'FAILED' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === r.id}
                      onClick={() => void retry(r.id)}
                    >
                      Relancer
                    </Button>
                  )}
                </div>
                <StockSyncNote sync={r} link={false} />
                {r.lines.length > 0 && (
                  <p className="text-sm text-muted">
                    {r.lines
                      .map(
                        (l) =>
                          `${l.label} : ${l.quantity > 0 ? '+' : '−'}${formatStockQuantity(Math.abs(l.quantity))}`,
                      )
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
