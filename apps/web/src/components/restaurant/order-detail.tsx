'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { PREPARATION_STATUS_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { type HardwareOutcome, runPrintJob } from '@/lib/hardware/jobs';
import type { OrderDetail, PosTerminal } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ChannelLabel, PaymentBadge, PreparationBadge, locationOf } from './order-badges';

const EVENT_LABELS: Record<string, string> = {
  created: 'Commande enregistrée',
  updated: 'Commande modifiée',
  sent_to_kitchen: 'Envoyée en cuisine',
  preparation_started: 'Préparation commencée',
  ready: 'Prête',
  served: 'Servie',
  paid: 'Encaissée',
  cancelled: 'Annulée',
  qr_accepted: 'Demande QR validée',
};

/** Détail d'une commande : lignes, statuts et historique complet ; réimpression du ticket cuisine. */
export function OrderDetailDialog({
  orderId,
  establishmentId,
  onClose,
}: {
  orderId: string;
  establishmentId: string;
  onClose: () => void;
}) {
  const order = useApi<OrderDetail>(`/orders/${orderId}`);
  const [print, setPrint] = useState<HardwareOutcome | null>(null);
  const [printing, setPrinting] = useState(false);

  async function reprintKitchen() {
    setPrinting(true);
    const terminals = await api<PosTerminal[]>(
      `/pos-terminals?establishmentId=${establishmentId}`,
    ).catch(() => [] as PosTerminal[]);
    const printer = terminals.find(
      (t) => t.kitchenPrinter && t.isActive && t.printerConnection !== 'NONE',
    );
    setPrint(
      printer
        ? await runPrintJob({ terminalId: printer.id, kind: 'KITCHEN', saleId: orderId })
        : { status: 'FAILED', message: 'Aucune imprimante cuisine n’est configurée.' },
    );
    setPrinting(false);
  }

  const title =
    order.state === 'success' ? `Commande n° ${formatSaleNumber(order.data.number)}` : 'Commande';
  return (
    <Dialog open onClose={onClose} title={title}>
      {order.state === 'loading' && <LoadingState />}
      {order.state === 'error' && <ErrorState error={order.error} onRetry={order.reload} />}
      {order.state === 'success' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ChannelLabel channel={order.data.channel} />
            {locationOf(order.data) && <span>· {locationOf(order.data)}</span>}
            <PaymentBadge status={order.data.paymentStatus} />
            <PreparationBadge status={order.data.preparationStatus} />
          </div>
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {order.data.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {l.quantity} × {l.productName} ({l.variantName})
                  {l.notes && <span className="block text-terracotta-dark">» {l.notes}</span>}
                </span>
                <span className="font-semibold">{formatXof(l.lineTotal)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-2 font-bold">
              <span>Total</span>
              <span>{formatXof(order.data.total)}</span>
            </li>
          </ul>
          {order.data.notes && <Alert tone="info">Instructions : {order.data.notes}</Alert>}
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Historique
            </h3>
            <ol className="space-y-1.5 text-sm" data-testid="order-history">
              {order.data.events.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {EVENT_LABELS[e.type] ?? e.type}
                    {e.toStatus && e.type !== 'created' && (
                      <span className="text-muted"> → {PREPARATION_STATUS_LABELS[e.toStatus]}</span>
                    )}
                    {e.actorName && <span className="text-muted"> · {e.actorName}</span>}
                  </span>
                  <span className="text-muted">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </section>
          {order.data.preparationStatus !== 'NOT_SENT' && order.data.status === 'OPEN' && (
            <div className="space-y-2">
              <Button
                variant="secondary"
                className="w-full"
                icon={<Printer className="h-4 w-4" />}
                loading={printing}
                onClick={reprintKitchen}
              >
                Réimprimer le ticket cuisine
              </Button>
              {print && (
                <Alert tone={print.status === 'SUCCEEDED' ? 'success' : 'error'}>
                  {print.status === 'SUCCEEDED'
                    ? 'Ticket cuisine imprimé.'
                    : `Ticket non imprimé : ${print.message ?? 'erreur'}. La commande n’est pas modifiée.`}
                </Alert>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
