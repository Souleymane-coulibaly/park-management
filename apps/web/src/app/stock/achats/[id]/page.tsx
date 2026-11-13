'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { STOCK_PURCHASE_STATUS_LABELS, formatStockMoney, formatStockQuantity } from '@ocall/shared';
import { useSiteLocations } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockVariantRef,
  asApiError,
  newIdempotencyKey,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';
import { Documents, purchaseTone } from '@/components/stock/purchases';

interface PurchaseView {
  id: string;
  label: string;
  status: string;
  supplier: { id: string; name: string };
  site: { id: string; code: string; name: string };
  expectedAt: string | null;
  note: string | null;
  totals?: { ht: number; vat: number; ttc: number };
  lines: {
    id: string;
    variant: StockVariantRef;
    quantity: number;
    receivedQuantity: number;
    remaining: number;
    unitCost?: number;
    vatRate: number;
  }[];
  receipts: {
    id: string;
    label: string;
    status: 'VALIDATED' | 'CANCELLED';
    deliveryRef: string | null;
    createdAt: string;
    cancelReason: string | null;
    lines: {
      orderLineId: string;
      variantId: string;
      quantity: number;
      unitCost?: number;
      location: { code: string } | null;
    }[];
  }[];
}

/** Fiche d'une commande fournisseur : passage, réception, annulation de réception, documents, étiquettes. */
export default function StockPurchasePage() {
  return <StockPage title="Commande fournisseur">{(p) => <Purchase {...p} />}</StockPage>;
}

function Purchase({ context, can, canWrite }: StockPageProps) {
  const { id } = useParams<{ id: string }>();
  const order = useApi<PurchaseView>(`/ocall-stock/purchase-orders/${id}`);
  const o = order.state === 'success' ? order.data : null;
  const { locations } = useSiteLocations(o?.site.id ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<
    Record<string, { quantity: string; locationId: string; unitCost: string }>
  >({});
  const [deliveryRef, setDeliveryRef] = useState('');
  const [updatePrices, setUpdatePrices] = useState(false);
  const [receiptKey, setReceiptKey] = useState(newIdempotencyKey);
  const [cancelReason, setCancelReason] = useState('');
  const seeCost = can('stock.prices.purchase.read');
  const money = (v: number) => formatStockMoney(v, context.currency);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      order.reload();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (order.state === 'loading') return <LoadingState />;
  if (order.state === 'error') return <ErrorState error={order.error} onRetry={order.reload} />;
  const p = order.data;
  const manage = canWrite('stock.purchases.manage');
  const receiving =
    (p.status === 'ORDERED' || p.status === 'PARTIALLY_RECEIVED') &&
    canWrite('stock.purchases.receive');
  const defaultLocation = locations.find((l) => l.kind === 'DEFAULT')?.id ?? '';

  async function receive() {
    const lines = p.lines
      .filter((l) => l.remaining > 0)
      .map((l) => {
        const r = receipt[l.id];
        return {
          orderLineId: l.id,
          quantity: Number(r?.quantity ?? l.remaining),
          locationId: r?.locationId || defaultLocation,
          ...(seeCost && r?.unitCost ? { unitCost: Number(r.unitCost) } : {}),
        };
      })
      .filter((l) => l.quantity > 0);
    await api(`/ocall-stock/purchase-orders/${p.id}/receive`, {
      method: 'POST',
      body: {
        idempotencyKey: receiptKey,
        deliveryRef: deliveryRef.trim() || null,
        updatePurchasePrices: updatePrices,
        lines,
      },
    });
    setReceipt({});
    setDeliveryRef('');
    setReceiptKey(newIdempotencyKey());
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title={`${p.label} — ${p.supplier.name}`}
          description={`Livraison : ${p.site.code} · ${p.site.name}${p.expectedAt ? ` · attendue le ${new Date(p.expectedAt).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` : ''}`}
          action={
            <span data-testid="stock-purchase-status">
              <Badge tone={purchaseTone(p.status)}>{STOCK_PURCHASE_STATUS_LABELS[p.status]}</Badge>
            </span>
          }
        />
        <div data-testid="stock-purchase-lines">
          <Table
            head={[
              'Article',
              'Commandé',
              'Reçu',
              seeCost ? 'Coût HT' : '',
              receiving ? 'Réception' : '',
            ]}
          >
            {p.lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  {variantLabel(l.variant)}
                  <span className="block font-mono text-xs text-muted">{l.variant.sku}</span>
                </Td>
                <Td>{formatStockQuantity(l.quantity)}</Td>
                <Td>{formatStockQuantity(l.receivedQuantity)}</Td>
                <Td>
                  {seeCost && l.unitCost !== undefined
                    ? `${money(l.unitCost)} · TVA ${l.vatRate} %`
                    : ''}
                </Td>
                <Td>
                  {receiving && l.remaining > 0 && (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`Quantité reçue de ${variantLabel(l.variant)}`}
                        className="w-20 rounded-lg border border-line px-2 py-1"
                        value={receipt[l.id]?.quantity ?? String(l.remaining)}
                        onChange={(e) =>
                          setReceipt((r) => ({
                            ...r,
                            [l.id]: {
                              locationId: r[l.id]?.locationId ?? '',
                              unitCost: r[l.id]?.unitCost ?? '',
                              quantity: e.target.value,
                            },
                          }))
                        }
                      />
                      <select
                        aria-label={`Rangement de ${variantLabel(l.variant)}`}
                        className="rounded-lg border border-line px-2 py-1 text-sm"
                        value={receipt[l.id]?.locationId || defaultLocation}
                        onChange={(e) =>
                          setReceipt((r) => ({
                            ...r,
                            [l.id]: {
                              quantity: r[l.id]?.quantity ?? String(l.remaining),
                              unitCost: r[l.id]?.unitCost ?? '',
                              locationId: e.target.value,
                            },
                          }))
                        }
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.code} · {loc.name}
                          </option>
                        ))}
                      </select>
                      {seeCost && (
                        <input
                          type="number"
                          min={0}
                          aria-label={`Coût reçu de ${variantLabel(l.variant)}`}
                          placeholder="Coût réel"
                          className="w-24 rounded-lg border border-line px-2 py-1"
                          value={receipt[l.id]?.unitCost ?? ''}
                          onChange={(e) =>
                            setReceipt((r) => ({
                              ...r,
                              [l.id]: {
                                quantity: r[l.id]?.quantity ?? String(l.remaining),
                                locationId: r[l.id]?.locationId ?? '',
                                unitCost: e.target.value,
                              },
                            }))
                          }
                        />
                      )}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
        {p.totals && (
          <CardBody className="text-right text-sm">
            Total HT {money(p.totals.ht)} · TVA {money(p.totals.vat)} ·{' '}
            <strong>TTC {money(p.totals.ttc)}</strong>
          </CardBody>
        )}
        <CardBody className="flex flex-wrap items-end gap-3">
          {p.status === 'DRAFT' && manage && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/ocall-stock/purchase-orders/${p.id}/order`, { method: 'POST' }),
                )
              }
            >
              Passer la commande
            </Button>
          )}
          {receiving && (
            <>
              <InputField
                label="Bon de livraison (facultatif)"
                value={deliveryRef}
                onChange={(e) => setDeliveryRef(e.target.value)}
              />
              {canWrite('stock.prices.manage') && (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={updatePrices}
                    onChange={(e) => setUpdatePrices(e.target.checked)}
                  />
                  Reporter les coûts reçus sur les articles
                </label>
              )}
              <Button disabled={busy || !defaultLocation} onClick={() => void run(receive)}>
                Enregistrer la réception
              </Button>
            </>
          )}
          {(p.status === 'ORDERED' || p.status === 'PARTIALLY_RECEIVED') && manage && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/ocall-stock/purchase-orders/${p.id}/close`, { method: 'POST' }),
                )
              }
            >
              Clore (reste non attendu)
            </Button>
          )}
          {(p.status === 'DRAFT' || p.status === 'ORDERED') && manage && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/ocall-stock/purchase-orders/${p.id}/cancel`, { method: 'POST' }),
                )
              }
            >
              Annuler la commande
            </Button>
          )}
          {seeCost && (
            <Button
              variant="ghost"
              onClick={() =>
                void run(() =>
                  downloadFile(`/ocall-stock/purchase-orders/${p.id}/pdf`, 'bon-de-commande.pdf'),
                )
              }
            >
              Bon de commande (PDF)
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Réceptions" />
        {p.receipts.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">Aucune réception.</p>
          </CardBody>
        ) : (
          <CardBody className="space-y-4" data-testid="stock-receipts">
            {manage && (
              <InputField
                label="Motif d’annulation d’une réception"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            )}
            {p.receipts.map((r) => (
              <div key={r.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {r.label} · {new Date(r.createdAt).toLocaleString('fr-FR')}
                    {r.deliveryRef && (
                      <span className="ml-2 text-xs text-muted">BL {r.deliveryRef}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {r.status === 'CANCELLED' ? (
                      <Badge>Annulée{r.cancelReason ? ` : ${r.cancelReason}` : ''}</Badge>
                    ) : (
                      <>
                        {can('stock.labels.print') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void run(() =>
                                downloadFile('/ocall-stock/labels.pdf', 'etiquettes.pdf', {
                                  format: '50x30',
                                  fields: [
                                    'storeName',
                                    'productName',
                                    'variant',
                                    'barcode',
                                    'price',
                                  ],
                                  items: r.lines.map((l) => ({
                                    variantId: l.variantId,
                                    copies: Math.min(200, Math.max(1, Math.ceil(l.quantity))),
                                  })),
                                }),
                              )
                            }
                          >
                            Étiquettes
                          </Button>
                        )}
                        {manage && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || cancelReason.trim().length < 3}
                            onClick={() =>
                              void run(() =>
                                api(`/ocall-stock/receipts/${r.id}/cancel`, {
                                  method: 'POST',
                                  body: { reason: cancelReason.trim() },
                                }),
                              )
                            }
                          >
                            Annuler la réception
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </div>
                <ul className="mt-2 text-sm text-charcoal-soft">
                  {r.lines.map((l) => {
                    const line = p.lines.find((x) => x.id === l.orderLineId);
                    return (
                      <li key={l.orderLineId}>
                        {line ? variantLabel(line.variant) : ''} : {formatStockQuantity(l.quantity)}{' '}
                        en {l.location?.code ?? '—'}
                        {seeCost && l.unitCost !== undefined ? ` · ${money(l.unitCost)}` : ''}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      <Documents
        ownerType="PURCHASE_ORDER"
        ownerId={p.id}
        canAdd={canWrite('stock.purchases.manage') || canWrite('stock.purchases.receive')}
        canRemove={manage}
      />
      {p.status === 'DRAFT' && (
        <Alert tone="info" title="Brouillon">
          La commande reste modifiable jusqu’à ce que vous la passiez ; ensuite ses lignes ne
          changent plus.
        </Alert>
      )}
    </>
  );
}
