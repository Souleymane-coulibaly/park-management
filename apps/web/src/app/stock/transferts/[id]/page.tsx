'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { STOCK_TRANSFER_STATUS_LABELS, formatStockQuantity } from '@ocall/shared';
import { useSiteLocations } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockTransferView,
  asApiError,
  newIdempotencyKey,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Fiche d'un transfert : préparation, expédition, réception (partielle), manque, annulation. */
export default function StockTransferPage() {
  return <StockPage title="Transfert">{(p) => <Transfer {...p} />}</StockPage>;
}

function Transfer({ canWrite }: StockPageProps) {
  const { id } = useParams<{ id: string }>();
  const transfer = useApi<StockTransferView>(`/ocall-stock/transfers/${id}`);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const t = transfer.state === 'success' ? transfer.data : null;
  const from = useSiteLocations(t?.fromSite.id ?? null);
  const to = useSiteLocations(t?.toSite.id ?? null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Record<string, { quantity: string; locationId: string }>>(
    {},
  );
  const [receiptKey, setReceiptKey] = useState(newIdempotencyKey);
  const [lossReason, setLossReason] = useState('');

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      transfer.reload();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (transfer.state === 'loading') return <LoadingState />;
  if (transfer.state === 'error')
    return <ErrorState error={transfer.error} onRetry={transfer.reload} />;
  const tr = transfer.data;
  const manage = canWrite('stock.transfers.manage');
  const receive = canWrite('stock.transfers.receive');
  const receiving = tr.status === 'SHIPPED' || tr.status === 'PARTIALLY_RECEIVED';
  const defaultTo = to.locations.find((l) => l.kind === 'DEFAULT')?.id ?? '';
  const select = (
    value: string,
    onChange: (v: string) => void,
    options: { id: string; code: string; name: string }[],
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line px-2 py-1 text-sm"
    >
      <option value="">Choisir…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.code} · {o.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title={`${tr.label} : ${tr.fromSite.code} → ${tr.toSite.code}`}
          description={`${tr.fromSite.name} vers ${tr.toSite.name}`}
          action={
            <span data-testid="stock-transfer-status">
              <Badge
                tone={
                  tr.status === 'RECEIVED'
                    ? 'forest'
                    : tr.status === 'CANCELLED'
                      ? 'neutral'
                      : 'savanna'
                }
              >
                {STOCK_TRANSFER_STATUS_LABELS[tr.status]}
              </Badge>
            </span>
          }
        />
        <div data-testid="stock-transfer-lines">
          <Table
            head={[
              'Article',
              'Demandé',
              'Prélèvement',
              'Expédié',
              'Reçu',
              'Manque',
              'En transit',
              receiving && receive ? 'Réception' : '',
            ]}
          >
            {tr.lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  {variantLabel(l.variant)}
                  <span className="block font-mono text-xs text-muted">{l.variant.sku}</span>
                </Td>
                <Td>{formatStockQuantity(l.quantity)}</Td>
                <Td>
                  {tr.status === 'REQUESTED' && manage
                    ? select(
                        picks[l.id] ?? '',
                        (v) => setPicks((p) => ({ ...p, [l.id]: v })),
                        from.locations,
                        `Prélèvement de ${variantLabel(l.variant)}`,
                      )
                    : (l.fromLocation?.code ?? '—')}
                </Td>
                <Td>{formatStockQuantity(l.shippedQuantity)}</Td>
                <Td>{formatStockQuantity(l.receivedQuantity)}</Td>
                <Td>
                  {l.lostQuantity
                    ? `${formatStockQuantity(l.lostQuantity)}${l.lossReason ? ` (${l.lossReason})` : ''}`
                    : '—'}
                </Td>
                <Td>{formatStockQuantity(l.inTransit)}</Td>
                <Td>
                  {receiving && receive && l.inTransit > 0 && (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`Quantité reçue de ${variantLabel(l.variant)}`}
                        className="w-20 rounded-lg border border-line px-2 py-1"
                        value={receipt[l.id]?.quantity ?? String(l.inTransit)}
                        onChange={(e) =>
                          setReceipt((r) => ({
                            ...r,
                            [l.id]: {
                              quantity: e.target.value,
                              locationId: r[l.id]?.locationId ?? defaultTo,
                            },
                          }))
                        }
                      />
                      {select(
                        receipt[l.id]?.locationId ?? defaultTo,
                        (v) =>
                          setReceipt((r) => ({
                            ...r,
                            [l.id]: {
                              quantity: r[l.id]?.quantity ?? String(l.inTransit),
                              locationId: v,
                            },
                          })),
                        to.locations,
                        `Rangement de ${variantLabel(l.variant)}`,
                      )}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
        <CardBody className="flex flex-wrap gap-3">
          {tr.status === 'REQUESTED' && manage && (
            <Button
              disabled={busy || tr.lines.some((l) => !picks[l.id])}
              onClick={() =>
                void run(() =>
                  api(`/ocall-stock/transfers/${tr.id}/prepare`, {
                    method: 'POST',
                    body: {
                      lines: tr.lines.map((l) => ({ lineId: l.id, fromLocationId: picks[l.id] })),
                    },
                  }),
                )
              }
            >
              Préparer (réserver)
            </Button>
          )}
          {tr.status === 'PREPARED' && manage && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() => api(`/ocall-stock/transfers/${tr.id}/ship`, { method: 'POST' }))
              }
            >
              Expédier
            </Button>
          )}
          {(tr.status === 'REQUESTED' || tr.status === 'PREPARED') && manage && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() => api(`/ocall-stock/transfers/${tr.id}/cancel`, { method: 'POST' }))
              }
            >
              Annuler le transfert
            </Button>
          )}
          {receiving && receive && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const lines = tr.lines
                      .filter((l) => l.inTransit > 0)
                      .map((l) => ({
                        lineId: l.id,
                        quantity: Number(receipt[l.id]?.quantity ?? l.inTransit),
                        toLocationId: receipt[l.id]?.locationId ?? defaultTo,
                      }))
                      .filter((l) => l.quantity > 0);
                    await api(`/ocall-stock/transfers/${tr.id}/receive`, {
                      method: 'POST',
                      body: { idempotencyKey: receiptKey, lines },
                    });
                    setReceipt({});
                    setReceiptKey(newIdempotencyKey());
                  })
                }
              >
                Enregistrer la réception
              </Button>
              <span className="flex flex-wrap items-end gap-2">
                <InputField
                  label="Motif du manque"
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={busy || lossReason.trim().length < 3}
                  onClick={() =>
                    void run(() =>
                      api(`/ocall-stock/transfers/${tr.id}/loss`, {
                        method: 'POST',
                        body: {
                          lines: tr.lines
                            .filter((l) => l.inTransit > 0)
                            .map((l) => ({ lineId: l.id, reason: lossReason.trim() })),
                        },
                      }),
                    )
                  }
                >
                  Déclarer le reste manquant
                </Button>
              </span>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
