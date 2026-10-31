import type { BusinessType } from './business';
import type { SubscriptionStatus } from './subscription';

/**
 * Statistiques SaaS du Super Admin et registre des règlements d'abonnement (Sprint 9B).
 *
 * Règle métier : les abonnements sont payés à Ocall, soit HORS plateforme (le Super Admin saisit
 * le règlement, le vérifie et le valide manuellement), soit EN LIGNE (Sprint 12A : confirmé
 * uniquement après vérification serveur auprès du prestataire). Aucun prélèvement ni
 * renouvellement automatique. Ces encaissements ne sont jamais mélangés aux recettes des
 * établissements clients.
 */

/** Moyens saisissables à la main (Sprint 12A) ; le paiement en ligne n'est jamais saisi. */
export const SUBSCRIPTION_PAYMENT_METHODS = ['CASH', 'MANUAL_TRANSFER'] as const;
export type ManualSubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];
/** Paiement en ligne vérifié (CinetPay). */
export const ONLINE_PAYMENT_METHODS = ['CINETPAY_CARD', 'CINETPAY_MOBILE_MONEY'] as const;
/** Anciens moyens hors plateforme : affichés pour l'historique, plus saisissables. */
export const LEGACY_PAYMENT_METHODS = ['MOBILE_MONEY', 'CHECK', 'OTHER'] as const;
export type SubscriptionPaymentMethod =
  | ManualSubscriptionPaymentMethod
  | (typeof ONLINE_PAYMENT_METHODS)[number]
  | (typeof LEGACY_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS: Record<SubscriptionPaymentMethod, string> = {
  CASH: 'Espèces',
  MANUAL_TRANSFER: 'Virement',
  CINETPAY_CARD: 'Carte bancaire (CinetPay)',
  CINETPAY_MOBILE_MONEY: 'Mobile money (CinetPay)',
  MOBILE_MONEY: 'Mobile money hors plateforme (historique)',
  CHECK: 'Chèque (historique)',
  OTHER: 'Autre (historique)',
};

export const SUBSCRIPTION_PAYMENT_STATUSES = [
  'DECLARED',
  'PENDING_VERIFICATION',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<SubscriptionPaymentStatus, string> = {
  DECLARED: 'Déclaré',
  PENDING_VERIFICATION: 'À vérifier',
  CONFIRMED: 'Confirmé',
  REJECTED: 'Rejeté',
  CANCELLED: 'Annulé',
  REFUNDED: 'Remboursé',
};

/** Règlements qui réservent une part de la facture (reste dû) sans être encore encaissés. */
export const OPEN_PAYMENT_STATUSES: readonly SubscriptionPaymentStatus[] = [
  'DECLARED',
  'PENDING_VERIFICATION',
];

/**
 * Contrôle à quatre yeux (Sprint 12A) : un règlement manuel est confirmé par un utilisateur
 * distinct de celui qui l'a déclaré et de celui qui a collecté les espèces.
 */
export function canConfirmPayment(
  confirmerId: string,
  payment: { recordedById: string; collectedById: string | null },
): boolean {
  return confirmerId !== payment.recordedById && confirmerId !== payment.collectedById;
}

/** Reste dû d'une facture : total moins règlements confirmés et en cours (déclarés, à vérifier). */
export function invoiceRemaining(
  total: number,
  payments: { amount: number; status: SubscriptionPaymentStatus }[],
): number {
  const reserved = payments
    .filter((p) => p.status === 'CONFIRMED' || OPEN_PAYMENT_STATUSES.includes(p.status))
    .reduce((t, p) => t + p.amount, 0);
  return Math.max(0, total - reserved);
}

/** Numéro de reçu d'espèces : REC-2026-00042. */
export function formatReceiptNumber(year: number, sequence: number): string {
  return `REC-${year}-${String(sequence).padStart(5, '0')}`;
}
/** Numéro de remise de caisse : RCA-2026-00007. */
export function formatRemittanceNumber(year: number, sequence: number): string {
  return `RCA-${year}-${String(sequence).padStart(5, '0')}`;
}

// ─── Activation après paiement en ligne (Sprint 12A) ───

export const ACTIVATION_MODES = ['AUTO', 'ADMIN_APPROVAL'] as const;
export type ActivationMode = (typeof ACTIVATION_MODES)[number];
export const ACTIVATION_MODE_LABELS: Record<ActivationMode, string> = {
  AUTO: 'Automatique après paiement vérifié',
  ADMIN_APPROVAL: 'Approbation par Ocall après paiement vérifié',
};

export const PAYMENT_ACTIVATION_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REFUSED',
] as const;
export type PaymentActivationStatus = (typeof PAYMENT_ACTIVATION_STATUSES)[number];
export const PAYMENT_ACTIVATION_STATUS_LABELS: Record<PaymentActivationStatus, string> = {
  NOT_REQUIRED: 'Sans objet',
  PENDING: 'Activation à approuver',
  APPROVED: 'Activation approuvée',
  REFUSED: 'Activation refusée (à rembourser)',
};

/** Montant maximal d'un règlement saisi (FCFA) : garde-fou contre une faute de frappe. */
export const SUBSCRIPTION_PAYMENT_MAX_AMOUNT = 10_000_000;
/** Durée maximale d'une période couverte par un règlement. */
export const SUBSCRIPTION_PAYMENT_MAX_PERIOD_DAYS = 3 * 366;
/** Fenêtre des « renouvellements à venir ». */
export const SAAS_RENEWAL_WINDOW_DAYS = 30;

export interface SubscriptionPaymentView {
  id: string;
  organization: { id: string; name: string };
  plan: { id: string; name: string };
  amount: number;
  currency: string;
  method: SubscriptionPaymentMethod;
  reference: string | null;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  status: SubscriptionPaymentStatus;
  note: string | null;
  recordedBy: string;
  validatedBy: string | null;
  validatedAt: string | null;
  rejectionReason: string | null;
  subscriptionExtended: boolean;
  createdAt: string;
  /** Sprint 12A. */
  invoice: { id: string; number: string } | null;
  recordedById: string;
  collectedById: string | null;
  collectedBy: string | null;
  receiptNumber: string | null;
  receiptReference: string | null;
  activationStatus: PaymentActivationStatus;
  activationDecisionReason: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  remittanceNumber: string | null;
}

export interface SaasRenewal {
  subscriptionId: string;
  organization: { id: string; name: string; status: 'ACTIVE' | 'SUSPENDED' };
  plan: string;
  monthlyPrice: number;
  expiresAt: string;
  /** Jours restants (négatif : échéance dépassée). */
  daysLeft: number;
  lastValidatedPayment: { paidAt: string; periodEnd: string; amount: number } | null;
}

export interface SaasHistoryEntry {
  id: string;
  createdAt: string;
  organization: string;
  type: 'CREATED' | 'PLAN_CHANGED' | 'STATUS_CHANGED';
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  fromPlan: string | null;
  toPlan: string | null;
  reason: string | null;
}

export interface SaasStats {
  generatedAt: string;
  organizations: { total: number; active: number; suspended: number };
  subscriptions: {
    byStatus: Partial<Record<SubscriptionStatus, number>>;
    /** Actifs dont l'échéance est dépassée : à vérifier (aucune bascule automatique). */
    activeButOverdue: number;
  };
  plans: {
    planId: string;
    name: string;
    /** Métier Ocall Park couvert ; null pour un autre produit. */
    businessType: BusinessType | null;
    monthlyPrice: number;
    subscriptions: number;
    active: number;
  }[];
  /** Encaissements SaaS VALIDÉS uniquement (règlements hors plateforme vérifiés). */
  payments: {
    validatedTotal: number;
    validatedThisMonth: number;
    validatedCount: number;
    pending: { count: number; amount: number };
    rejectedCount: number;
    byMonth: { month: string; amount: number; count: number }[];
  };
  /** Revenu mensuel THÉORIQUE des abonnements actifs (prix des offres) — pas un encaissement. */
  theoreticalMonthlyRevenue: number;
  renewals: SaasRenewal[];
  history: SaasHistoryEntry[];
}
