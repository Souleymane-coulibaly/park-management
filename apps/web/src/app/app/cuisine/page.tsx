'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChefHat, Clock, StickyNote } from 'lucide-react';
import { formatSaleNumber } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { OfflineBanner } from '@/components/pos/cash-session';
import {
  ChannelLabel,
  LiveIndicator,
  formatElapsed,
  locationOf,
  useNow,
} from '@/components/restaurant/order-badges';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useOnline, useWakeLock } from '@/lib/hardware/use-terminal';
import type { KitchenOrder, TransitionResult } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { useLiveStream } from '@/lib/use-live-stream';

const KITCHEN_EVENTS = [
  'order.sent',
  'order.started',
  'order.ready',
  'order.served',
  'order.cancelled',
] as const;

/** Au-delà de ce délai d'attente, la carte est mise en évidence. */
const LATE_AFTER_MINUTES = 15;

/** Écran cuisine (KDS) : commandes envoyées en cuisine, en temps réel. */
export default function CuisinePage() {
  const canView = useCan('kitchen.view');
  if (!canView) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Cuisine</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <KitchenBoard establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

function KitchenBoard({ establishmentId }: { establishmentId: string }) {
  const canUpdate = useCan('kitchen.update');
  const online = useOnline();
  useWakeLock(true);
  const now = useNow(15_000);
  const queue = useApi<KitchenOrder[]>(`/kitchen/orders?establishmentId=${establishmentId}`);
  const { reload } = queue;
  // Chaque évènement (et chaque reconnexion, « ready ») recharge la file : l'API reste la référence.
  const live = useLiveStream(
    `/kitchen/stream?establishmentId=${establishmentId}`,
    KITCHEN_EVENTS,
    useCallback(() => reload(), [reload]),
  );
  // Filet de sécurité : sans flux en direct, rechargement toutes les 15 s.
  useEffect(() => {
    if (live === 'live') return;
    const timer = setInterval(reload, 15_000);
    return () => clearInterval(timer);
  }, [live, reload]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function advance(order: KitchenOrder, action: 'start' | 'ready') {
    setBusy(order.id);
    setError(null);
    try {
      await api<TransitionResult<KitchenOrder>>(`/kitchen/orders/${order.id}/${action}`, {
        method: 'POST',
      });
      reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  const orders = queue.state === 'success' ? queue.data : [];
  const columns = [
    {
      key: 'SENT',
      title: 'À préparer',
      items: orders.filter((o) => o.preparationStatus === 'SENT'),
    },
    {
      key: 'IN_PREPARATION',
      title: 'En préparation',
      items: orders.filter((o) => o.preparationStatus === 'IN_PREPARATION'),
    },
    { key: 'READY', title: 'Prêtes', items: orders.filter((o) => o.preparationStatus === 'READY') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LiveIndicator status={live} />
        <p className="text-sm text-muted">
          Seules les commandes envoyées en cuisine apparaissent ici.
        </p>
      </div>
      {!online && (
        <OfflineBanner>
          Hors connexion : l’écran n’est plus à jour. Il se resynchronise dès le retour du réseau.
        </OfflineBanner>
      )}
      <ApiErrorAlert error={error} />
      {queue.state === 'loading' && <LoadingState label="Chargement des commandes…" />}
      {queue.state === 'error' && <ErrorState error={queue.error} onRetry={reload} />}
      {queue.state === 'success' && orders.length === 0 && (
        <Card>
          <EmptyState
            icon={<ChefHat className="h-7 w-7" />}
            title="Aucune commande en cuisine"
            description="Les commandes apparaissent dès qu’un employé les envoie en cuisine."
          />
        </Card>
      )}
      {orders.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {columns.map((column) => (
            <section key={column.key} aria-label={column.title} className="min-w-0 space-y-3">
              <h2 className="flex items-center justify-between text-sm font-bold uppercase tracking-wide text-muted">
                {column.title}
                <span className="rounded-full bg-ivory-dark px-2 py-0.5 text-charcoal">
                  {column.items.length}
                </span>
              </h2>
              {column.items.map((order) => (
                <KitchenCard
                  key={order.id}
                  order={order}
                  now={now}
                  busy={busy === order.id}
                  canUpdate={canUpdate}
                  onAdvance={(action) => advance(order, action)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function KitchenCard({
  order,
  now,
  busy,
  canUpdate,
  onAdvance,
}: {
  order: KitchenOrder;
  now: number;
  busy: boolean;
  canUpdate: boolean;
  onAdvance: (action: 'start' | 'ready') => void;
}) {
  const waitedMinutes = order.sentToKitchenAt
    ? (now - new Date(order.sentToKitchenAt).getTime()) / 60_000
    : 0;
  const late = order.preparationStatus !== 'READY' && waitedMinutes >= LATE_AFTER_MINUTES;
  const location = locationOf(order);
  return (
    <article
      className={`rounded-2xl border-2 bg-surface p-4 shadow-card ${late ? 'border-terracotta' : order.preparationStatus === 'READY' ? 'border-forest' : 'border-line'}`}
      data-testid="kitchen-order"
      data-order-number={order.number}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-2xl font-bold">N° {formatSaleNumber(order.number)}</p>
          <p className="text-sm font-semibold text-charcoal-soft">
            <ChannelLabel channel={order.channel} />
            {location && ` · ${location}`}
          </p>
        </div>
        <p
          className={`inline-flex items-center gap-1 text-sm font-semibold ${late ? 'text-terracotta-dark' : 'text-muted'}`}
          title="Attente depuis l’envoi en cuisine"
        >
          <Clock className="h-4 w-4" aria-hidden />
          {formatElapsed(order.sentToKitchenAt, now)}
        </p>
      </header>
      <p className="mt-1 text-xs text-muted">
        Reçue à{' '}
        {order.sentToKitchenAt
          ? new Date(order.sentToKitchenAt).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </p>
      <ul className="mt-3 space-y-2">
        {order.lines.map((l) => (
          <li key={l.id} className="text-base">
            <span className="font-bold">{l.quantity} ×</span> {l.productName}
            {l.variantName && <span className="text-muted"> · {l.variantName}</span>}
            {l.notes && <p className="ml-6 font-semibold text-terracotta-dark">» {l.notes}</p>}
          </li>
        ))}
      </ul>
      {order.notes && (
        <p className="mt-3 flex gap-2 rounded-xl bg-savanna-light/70 px-3 py-2 text-sm font-semibold">
          <StickyNote className="h-4 w-4 shrink-0" aria-hidden /> {order.notes}
        </p>
      )}
      {canUpdate && order.preparationStatus !== 'READY' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {order.preparationStatus === 'SENT' && (
            <Button variant="secondary" size="lg" loading={busy} onClick={() => onAdvance('start')}>
              En préparation
            </Button>
          )}
          <Button
            size="lg"
            className={order.preparationStatus === 'SENT' ? '' : 'col-span-2'}
            loading={busy}
            onClick={() => onAdvance('ready')}
          >
            Prête
          </Button>
        </div>
      )}
      {order.preparationStatus === 'READY' && (
        <p className="mt-4 rounded-xl bg-forest-light px-3 py-2 text-center text-sm font-bold text-forest-dark">
          Prête — en attente de service
        </p>
      )}
    </article>
  );
}
