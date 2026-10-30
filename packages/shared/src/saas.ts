import type { BusinessType } from './business';
import type { SubscriptionStatus } from './subscription';

/**
 * Statistiques SaaS du Super Admin et registre des règlements d'abonnement (Sprint 9B).
 *
 * Règle métier : les abonnements sont payés directement à Ocall, HORS plateforme ; le Super Admin
 * saisit le règlement, le vérifie et le valide MANUELLEMENT. Aucun paiement en ligne, aucun
 * renouvellement automatique. Ces encaissements ne sont jamais mélangés aux recettes des
 * établissements clients.
 */

export const SUBSCRIPTION_PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'MOBILE_MONEY',
  'CHECK',
  'OTHER',
] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS: Record<SubscriptionPaymentMethod, string> = {
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement bancaire',
  MOBILE_MONEY: 'Mobile money (hors plateforme)',
  CHECK: 'Chèque',
  OTHER: 'Autre',
};

export const SUBSCRIPTION_PAYMENT_STATUSES = ['PENDING', 'VALIDATED', 'REJECTED'] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<SubscriptionPaymentStatus, string> = {
  PENDING: 'À vérifier',
  VALIDATED: 'Validé',
  REJECTED: 'Rejeté',
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
    businessType: BusinessType;
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
