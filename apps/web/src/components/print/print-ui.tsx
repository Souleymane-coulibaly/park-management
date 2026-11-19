'use client';

import {
  PRINT_ITEM_STATUS_LABELS,
  PRINT_ORDER_STATUS_LABELS,
  PRINT_PAYMENT_STATUS_LABELS,
  type PrintItemStatus,
  type PrintOrderStatus,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import type { CardSides } from './print-types';

const ORDER_TONES: Record<PrintOrderStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  SUBMITTED: 'savanna',
  ACCEPTED: 'savanna',
  IN_PRODUCTION: 'savanna',
  READY: 'forest',
  DELIVERED: 'forest',
  CANCELLED: 'neutral',
  REJECTED: 'terracotta',
};

export function OrderStatusBadge({ status }: { status: PrintOrderStatus }) {
  return <Badge tone={ORDER_TONES[status]}>{PRINT_ORDER_STATUS_LABELS[status]}</Badge>;
}

export function ItemStatusBadge({ status }: { status: PrintItemStatus }) {
  const tone = status === 'PRINTED' ? 'forest' : status === 'REJECTED' ? 'terracotta' : 'neutral';
  return <Badge tone={tone}>{PRINT_ITEM_STATUS_LABELS[status]}</Badge>;
}

export function PaymentBadge({ status }: { status: 'UNPAID' | 'PAID' }) {
  return (
    <Badge tone={status === 'PAID' ? 'forest' : 'savanna'}>
      {PRINT_PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CardStatusBadge({ status }: { status: 'ACTIVE' | 'REVOKED' }) {
  return (
    <Badge tone={status === 'ACTIVE' ? 'forest' : 'terracotta'}>
      {status === 'ACTIVE' ? 'Active' : 'Révoquée'}
    </Badge>
  );
}

/** Montant en francs CFA : prix unitaire × quantité = total. */
export function OrderAmount({
  unitPrice,
  quantity,
  totalAmount,
}: {
  unitPrice: number;
  quantity: number;
  totalAmount: number;
}) {
  return (
    <span className="tabular-nums" data-testid="print-order-amount">
      {formatXof(unitPrice)} × {quantity} = <strong>{formatXof(totalAmount)}</strong>
    </span>
  );
}

export const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

export const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/**
 * Aperçu recto verso. Le SVG produit par le moteur est affiché comme IMAGE (jamais inséré dans la page) :
 * aucun script, aucun lien ne peut s'y exécuter.
 */
export function CardPreview({ sides, compact = false }: { sides: CardSides; compact?: boolean }) {
  const src = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div
      className={`grid gap-4 ${compact ? 'sm:grid-cols-2' : 'md:grid-cols-2'}`}
      data-testid="print-card-preview"
    >
      {(['front', 'back'] as const).map((side) => (
        <figure key={side} className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src(sides[side])}
            alt={side === 'front' ? 'Recto de la carte' : 'Verso de la carte'}
            className="h-auto w-full max-w-full rounded-xl border border-line bg-white shadow-sm"
          />
          <figcaption className="mt-1 text-center text-xs text-muted">
            {side === 'front' ? 'Recto' : 'Verso'}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Événements d'une commande, en langage clair. */
export const ORDER_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Commande envoyée',
  ACCEPTED: 'Acceptée par l’atelier',
  IN_PRODUCTION: 'Mise en production',
  READY: 'Cartes prêtes',
  DELIVERED: 'Livrée',
  CANCELLED: 'Annulée',
  REJECTED: 'Refusée',
  ITEM_REJECTED: 'Carte refusée par l’atelier',
  ITEM_CANCELLED_CARD_REVOKED: 'Carte retirée (révoquée)',
  PAYMENT_RECORDED: 'Règlement en espèces enregistré',
  PAYMENT_CANCELLED: 'Règlement annulé',
  FILES_PURGED: 'Fichiers de production purgés (90 jours)',
};
