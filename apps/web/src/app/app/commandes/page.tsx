'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ChefHat, Plus, QrCode, Receipt } from 'lucide-react';
import { formatKioskNumber, formatSaleNumber, formatXof } from '@ocall/shared';
import { VoiceOrderButton } from '@/components/ai/voice-order-dialog';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { CashSessionGate, OfflineBanner, SessionBar } from '@/components/pos/cash-session';
import { PaymentDialog, ReceiptDialog } from '@/components/pos/payment-dialog';
import { sendToKitchen } from '@/components/restaurant/kitchen-actions';
import {
  ChannelLabel,
  LiveIndicator,
  PaymentBadge,
  PreparationBadge,
  formatElapsed,
  locationOf,
  useNow,
} from '@/components/restaurant/order-badges';
import { OrderDetailDialog } from '@/components/restaurant/order-detail';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useDeviceTerminal, useOnline } from '@/lib/hardware/use-terminal';
import type { PaymentResult, QrRequest, Sale, TransitionResult } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { useLiveStream } from '@/lib/use-live-stream';

const ORDER_EVENTS = [
  'order.created',
  'order.updated',
  'order.sent',
  'order.started',
  'order.ready',
  'order.served',
  'order.paid',
  'order.cancelled',
  'qr.requested',
  'qr.decided',
] as const;

/** Commandes du restaurant : suivi en direct, demandes QR, envoi en cuisine, service, encaissement. */
export default function CommandesPage() {
  const canSell = useCan('pos.sell');
  if (!canSell) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Commandes</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>
        {(e) => (
          <CashSessionGate establishmentId={e.id}>
            {(session, reload) => (
              <>
                <SessionBar session={session} onSessionChange={reload} />
                <OrdersBoard establishmentId={e.id} />
              </>
            )}
          </CashSessionGate>
        )}
      </RestaurantScope>
    </div>
  );
}

function OrdersBoard({ establishmentId }: { establishmentId: string }) {
  const canSend = useCan('order.send_kitchen');
  const online = useOnline();
  const now = useNow();
  const device = useDeviceTerminal(establishmentId);
  const orders = useApi<Sale[]>(`/orders?establishmentId=${establishmentId}&view=active`);
  const requests = useApi<QrRequest[]>(`/orders/qr-requests?establishmentId=${establishmentId}`);
  const reloadOrders = orders.reload;
  const reloadRequests = requests.reload;
  const reloadAll = useCallback(() => {
    reloadOrders();
    reloadRequests();
  }, [reloadOrders, reloadRequests]);
  const live = useLiveStream(
    `/orders/stream?establishmentId=${establishmentId}`,
    ORDER_EVENTS,
    reloadAll,
  );
  useEffect(() => {
    if (live === 'live') return;
    const timer = setInterval(reloadAll, 15_000);
    return () => clearInterval(timer);
  }, [live, reloadAll]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<PaymentResult | null>(null);
  const [rejecting, setRejecting] = useState<QrRequest | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<string | null>) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      reloadAll();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  const send = (order: Sale) =>
    run(order.id, async () => {
      const result = await sendToKitchen(order.id, establishmentId);
      if (!result.changed) return `Commande n° ${formatSaleNumber(order.number)} déjà en cuisine.`;
      const base = `Commande n° ${formatSaleNumber(order.number)} envoyée en cuisine.`;
      if (!result.print) return base;
      return result.print.status === 'SUCCEEDED'
        ? `${base} Ticket cuisine imprimé.`
        : `${base} Ticket cuisine non imprimé : ${result.print.message ?? 'erreur'} (la commande reste en cuisine).`;
    });

  const serve = (order: Sale) =>
    run(order.id, async () => {
      await api<TransitionResult<Sale>>(`/orders/${order.id}/serve`, { method: 'POST' });
      return `Commande n° ${formatSaleNumber(order.number)} servie.`;
    });

  const accept = (request: QrRequest) =>
    run(request.id, async () => {
      const sale = await api<Sale>(`/orders/qr-requests/${request.id}/accept`, { method: 'POST' });
      return `Demande validée : commande n° ${formatSaleNumber(sale.number)} (non payée, non envoyée en cuisine).`;
    });

  const pendingRequests = requests.state === 'success' ? requests.data : [];
  const list = orders.state === 'success' ? orders.data : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LiveIndicator status={live} />
        <div className="flex flex-wrap items-center gap-2">
          <VoiceOrderButton
            establishmentId={establishmentId}
            onCreated={(saleId) => {
              setNotice('Commande vocale enregistrée : non payée, non envoyée en cuisine.');
              reloadAll();
              setDetail(saleId);
            }}
          />
          <ButtonLink href="/app/caisse" size="sm">
            <Plus className="h-4 w-4" aria-hidden /> Nouvelle commande
          </ButtonLink>
        </div>
      </div>
      {!online && (
        <OfflineBanner>
          Hors connexion : la liste n’est plus à jour et les actions sont suspendues.
        </OfflineBanner>
      )}
      <ApiErrorAlert error={error} />
      {notice && <Alert tone="success">{notice}</Alert>}

      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader
            title={`Demandes clients à valider (${pendingRequests.length})`}
            description="QR codes des tables et bornes de commande. Elles ne sont ni payées ni envoyées en cuisine : validez, encaissez, puis envoyez en cuisine."
          />
          <ul className="divide-y divide-line/70">
            {pendingRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6"
                data-testid="qr-request"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex items-center gap-2 font-semibold">
                    <QrCode className="h-4 w-4 text-forest" aria-hidden />
                    {r.source === 'KIOSK' && r.displayNumber !== null && (
                      <span className="rounded-lg bg-forest px-2 py-0.5 text-white">
                        {formatKioskNumber(r.displayNumber)}
                      </span>
                    )}
                    {r.location || 'Sans table'}
                    <span className="text-sm font-normal text-muted">
                      · il y a {formatElapsed(r.createdAt, now)}
                      {r.customerName && ` · ${r.customerName}`}
                    </span>
                  </p>
                  <ul className="text-sm">
                    {r.lines.map((l, i) => (
                      <li key={i}>
                        {l.quantity} × {l.productName} ({l.variantName})
                        {l.notes && <span className="text-terracotta-dark"> — {l.notes}</span>}
                      </li>
                    ))}
                  </ul>
                  {r.notes && <p className="text-sm text-muted">Note : {r.notes}</p>}
                  <p className="text-sm text-muted">
                    Total indicatif : {formatXof(r.estimatedTotal)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={!online} onClick={() => setRejecting(r)}>
                    Refuser
                  </Button>
                  <Button loading={busy === r.id} disabled={!online} onClick={() => accept(r)}>
                    Valider
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {orders.state === 'loading' && <LoadingState label="Chargement des commandes…" />}
      {orders.state === 'error' && <ErrorState error={orders.error} onRetry={reloadOrders} />}
      {orders.state === 'success' && list.length === 0 && (
        <Card>
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title="Aucune commande en cours"
            description="Les commandes non servies ou non payées apparaissent ici, en direct."
          />
        </Card>
      )}
      {list.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((order) => {
            const location = locationOf(order);
            return (
              <article
                key={order.id}
                className="flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card"
                data-testid="order-card"
                data-order-number={order.number}
              >
                <header className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-xl font-bold">
                      N° {formatSaleNumber(order.number)}
                    </p>
                    <p className="text-sm text-charcoal-soft">
                      <ChannelLabel channel={order.channel} />
                      {location && ` · ${location}`} · {formatElapsed(order.createdAt, now)}
                    </p>
                  </div>
                  <p className="font-semibold">{formatXof(order.total)}</p>
                </header>
                <div className="mt-2 flex flex-wrap gap-2">
                  <PaymentBadge status={order.paymentStatus} />
                  <PreparationBadge status={order.preparationStatus} />
                </div>
                <ul className="mt-3 flex-1 text-sm">
                  {order.lines.map((l) => (
                    <li key={l.id}>
                      {l.quantity} × {l.productName}
                      <span className="text-muted"> ({l.variantName})</span>
                      {l.notes && <span className="text-terracotta-dark"> — {l.notes}</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  {canSend && order.preparationStatus === 'NOT_SENT' && (
                    <Button
                      size="sm"
                      icon={<ChefHat className="h-4 w-4" />}
                      loading={busy === order.id}
                      disabled={!online}
                      onClick={() => send(order)}
                    >
                      Envoyer en cuisine
                    </Button>
                  )}
                  {canSend && order.preparationStatus === 'READY' && (
                    <Button
                      size="sm"
                      loading={busy === order.id}
                      disabled={!online}
                      onClick={() => serve(order)}
                    >
                      Marquer servie
                    </Button>
                  )}
                  {order.paymentStatus === 'UNPAID' && (
                    <Button
                      size="sm"
                      variant="accent"
                      disabled={!online}
                      onClick={() => setPaying(order)}
                    >
                      Encaisser
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDetail(order.id)}>
                    Détails
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {paying && (
        <PaymentDialog
          sale={paying}
          onClose={() => setPaying(null)}
          onPaid={(result) => {
            setPaying(null);
            setReceipt(result);
            reloadAll();
          }}
        />
      )}
      {receipt && (
        <ReceiptDialog
          result={receipt}
          terminal={device.terminal}
          onClose={() => setReceipt(null)}
        />
      )}
      {rejecting && (
        <RejectDialog
          request={rejecting}
          onClose={() => setRejecting(null)}
          onRejected={() => {
            setRejecting(null);
            setNotice('Demande refusée. Le client voit le motif sur son téléphone.');
            reloadAll();
          }}
        />
      )}
      {detail && (
        <OrderDetailDialog
          orderId={detail}
          establishmentId={establishmentId}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function RejectDialog({
  request,
  onClose,
  onRejected,
}: {
  request: QrRequest;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/orders/qr-requests/${request.id}/reject`, { method: 'POST', body: { reason } });
      onRejected();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Refuser la demande"
      description={request.location || undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Motif (visible par le client)"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Article épuisé, cuisine fermée…"
        />
        <Button type="submit" variant="danger" className="w-full" loading={loading}>
          Refuser la demande
        </Button>
      </form>
    </Dialog>
  );
}
