import type { PrintCardKind, PrintItemStatus, PrintLayout, PrintOrderStatus } from '@ocall/shared';

/**
 * Ocall Print — vues renvoyées par l'API (moteur commun, accès autonome, Ocall School, atelier). Les
 * composants de ce dossier sont COMMUNS à toutes les applications : seule l'adresse de l'API change.
 */

export interface PrintTemplateView {
  id: string;
  name: string;
  kind: PrintCardKind;
  scopeId: string | null;
  currentVersion: number;
  layout: PrintLayout;
  hasLogo: boolean;
  archivedAt: string | null;
  updatedAt: string;
}

export interface PrintCardView {
  id: string;
  cardNumber: string;
  status: 'ACTIVE' | 'REVOKED';
  holderKind: PrintCardKind;
  holderId: string;
  sourceApp: string;
  scopeId: string | null;
  validUntil: string | null;
  replacesCardId: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  print: {
    orderId: string;
    orderNumber: string;
    orderStatus: PrintOrderStatus;
    itemStatus: PrintItemStatus;
    rejectReason: string | null;
  } | null;
}

export interface PrintOrderSummaryView {
  id: string;
  number: string;
  sourceApp: string;
  scopeId: string | null;
  kind: PrintCardKind;
  status: PrintOrderStatus;
  unitPrice: number;
  currency: string;
  quantity: number;
  totalAmount: number;
  paymentStatus: 'UNPAID' | 'PAID';
  paidAmount: number | null;
  paidAt: string | null;
  submittedAt: string;
  updatedAt: string;
  filesPurged: boolean;
  /** Atelier seulement. */
  organizationName?: string;
  contactName?: string;
  contactPhone?: string;
}

export interface PrintOrderDetailView extends PrintOrderSummaryView {
  templateName: string;
  templateVersion: number;
  delivery: { address: string; contactName: string; contactPhone: string; note: string | null };
  acceptedAt: string | null;
  productionAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  rejectedAt: string | null;
  closedReason: string | null;
  paymentReference: string | null;
  items: {
    id: string;
    cardId: string;
    cardNumber: string;
    holderKind: PrintCardKind;
    holderLabel: string | null;
    status: PrintItemStatus;
    rejectReason: string | null;
  }[];
  events: {
    type: string;
    actorKind: string;
    createdAt: string;
    details: Record<string, unknown>;
  }[];
}

export interface PrintSettingsView {
  enabled?: boolean;
  unitPrice: number;
  currency: string;
  retentionDays: number;
  payment: 'CASH_ON_DELIVERY';
}

export interface CardSides {
  front: string;
  back: string;
}
