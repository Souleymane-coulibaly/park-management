'use client';

import { type FormEvent, useState } from 'react';
import { STOCK_MOVEMENT_KIND_LABELS, formatStockQuantity } from '@ocall/shared';
import { LocationPicker, VariantPicker } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type Paged,
  type StockMovementRow,
  type StockSiteView,
  type StockVariantRef,
  asApiError,
  newIdempotencyKey,
  variantLabel,
} from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Mode = 'IN' | 'OUT' | 'ADJUSTMENT' | 'MOVE';
const MODE_LABELS: Record<Mode, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  ADJUSTMENT: 'Ajustement (correction)',
  MOVE: 'Déplacement dans le site',
};
const PAGE_SIZE = 50;

/** Mouvements : saisie (entrée, sortie, ajustement, déplacement) et registre. */
export default function StockMovementsPage() {
  return (
    <StockPage
      title="Mouvements"
      description="Entrées, sorties, ajustements et déplacements, tous tracés."
    >
      {(p) => <Movements {...p} />}
    </StockPage>
  );
}

function Movements({ canWrite, can }: StockPageProps) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const [page, setPage] = useState(1);
  const list = useApi<Paged<StockMovementRow>>(
    can('stock.movements.read')
      ? `/ocall-stock/movements?page=${page}&pageSize=${PAGE_SIZE}`
      : null,
  );
  const modes = (['IN', 'OUT', 'MOVE', 'ADJUSTMENT'] as Mode[]).filter((m) =>
    m === 'ADJUSTMENT' ? canWrite('stock.adjust') : canWrite('stock.movements.create'),
  );
  const pages = list.state === 'success' ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {modes.length > 0 && sites.state === 'success' && (
        <Entry modes={modes} sites={sites.data} onDone={list.reload} />
      )}
      {can('stock.movements.read') ? (
        <Card>
          <CardHeader
            title="Registre des mouvements"
            description="Rien ne s’efface : une correction est un nouveau mouvement."
          />
          {list.state === 'loading' && <LoadingState />}
          {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
          {list.state === 'success' && (
            <div data-testid="stock-movement-list">
              <Table
                head={['Date', 'Article', 'Site / emplacement', 'Nature', 'Quantité', 'Après']}
              >
                {list.data.items.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-xs">
                      {new Date(m.createdAt).toLocaleString('fr-FR')}
                    </Td>
                    <Td>
                      {variantLabel(m.variant)}
                      <span className="block font-mono text-xs text-muted">{m.variant.sku}</span>
                    </Td>
                    <Td>
                      {m.site.code} / {m.location.code}
                    </Td>
                    <Td>
                      {STOCK_MOVEMENT_KIND_LABELS[m.kind] ?? m.kind}
                      {m.reason && <span className="block text-xs text-muted">{m.reason}</span>}
                    </Td>
                    <Td className={m.quantity < 0 ? 'text-terracotta' : 'text-forest'}>
                      {m.quantity > 0 ? '+' : ''}
                      {formatStockQuantity(m.quantity)}
                    </Td>
                    <Td>{formatStockQuantity(m.quantityAfter)}</Td>
                  </tr>
                ))}
              </Table>
              {pages > 1 && (
                <CardBody className="flex items-center justify-between gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Précédent
                  </Button>
                  <span className="text-sm text-muted">
                    Page {page} / {pages}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Suivant
                  </Button>
                </CardBody>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Alert tone="info" title="Registre réservé">
          La consultation du registre des mouvements est réservée aux responsables.
        </Alert>
      )}
    </>
  );
}

function Entry({
  modes,
  sites,
  onDone,
}: {
  modes: Mode[];
  sites: StockSiteView[];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>(modes[0]!);
  const [variant, setVariant] = useState<StockVariantRef | null>(null);
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0]!.id : '');
  const [locationId, setLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState('');
  // Une clé par saisie : renvoyer le même formulaire (double clic, réseau) ne compte qu'une fois.
  const [idempotencyKey, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!variant) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      if (mode === 'MOVE') {
        await api('/ocall-stock/moves', {
          method: 'POST',
          body: {
            variantId: variant.id,
            fromLocationId: locationId,
            toLocationId,
            quantity: Number(quantity),
            idempotencyKey,
          },
        });
        setDone('Déplacement enregistré.');
      } else {
        const r = await api<{ quantityAfter: number }>('/ocall-stock/movements', {
          method: 'POST',
          body: {
            kind: mode,
            variantId: variant.id,
            locationId,
            quantity: Number(quantity),
            reason: reason.trim() || null,
            unitCost: mode === 'IN' && unitCost.trim() ? Number(unitCost) : null,
            idempotencyKey,
          },
        });
        setDone(
          `${MODE_LABELS[mode]} enregistrée : ${formatStockQuantity(r.quantityAfter)} en stock à cet emplacement.`,
        );
      }
      setQuantity('');
      setReason('');
      setUnitCost('');
      setKey(newIdempotencyKey());
      onDone();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Nouvelle saisie" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-movement-form">
          <ApiErrorAlert error={error} />
          {done && <Alert tone="success" title={done} />}
          <SelectField
            label="Nature"
            value={mode}
            onChange={(e) => (setMode(e.target.value as Mode), setKey(newIdempotencyKey()))}
            options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
          />
          <VariantPicker value={variant} onChange={setVariant} testId="stock-movement-variant" />
          <LocationPicker
            sites={sites}
            siteId={siteId}
            onSite={setSiteId}
            locationId={locationId}
            onLocation={setLocationId}
            label={mode === 'MOVE' ? 'Depuis l’emplacement' : 'Emplacement'}
            testId="stock-movement-location"
          />
          {mode === 'MOVE' && (
            <LocationPicker
              sites={sites}
              siteId={siteId}
              onSite={setSiteId}
              locationId={toLocationId}
              onLocation={setToLocationId}
              lockSite
              label="Vers l’emplacement"
            />
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <InputField
              label={mode === 'ADJUSTMENT' ? 'Correction (+ ou −)' : 'Quantité'}
              type="number"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {mode !== 'MOVE' && (
              <InputField
                label={mode === 'IN' ? 'Motif (facultatif)' : 'Motif'}
                required={mode !== 'IN'}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            {mode === 'IN' && (
              <InputField
                label="Coût unitaire HT (facultatif)"
                type="number"
                min={0}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            )}
          </div>
          <Button
            type="submit"
            disabled={busy || !variant || !locationId || (mode === 'MOVE' && !toLocationId)}
          >
            Enregistrer
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
