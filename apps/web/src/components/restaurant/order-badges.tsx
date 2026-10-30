'use client';

import { useEffect, useState } from 'react';
import { Radio, WifiOff } from 'lucide-react';
import { ORDER_CHANNEL_LABELS, PREPARATION_STATUS_LABELS } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import type { OrderChannel, PreparationStatus } from '@/lib/types';
import type { LiveStatus } from '@/lib/use-live-stream';

const PREPARATION_TONE: Record<PreparationStatus, 'neutral' | 'savanna' | 'forest' | 'terracotta'> =
  {
    NOT_SENT: 'neutral',
    SENT: 'savanna',
    IN_PREPARATION: 'savanna',
    READY: 'forest',
    SERVED: 'neutral',
  };

/** Statut de préparation (indépendant du paiement). */
export function PreparationBadge({ status }: { status: PreparationStatus }) {
  return <Badge tone={PREPARATION_TONE[status]}>{PREPARATION_STATUS_LABELS[status]}</Badge>;
}

/** Statut de paiement (indépendant de la préparation). */
export function PaymentBadge({ status }: { status: 'UNPAID' | 'PAID' }) {
  return status === 'PAID' ? (
    <Badge tone="forest">Payée</Badge>
  ) : (
    <Badge tone="terracotta">Non payée</Badge>
  );
}

export function ChannelLabel({ channel }: { channel: OrderChannel | null }) {
  return <span>{ORDER_CHANNEL_LABELS[channel ?? 'COUNTER']}</span>;
}

/** « Terrasse · Table 4 », ou rien. */
export function locationOf(order: {
  zone: { name: string } | null;
  table: { name: string } | null;
}): string | null {
  return [order.zone?.name, order.table?.name].filter(Boolean).join(' · ') || null;
}

/** Heure courante rafraîchie périodiquement (durées d'attente). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Durée écoulée lisible : « 4 min », « 1 h 05 ». */
export function formatElapsed(fromIso: string | null, now: number): string {
  if (!fromIso) return '—';
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const LIVE_LABELS: Record<LiveStatus, string> = {
  connecting: 'Connexion…',
  live: 'En direct',
  reconnecting: 'Reconnexion…',
  unavailable: 'Hors ligne',
};

/** Indicateur de connexion temps réel. */
export function LiveIndicator({ status }: { status: LiveStatus }) {
  const live = status === 'live';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${live ? 'bg-forest-light text-forest-dark' : 'bg-terracotta-light text-terracotta-dark'}`}
      role="status"
      data-live={status}
    >
      {live ? (
        <Radio className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <WifiOff className="h-3.5 w-3.5" aria-hidden />
      )}
      {LIVE_LABELS[status]}
    </span>
  );
}
