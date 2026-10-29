'use client';

import { useState } from 'react';
import { Ban, Printer, Receipt } from 'lucide-react';
import { PREPARATION_STATUS_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { PaymentDialog, ReceiptDialog } from '@/components/pos/payment-dialog';
import { ReprintDialog } from '@/components/pos/reprint-dialog';
import { runPrintJob } from '@/lib/hardware/jobs';
import { useDeviceTerminal } from '@/lib/hardware/use-terminal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { PaymentResult, PrintJobView, Sale } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const FILTERS = [
  { key: 'all', label: 'Toutes', query: '' },
  { key: 'unpaid', label: 'Non payées', query: '&paymentStatus=UNPAID&status=OPEN' },
  { key: 'paid', label: 'Payées', query: '&paymentStatus=PAID' },
  { key: 'cancelled', label: 'Annulées', query: '&status=CANCELLED' },
] as const;

function SaleStatusBadge({ sale }: { sale: Sale }) {
  if (sale.status === 'CANCELLED') return <Badge>Annulée</Badge>;
  return sale.paymentStatus === 'PAID' ? (
    <Badge tone="forest">Payée</Badge>
  ) : (
    <Badge tone="savanna">Non payée</Badge>
  );
}

export default function VentesPage() {
  const canSell = useCan('pos.sell');
  const seesAll = useCan('sale.read_all');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const query = FILTERS.find((f) => f.key === filter)!.query;
  const sales = useApi<Sale[]>(canSell ? `/sales?limit=100${query}` : null);
  const [selected, setSelected] = useState<Sale | null>(null);

  if (!canSell) return <AccessDenied />;
  return (
    <>
      <PageHeader
        title="Historique des ventes"
        description={
          seesAll ? 'Les 100 dernières ventes de votre périmètre.' : 'Vos 100 dernières ventes.'
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filtrer les ventes">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${filter === f.key ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Card>
        {sales.state === 'loading' && <LoadingState />}
        {sales.state === 'error' && <ErrorState error={sales.error} onRetry={sales.reload} />}
        {sales.state === 'success' && sales.data.length === 0 && (
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title="Aucune vente"
            description="Les ventes enregistrées en caisse apparaîtront ici."
          />
        )}
        {sales.state === 'success' && sales.data.length > 0 && (
          <Table
            head={['N°', 'Date', 'Établissement', 'Caissier', 'Total', 'Paiement', 'Préparation']}
          >
            {sales.data.map((s) => (
              <tr
                key={s.id}
                className="cursor-pointer hover:bg-ivory/60"
                onClick={() => setSelected(s)}
              >
                <Td className="font-mono font-semibold">
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setSelected(s)}
                  >
                    {formatSaleNumber(s.number)}
                  </button>
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(s.createdAt)}</Td>
                <Td>{s.establishment.name}</Td>
                <Td>{s.cashier.name}</Td>
                <Td className="font-semibold">{formatXof(s.total)}</Td>
                <Td>
                  <SaleStatusBadge sale={s} />
                </Td>
                <Td className="text-muted">{PREPARATION_STATUS_LABELS[s.preparationStatus]}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {selected && (
        <SaleDetailDialog
          sale={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            sales.reload();
          }}
        />
      )}
    </>
  );
}

function SaleDetailDialog({
  sale,
  onClose,
  onChanged,
}: {
  sale: Sale;
  onClose: () => void;
  onChanged: () => void;
}) {
  const canCancel = useCan('sale.cancel');
  const canReprint = useCan('receipt.reprint');
  const device = useDeviceTerminal(sale.establishment.id);
  const printJobs = useApi<PrintJobView[]>(`/print-jobs?saleId=${sale.id}`);
  const [reprinting, setReprinting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<PaymentResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const payable = sale.status === 'OPEN' && sale.paymentStatus === 'UNPAID';

  async function cancel() {
    if (!window.confirm(`Annuler la vente n° ${formatSaleNumber(sale.number)} ?`)) return;
    setCancelling(true);
    setError(null);
    try {
      await api(`/sales/${sale.id}/cancel`, { method: 'POST', body: {} });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setCancelling(false);
    }
  }

  if (receipt)
    return <ReceiptDialog result={receipt} terminal={device.terminal} onClose={onChanged} />;
  if (paying)
    return <PaymentDialog sale={sale} onClose={() => setPaying(false)} onPaid={setReceipt} />;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Vente n° ${formatSaleNumber(sale.number)}`}
      description={`${sale.establishment.name} · ${formatDateTime(sale.createdAt)} · ${sale.cashier.name}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <SaleStatusBadge sale={sale} />
          <Badge>{PREPARATION_STATUS_LABELS[sale.preparationStatus]}</Badge>
        </div>
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {sale.lines.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                {l.quantity} × {l.productName}{' '}
                <span className="text-muted">
                  ({l.variantName}, {formatXof(l.unitPrice)})
                </span>
              </span>
              <span className="font-semibold">{formatXof(l.lineTotal)}</span>
            </li>
          ))}
          <li className="flex justify-between px-4 py-3 font-semibold">
            <span>Total</span>
            <span>{formatXof(sale.total)}</span>
          </li>
        </ul>
        {sale.payments.map((p) => (
          <p key={p.id} className="text-sm text-muted">
            Payé en espèces le {formatDateTime(p.createdAt)} : reçu{' '}
            {formatXof(p.amountTendered ?? p.amount)}, rendu {formatXof(p.changeGiven ?? 0)}.
          </p>
        ))}
        {sale.paymentStatus === 'PAID' && sale.status === 'OPEN' && (
          <section aria-label="Impressions" className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Impressions du ticket</h3>
              {device.terminal && device.terminal.printerConnection !== 'NONE' ? (
                printJobs.state === 'success' &&
                printJobs.data.some((j) => j.status === 'SUCCEEDED') ? (
                  canReprint && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setReprinting(true)}
                      icon={<Printer className="h-4 w-4" />}
                    >
                      Réimprimer (duplicata)
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={printing}
                    icon={<Printer className="h-4 w-4" />}
                    onClick={async () => {
                      setPrinting(true);
                      const outcome = await runPrintJob({
                        terminalId: device.terminal!.id,
                        kind: 'RECEIPT',
                        saleId: sale.id,
                      });
                      setPrintMessage(
                        outcome.status === 'SUCCEEDED'
                          ? 'Ticket imprimé.'
                          : (outcome.message ?? 'Échec de l’impression.'),
                      );
                      setPrinting(false);
                      printJobs.reload();
                    }}
                  >
                    Imprimer le ticket
                  </Button>
                )
              ) : (
                <span className="text-xs text-muted">Aucune imprimante sur ce poste.</span>
              )}
            </div>
            {printMessage && <p className="text-sm text-muted">{printMessage}</p>}
            {printJobs.state === 'success' && printJobs.data.length > 0 && (
              <ul className="space-y-1 text-xs text-muted" data-testid="print-attempts">
                {printJobs.data.map((j) => (
                  <li key={j.id}>
                    {formatDateTime(j.createdAt)} · {j.kind === 'REPRINT' ? 'Duplicata' : 'Ticket'}{' '}
                    · {j.terminalName} ·{' '}
                    {j.status === 'SUCCEEDED'
                      ? 'imprimé'
                      : j.status === 'FAILED'
                        ? `échec (${j.errorCode})`
                        : 'en attente'}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {reprinting && device.terminal && (
          <ReprintDialog
            saleId={sale.id}
            terminal={device.terminal}
            onClose={() => {
              setReprinting(false);
              printJobs.reload();
            }}
          />
        )}
        <ApiErrorAlert error={error} />
        {payable && (
          <div className="flex flex-wrap justify-end gap-2">
            {canCancel && (
              <Button
                variant="secondary"
                onClick={cancel}
                loading={cancelling}
                icon={<Ban className="h-4 w-4" />}
              >
                Annuler la vente
              </Button>
            )}
            <Button onClick={() => setPaying(true)}>Encaisser</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
