'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  STOCK_PAYMENT_METHODS,
  STOCK_PAYMENT_METHOD_LABELS,
  type StockPaymentMethod,
  formatStockMoney,
  formatStockQuantity,
  stockRefundAmount,
} from '@ocall/shared';
import {
  PrintReceiptButton,
  ReceiptPreview,
  type StockReceiptView,
  type StockRegisterView,
  type StockSaleView,
} from '@/components/stock/pos';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { asApiError, newIdempotencyKey } from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';

/** Fiche d'une vente : lignes, paiements, ticket (réimpression, PDF), retours et remboursements. */
export default function StockSalePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <StockPage title="Vente" description="Ticket, paiements, retours et remboursements.">
      {(p) => <Sale id={id} page={p} />}
    </StockPage>
  );
}

function Sale({ id, page }: { id: string; page: StockPageProps }) {
  const sale = useApi<StockSaleView>(`/ocall-stock/sales/${id}`);
  const [receipt, setReceipt] = useState<StockReceiptView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const money = (n: number) => formatStockMoney(n, page.context.currency);

  if (sale.state === 'loading') return <LoadingState />;
  if (sale.state === 'error') return <ErrorState error={sale.error} onRetry={sale.reload} />;
  const s = sale.data;

  async function reprint() {
    setError(null);
    try {
      setReceipt(
        await api<StockReceiptView>(`/ocall-stock/sales/${s.id}/reprint`, { method: 'POST' }),
      );
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title={s.label}
          description={`${new Date(s.createdAt).toLocaleString('fr-FR')} · ${s.register.name} · ${s.cashierName}${s.customer ? ` · ${s.customer.name}` : ''}`}
        />
        <div data-testid="stock-sale-lines">
          <Table head={['Article', 'Quantité', 'Prix', 'Remise', 'Total', 'Retourné']}>
            {s.lines.map((l) => (
              <tr key={l.id}>
                <Td>
                  <span className="font-semibold">{l.label}</span>
                  <span className="block font-mono text-xs text-muted">{l.sku}</span>
                </Td>
                <Td>{formatStockQuantity(l.quantity)}</Td>
                <Td>{money(l.unitPrice)}</Td>
                <Td>{l.discount ? `-${money(l.discount)}` : '—'}</Td>
                <Td>{money(l.total)}</Td>
                <Td>{l.returnedQuantity ? formatStockQuantity(l.returnedQuantity) : '—'}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <CardBody className="space-y-1 text-sm">
          {s.discountTotal > 0 && <p>Remises : -{money(s.discountTotal)}</p>}
          <p className="text-base font-bold">Total TTC : {money(s.total)}</p>
          <p className="text-muted">dont TVA {money(s.vatTotal)}</p>
          <ul className="pt-2">
            {s.payments.map((p) => (
              <li key={p.id}>
                {p.returnId ? 'Remboursement' : 'Paiement'} {STOCK_PAYMENT_METHOD_LABELS[p.method]}{' '}
                : {money(Math.abs(p.amount))}
                {p.reference ? ` · réf. ${p.reference}` : ''}
              </li>
            ))}
            {s.changeGiven > 0 && <li>Monnaie rendue : {money(s.changeGiven)}</li>}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Ticket"
          description={
            s.reprintCount > 0 ? `Réimprimé ${s.reprintCount} fois (duplicata).` : undefined
          }
        />
        <CardBody className="space-y-4">
          <ApiErrorAlert error={error} />
          {receipt && <ReceiptPreview receipt={receipt} />}
          <div className="flex flex-wrap gap-3">
            {receipt ? (
              <PrintReceiptButton receipt={receipt} label="Imprimer le duplicata" />
            ) : (
              <Button variant="secondary" onClick={() => void reprint()}>
                Réimprimer (duplicata)
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                void downloadFile(`/ocall-stock/sales/${s.id}/receipt.pdf`, `ticket-${s.label}.pdf`)
              }
            >
              Ticket PDF
            </Button>
          </div>
        </CardBody>
      </Card>

      {s.returns.length > 0 && (
        <Card>
          <CardHeader title="Retours" />
          <CardBody>
            <ul className="space-y-2 text-sm" data-testid="stock-sale-returns">
              {s.returns.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{r.label}</span> ·{' '}
                  {new Date(r.createdAt).toLocaleString('fr-FR')} · {r.reason} · remboursé{' '}
                  {money(r.refundAmount)} ({STOCK_PAYMENT_METHOD_LABELS[r.refundMethod]})
                  {r.restock ? ' · remis en stock' : ' · non remis en stock'}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {page.canWrite('stock.sales.refund') &&
        s.lines.some((l) => l.returnedQuantity < l.quantity) && (
          <NewReturn sale={s} currency={page.context.currency} onDone={sale.reload} />
        )}
    </>
  );
}

function NewReturn({
  sale,
  currency,
  onDone,
}: {
  sale: StockSaleView;
  currency: string;
  onDone: () => void;
}) {
  const registers = useApi<StockRegisterView[]>('/ocall-stock/registers');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [registerId, setRegisterId] = useState('');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<StockPaymentMethod>('CASH');
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<ApiError | null>(null);
  const money = (n: number) => formatStockMoney(n, currency);

  const open =
    registers.state === 'success'
      ? registers.data.filter((r) => r.openSession && r.siteId === sale.siteId)
      : [];
  const chosen = registerId || open[0]?.id || '';
  const lines = sale.lines
    .map((l) => ({ line: l, quantity: Number(quantities[l.id] ?? 0) || 0 }))
    .filter((x) => x.quantity > 0);
  const refund = lines.reduce(
    (n, x) =>
      n +
      stockRefundAmount(
        {
          quantity: x.line.quantity,
          total: x.line.total,
          returnedQuantity: x.line.returnedQuantity,
          refundedAmount: x.line.refundedAmount,
        },
        Math.min(x.quantity, x.line.quantity - x.line.returnedQuantity),
      ),
    0,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/ocall-stock/sales/${sale.id}/returns`, {
        method: 'POST',
        body: {
          idempotencyKey: key,
          registerId: chosen,
          reason,
          restock,
          refundMethod: method,
          lines: lines.map((x) => ({ saleLineId: x.line.id, quantity: x.quantity })),
        },
      });
      setQuantities({});
      setReason('');
      setKey(newIdempotencyKey());
      onDone();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Retour et remboursement"
        description="Remboursé au prorata du montant payé, dans la session ouverte d’une caisse de ce magasin."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-return-form">
          <ApiErrorAlert error={error} />
          {registers.state === 'success' && open.length === 0 && (
            <Alert tone="info" title="Aucune caisse ouverte dans ce magasin">
              Ouvrez une caisse pour rembourser.
            </Alert>
          )}
          <div className="space-y-2">
            {sale.lines
              .filter((l) => l.returnedQuantity < l.quantity)
              .map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    {l.label}{' '}
                    <span className="text-xs text-muted">
                      (vendu {formatStockQuantity(l.quantity)}
                      {l.returnedQuantity
                        ? `, déjà retourné ${formatStockQuantity(l.returnedQuantity)}`
                        : ''}
                      )
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    max={l.quantity - l.returnedQuantity}
                    aria-label={`Quantité retournée de ${l.label}`}
                    className="h-9 w-24 rounded-lg border border-line px-2"
                    value={quantities[l.id] ?? ''}
                    onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                  />
                </div>
              ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Caisse qui rembourse"
              value={chosen}
              onChange={(e) => setRegisterId(e.target.value)}
              options={open.map((r) => ({ value: r.id, label: r.name }))}
            />
            <SelectField
              label="Remboursement"
              value={method}
              onChange={(e) => setMethod(e.target.value as StockPaymentMethod)}
              options={STOCK_PAYMENT_METHODS.map((m) => ({
                value: m,
                label: STOCK_PAYMENT_METHOD_LABELS[m],
              }))}
            />
            <InputField
              label="Motif"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={restock}
              onChange={(e) => setRestock(e.target.checked)}
            />
            <span>
              Remettre en stock
              <span className="block text-xs text-muted">
                Décochez pour un article défectueux : il n’est pas remis en vente.
              </span>
            </span>
          </label>
          <p className="text-sm">
            À rembourser : <span className="font-semibold">{money(refund)}</span>
          </p>
          <Button
            type="submit"
            disabled={!chosen || lines.length === 0 || reason.trim().length < 3}
          >
            Enregistrer le retour
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
