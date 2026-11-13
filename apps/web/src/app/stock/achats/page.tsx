'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { STOCK_PURCHASE_STATUS_LABELS, STOCK_VAT_RATES, formatStockMoney } from '@ocall/shared';
import { VariantPicker } from '@/components/stock/pickers';
import { purchaseTone } from '@/components/stock/purchases';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockSiteView,
  type StockSupplierView,
  type StockVariantRef,
  asApiError,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface PurchaseRow {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  expectedAt: string | null;
  supplier: { id: string; name: string };
  site: { code: string; name: string };
  lineCount: number;
  totalHt?: number;
  progress: number;
}

/** Commandes fournisseurs : en cours, reçues, closes. */
export default function StockPurchasesPage() {
  return (
    <StockPage title="Achats" description="Commandes fournisseurs, réceptions et retours.">
      {(p) =>
        p.can('stock.purchases.read') ? (
          <Purchases {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Les achats sont réservés aux responsables et aux magasiniers.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Purchases({ context, canWrite, can }: StockPageProps) {
  const [open, setOpen] = useState(true);
  const list = useApi<PurchaseRow[]>(`/ocall-stock/purchase-orders?open=${open}`);
  const seeCost = can('stock.prices.purchase.read');
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          En cours seulement
        </label>
        <Link
          href="/stock/achats/retours"
          className="text-sm font-medium text-forest hover:underline"
        >
          Retours fournisseurs →
        </Link>
      </div>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucune commande.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-purchase-list">
              <Table
                head={[
                  'Commande',
                  'Fournisseur',
                  'Site',
                  seeCost ? 'Total HT' : 'Lignes',
                  'Reçu',
                  'État',
                ]}
              >
                {list.data.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link
                        href={`/stock/achats/${o.id}`}
                        className="font-semibold hover:underline"
                      >
                        {o.label}
                      </Link>
                      <span className="block text-xs text-muted">
                        {new Date(o.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </Td>
                    <Td>{o.supplier.name}</Td>
                    <Td>{o.site.code}</Td>
                    <Td>
                      {seeCost && o.totalHt !== undefined
                        ? formatStockMoney(o.totalHt, context.currency)
                        : o.lineCount}
                    </Td>
                    <Td>{Math.round(o.progress * 100)} %</Td>
                    <Td>
                      <Badge tone={purchaseTone(o.status)}>
                        {STOCK_PURCHASE_STATUS_LABELS[o.status]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canWrite('stock.purchases.manage') && seeCost && <NewPurchase />}
    </>
  );
}

function NewPurchase() {
  const router = useRouter();
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const suppliers = useApi<StockSupplierView[]>('/ocall-stock/suppliers');
  const [supplierId, setSupplier] = useState('');
  const [siteId, setSite] = useState('');
  const [expectedAt, setExpected] = useState('');
  const [lines, setLines] = useState<
    { variant: StockVariantRef; quantity: string; unitCost: string; vatRate: string }[]
  >([]);
  const [picking, setPicking] = useState<StockVariantRef | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  function setLine(id: string, patch: Partial<(typeof lines)[number]>) {
    setLines((cur) => cur.map((l) => (l.variant.id === id ? { ...l, ...patch } : l)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const o = await api<{ id: string }>('/ocall-stock/purchase-orders', {
        method: 'POST',
        body: {
          supplierId,
          siteId,
          expectedAt: expectedAt || null,
          lines: lines.map((l) => ({
            variantId: l.variant.id,
            quantity: Number(l.quantity),
            unitCost: Number(l.unitCost),
            vatRate: Number(l.vatRate),
          })),
        },
      });
      router.push(`/stock/achats/${o.id}`);
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Nouvelle commande"
        description="Brouillon modifiable jusqu’à ce que vous la passiez."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-purchase-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Fournisseur"
              value={supplierId}
              onChange={(e) => setSupplier(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...(suppliers.state === 'success'
                  ? suppliers.data.map((s) => ({ value: s.id, label: s.name }))
                  : []),
              ]}
            />
            <SelectField
              label="Site de livraison"
              value={siteId}
              onChange={(e) => setSite(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...(sites.state === 'success'
                  ? sites.data.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
                  : []),
              ]}
            />
            <InputField
              label="Livraison attendue (facultatif)"
              type="date"
              value={expectedAt}
              onChange={(e) => setExpected(e.target.value)}
            />
          </div>
          <VariantPicker
            value={picking}
            label="Article à commander"
            onChange={(v) => {
              if (v && !lines.some((l) => l.variant.id === v.id)) {
                setLines((cur) => [
                  ...cur,
                  { variant: v, quantity: '1', unitCost: '', vatRate: '18' },
                ]);
              }
              setPicking(null);
            }}
          />
          {lines.length > 0 && (
            <Table head={['Article', 'Quantité', 'Coût HT', 'TVA', '']}>
              {lines.map((l) => (
                <tr key={l.variant.id}>
                  <Td>{variantLabel(l.variant)}</Td>
                  <Td>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Quantité de ${variantLabel(l.variant)}`}
                      className="w-24 rounded-lg border border-line px-2 py-1"
                      value={l.quantity}
                      onChange={(e) => setLine(l.variant.id, { quantity: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <input
                      type="number"
                      min={0}
                      aria-label={`Coût de ${variantLabel(l.variant)}`}
                      className="w-28 rounded-lg border border-line px-2 py-1"
                      value={l.unitCost}
                      onChange={(e) => setLine(l.variant.id, { unitCost: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <select
                      aria-label={`TVA de ${variantLabel(l.variant)}`}
                      className="rounded-lg border border-line px-2 py-1"
                      value={l.vatRate}
                      onChange={(e) => setLine(l.variant.id, { vatRate: e.target.value })}
                    >
                      {STOCK_VAT_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r} %
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      className="text-xs text-terracotta hover:underline"
                      onClick={() =>
                        setLines((cur) => cur.filter((x) => x.variant.id !== l.variant.id))
                      }
                    >
                      Retirer
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <Button
            type="submit"
            disabled={
              !supplierId || !siteId || lines.length === 0 || lines.some((l) => l.unitCost === '')
            }
          >
            Créer le brouillon
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
