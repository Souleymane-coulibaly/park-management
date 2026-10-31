import type { BusinessType } from './business';

/**
 * Ocall Suite — plateforme centrale (Sprint 11A) : rôles internes, permissions, produits SaaS,
 * facturation manuelle. Règles partagées par l'API (contrôle) et l'administration (affichage).
 *
 * Règle métier : les abonnements sont payés directement à Ocall, hors plateforme. Le Super Admin
 * vérifie, enregistre, valide, puis active ou renouvelle. Aucun prestataire de paiement, aucun
 * encaissement ni renouvellement automatique.
 */

// ─── Rôles internes Ocall ───

export const PLATFORM_ROLES = [
  'PLATFORM_OWNER',
  'PLATFORM_ADMIN',
  'BILLING_MANAGER',
  'SUPPORT_AGENT',
  'READ_ONLY_AUDITOR',
] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];
/** Valeur stockée : les rôles ci-dessus, ou SUPER_ADMIN (historique, équivalent au propriétaire). */
export type StoredPlatformRole = PlatformRoleName | 'SUPER_ADMIN';

export const PLATFORM_ROLE_LABELS: Record<PlatformRoleName, string> = {
  PLATFORM_OWNER: 'Propriétaire de la plateforme',
  PLATFORM_ADMIN: 'Administrateur délégué',
  BILLING_MANAGER: 'Gestion des abonnements et paiements',
  SUPPORT_AGENT: 'Assistance',
  READ_ONLY_AUDITOR: 'Consultation et audit',
};

/** Le rôle historique SUPER_ADMIN est traité comme le propriétaire de la plateforme. */
export function effectivePlatformRole(
  role: StoredPlatformRole | null | undefined,
): PlatformRoleName | null {
  if (!role) return null;
  return role === 'SUPER_ADMIN' ? 'PLATFORM_OWNER' : role;
}

export const PlatformPermission = {
  DASHBOARD: 'platform.dashboard',
  ORGS_READ: 'platform.orgs.read',
  ORGS_MANAGE: 'platform.orgs.manage',
  PRODUCTS_MANAGE: 'platform.products.manage',
  PLANS_MANAGE: 'platform.plans.manage',
  SUBSCRIPTIONS_MANAGE: 'platform.subscriptions.manage',
  BILLING_READ: 'platform.billing.read',
  BILLING_MANAGE: 'platform.billing.manage',
  BILLING_VALIDATE: 'platform.billing.validate',
  DOMAINS_MANAGE: 'platform.domains.manage',
  USERS_MANAGE: 'platform.users.manage',
  AUDIT_READ: 'platform.audit.read',
  /** Sprint 11B : quotas IA et stockage, support, paramètres. */
  QUOTAS_MANAGE: 'platform.quotas.manage',
  SUPPORT_MANAGE: 'platform.support.manage',
  SETTINGS_READ: 'platform.settings.read',
  /** Sprint 12A : déclaration d'espèces, approbation des activations, demandes de démonstration. */
  CASH_DECLARE: 'platform.billing.cash.declare',
  ACTIVATIONS_APPROVE: 'platform.activations.approve',
  DEMO_REQUESTS_MANAGE: 'platform.demo.manage',
  /** Sprint 12B : partenaires commerciaux, commissions, versements. */
  PARTNERS_MANAGE: 'platform.partners.manage',
  COMMISSIONS_VALIDATE: 'platform.commissions.validate',
  PAYOUTS_MANAGE: 'platform.payouts.manage',
} as const;
export type PlatformPermission = (typeof PlatformPermission)[keyof typeof PlatformPermission];
export const PLATFORM_PERMISSIONS: readonly PlatformPermission[] =
  Object.values(PlatformPermission);

const PP = PlatformPermission;

/** Matrice unique, appliquée par l'API. La gestion des comptes internes est réservée au propriétaire. */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRoleName, readonly PlatformPermission[]> = {
  PLATFORM_OWNER: PLATFORM_PERMISSIONS,
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS.filter((p) => p !== PP.USERS_MANAGE),
  BILLING_MANAGER: [
    PP.DASHBOARD,
    PP.ORGS_READ,
    PP.SUBSCRIPTIONS_MANAGE,
    PP.BILLING_READ,
    PP.BILLING_MANAGE,
    PP.BILLING_VALIDATE,
    PP.CASH_DECLARE,
    PP.ACTIVATIONS_APPROVE,
    PP.DEMO_REQUESTS_MANAGE,
    PP.COMMISSIONS_VALIDATE,
    PP.PAYOUTS_MANAGE,
  ],
  SUPPORT_AGENT: [
    PP.DASHBOARD,
    PP.ORGS_READ,
    PP.DOMAINS_MANAGE,
    PP.SUPPORT_MANAGE,
    PP.DEMO_REQUESTS_MANAGE,
  ],
  READ_ONLY_AUDITOR: [PP.DASHBOARD, PP.ORGS_READ, PP.BILLING_READ, PP.AUDIT_READ, PP.SETTINGS_READ],
};

export function hasPlatformPermission(
  role: StoredPlatformRole | null | undefined,
  permission: PlatformPermission,
): boolean {
  const r = effectivePlatformRole(role);
  return !!r && PLATFORM_ROLE_PERMISSIONS[r].includes(permission);
}

export function platformPermissionsOf(
  role: StoredPlatformRole | null | undefined,
): PlatformPermission[] {
  const r = effectivePlatformRole(role);
  return r ? [...PLATFORM_ROLE_PERMISSIONS[r]] : [];
}

/** Rôles soumis à l'authentification à deux facteurs obligatoire. */
export function platformRoleRequiresMfa(role: StoredPlatformRole | null | undefined): boolean {
  const r = effectivePlatformRole(role);
  return r === 'PLATFORM_OWNER' || r === 'PLATFORM_ADMIN' || r === 'BILLING_MANAGER';
}

/**
 * Rôles qu'un compte peut attribuer : seul le propriétaire gère les comptes internes, et le rôle
 * propriétaire n'est jamais attribuable par l'application (procédure serveur uniquement).
 */
export function assignablePlatformRoles(
  actor: StoredPlatformRole | null | undefined,
): PlatformRoleName[] {
  return hasPlatformPermission(actor, PP.USERS_MANAGE)
    ? ['PLATFORM_ADMIN', 'BILLING_MANAGER', 'SUPPORT_AGENT', 'READ_ONLY_AUDITOR']
    : [];
}

// ─── Produits SaaS ───

export const SAAS_PRODUCT_STATUSES = [
  'PLANNED',
  'COMING_SOON',
  'PILOT',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
] as const;
export type SaasProductStatus = (typeof SAAS_PRODUCT_STATUSES)[number];

/** Libellés de l'administration. */
export const SAAS_PRODUCT_STATUS_LABELS: Record<SaasProductStatus, string> = {
  PLANNED: 'Planifié (non public)',
  COMING_SOON: 'Bientôt disponible',
  PILOT: 'Pilote (souscription par Ocall)',
  ACTIVE: 'Commercialisé',
  SUSPENDED: 'Suspendu',
  RETIRED: 'Retiré',
};

/** Statuts présentés sur le site public, avec leur libellé commercial. */
export const PUBLIC_PRODUCT_STATUS_LABELS: Partial<Record<SaasProductStatus, string>> = {
  ACTIVE: 'Disponible',
  PILOT: 'En pilote',
  COMING_SOON: 'Bientôt disponible',
};
export const isPublicProductStatus = (status: SaasProductStatus) =>
  status in PUBLIC_PRODUCT_STATUS_LABELS;

/**
 * Règle unique de commercialisation, appliquée par le serveur (souscription, facturation,
 * activation, tarifs publics). Seul ACTIVE est ouvert à tous ; PILOT seulement par Ocall ;
 * PLANNED, COMING_SOON, SUSPENDED et RETIRED ne sont jamais souscriptibles ni facturables.
 */
export function canSubscribeToProduct(
  status: SaasProductStatus,
  by: 'customer' | 'ocall',
): boolean {
  return status === 'ACTIVE' || (status === 'PILOT' && by === 'ocall');
}
/** Facturation et activation d'un abonnement : produit commercialisé ou en pilote. */
export const isProductBillable = (status: SaasProductStatus) =>
  status === 'ACTIVE' || status === 'PILOT';

/** Identifiant public d'une page produit : minuscules, chiffres et tirets. */
export const isProductSlug = (slug: string) =>
  /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 60;

/** Produits de l'application Ocall Park actuelle, liés au métier de l'organisation. */
export const PARK_APP_PRODUCTS: Record<BusinessType, string> = {
  PARK: 'OCALL_PARK',
  RESTAURANT: 'OCALL_RESTAURANT',
  PARK_RESTAURANT: 'OCALL_PARK_RESTAURANT',
};
export const PARK_APP_PRODUCT_CODES = Object.values(PARK_APP_PRODUCTS);

/** Code produit : majuscules, chiffres et soulignés (ex. OCALL_SCHOOL). */
export const isProductCode = (code: string) => /^[A-Z][A-Z0-9_]{2,39}$/.test(code);

// ─── Facturation manuelle ───

export const INVOICE_STATUSES = ['ISSUED', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  ISSUED: 'Émise',
  PAID: 'Payée',
  CANCELLED: 'Annulée',
};

export const INVOICE_LINE_KINDS = ['SETUP', 'MONTHLY', 'ADJUSTMENT'] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];
export const INVOICE_LINE_KIND_LABELS: Record<InvoiceLineKind, string> = {
  SETUP: 'Frais de mise en service',
  MONTHLY: 'Abonnement mensuel',
  ADJUSTMENT: 'Ajustement',
};

export const INVOICE_MAX_MONTHS = 24;
export const INVOICE_MAX_ADJUSTMENT = 10_000_000;

/** Numéro de facture lisible : OCP-2026-00042. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `OCP-${year}-${String(sequence).padStart(5, '0')}`;
}

export interface InvoiceLineInput {
  kind: InvoiceLineKind;
  /** Mensualités facturées (MONTHLY). */
  months?: number;
  /** Montant d'un ajustement (positif ou négatif, ADJUSTMENT uniquement). */
  amount?: number;
  reason?: string;
}

export interface ComputedInvoiceLine {
  kind: InvoiceLineKind;
  label: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  reason: string | null;
}

/**
 * Lignes d'une facture calculées par le SERVEUR à partir du tarif accepté par le client (jamais
 * d'un montant fourni par le navigateur, sauf l'ajustement motivé). Total jamais négatif.
 */
export function computeInvoiceLines(
  lines: InvoiceLineInput[],
  agreed: { setupFee: number; monthlyPrice: number },
): { lines: ComputedInvoiceLine[]; total: number } | { error: string } {
  if (lines.length === 0 || lines.length > 10) return { error: 'Entre 1 et 10 lignes.' };
  const out: ComputedInvoiceLine[] = [];
  for (const l of lines) {
    if (l.kind === 'SETUP') {
      if (out.some((x) => x.kind === 'SETUP'))
        return { error: 'Une seule ligne de mise en service.' };
      out.push({
        kind: 'SETUP',
        label: INVOICE_LINE_KIND_LABELS.SETUP,
        quantity: 1,
        unitAmount: agreed.setupFee,
        amount: agreed.setupFee,
        reason: null,
      });
    } else if (l.kind === 'MONTHLY') {
      const months = l.months ?? 1;
      if (!Number.isInteger(months) || months < 1 || months > INVOICE_MAX_MONTHS) {
        return { error: `Entre 1 et ${INVOICE_MAX_MONTHS} mensualités.` };
      }
      out.push({
        kind: 'MONTHLY',
        label: `${INVOICE_LINE_KIND_LABELS.MONTHLY} × ${months}`,
        quantity: months,
        unitAmount: agreed.monthlyPrice,
        amount: agreed.monthlyPrice * months,
        reason: null,
      });
    } else {
      const amount = l.amount ?? 0;
      const reason = (l.reason ?? '').trim();
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > INVOICE_MAX_ADJUSTMENT) {
        return { error: 'Ajustement : montant entier non nul.' };
      }
      if (reason.length < 3 || reason.length > 200)
        return { error: 'Ajustement : motif obligatoire (3 à 200 caractères).' };
      out.push({
        kind: 'ADJUSTMENT',
        label: INVOICE_LINE_KIND_LABELS.ADJUSTMENT,
        quantity: 1,
        unitAmount: amount,
        amount,
        reason,
      });
    }
  }
  const total = out.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) return { error: 'Le total de la facture doit être positif.' };
  return { lines: out, total };
}

// ─── Tableau de bord commercial ───

export interface CommercialDashboard {
  generatedAt: string;
  filters: { product: string | null; from: string; to: string };
  organizations: { total: number; active: number; suspended: number };
  establishments: number;
  byProduct: {
    code: string;
    name: string;
    status: SaasProductStatus;
    subscriptions: number;
    active: number;
  }[];
  subscriptions: {
    active: number;
    expired: number;
    pastDue: number;
    notActivated: number;
    canceled: number;
    suspendedOrganizations: number;
    /** Sprint 12A. */
    suspended: number;
    pendingActivation: number;
  };
  /** Encaissé = règlements CONFIRMÉS sur la période (date de règlement). */
  collected: {
    setup: number;
    monthly: number;
    adjustments: number;
    unallocated: number;
    total: number;
    /** Répartition par canal (Sprint 12A). */
    online: number;
    cash: number;
    transfer: number;
  };
  /** Remboursés sur la période (date de remboursement), jamais déduits de l'encaissé historique. */
  refunded: number;
  /** Activations à approuver (notification interne). */
  pendingActivations: number;
  /** Demandes de démonstration : nouvelles (à traiter) et reçues sur la période. */
  demoRequests: { new: number; received: number };
  /** Facturé = factures émises (non annulées) sur la période. */
  invoiced: number;
  /** MRR contractuel THÉORIQUE : tarifs acceptés des abonnements actifs — pas un encaissement. */
  theoreticalMrr: number;
  /** Factures émises non payées : total, et part échue. */
  unpaid: { amount: number; overdueAmount: number; invoices: number };
  renewalsNext30Days: number;
}

// ─── Authentification à deux facteurs ───

export const MFA_RECOVERY_CODES = 10;
