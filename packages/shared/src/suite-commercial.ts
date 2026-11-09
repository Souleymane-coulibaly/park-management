/**
 * Socle commercial Ocall Suite (Sprint S1) : grille tarifaire unifiée, essai gratuit, frais de mise en
 * service uniques et droits d'accès par application. Règles pures, partagées par l'API (contrôle) et
 * l'interface (affichage). Les montants réellement appliqués viennent toujours des offres en base,
 * configurables par le Super Admin, puis figés sur l'abonnement : ces valeurs ne sont que la grille
 * officielle de référence (amorçage, documentation, tests).
 *
 * Règle absolue : une expiration, une suspension ou une résiliation ne supprime jamais de données.
 */
import type { ProductAccess } from './suite-contracts';
import type { SubscriptionStatus } from './subscription';
import type { SaasProductStatus } from './platform';

/** Grille officielle (XOF) : par application et par organisation. */
export const SUITE_PRICING = {
  monthlyWithoutShowcase: 50_000,
  monthlyWithShowcase: 65_000,
  setupFee: 200_000,
  currency: 'XOF',
} as const;

/** Application Ocall Park commercialisée (D2 : parc, restaurant ou les deux) ; autres codes Park historiques. */
export const PARK_PRODUCT_CODE = 'OCALL_PARK';

/** Durée de l'essai gratuit, par organisation et par application, une seule fois. */
export const TRIAL_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Fin d'un essai : début + durée, calculée en UTC par le serveur (jamais fournie par le client).
 * Un essai de 14 jours commencé le 1er à 10:00 UTC prend fin le 15 à 10:00 UTC.
 */
export function trialEndsAt(startedAt: Date, days: number = TRIAL_DAYS): Date {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Durée d’essai invalide.');
  return new Date(startedAt.getTime() + days * DAY_MS);
}

/** Essai en cours : commencé et non échu. */
export function isTrialActive(endsAt: Date | string, now: Date = new Date()): boolean {
  return now.getTime() < new Date(endsAt).getTime();
}

/** Jours restants affichés (arrondi supérieur) ; 0 dès l'échéance. */
export function trialDaysRemaining(endsAt: Date | string, now: Date = new Date()): number {
  const left = new Date(endsAt).getTime() - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

/**
 * Qui peut démarrer un essai : le client lui-même seulement pour une application commercialisée
 * (« Disponible ») ; Ocall (Super Admin) aussi pour un pilote ou une application en préproduction
 * (Ocall School, décision D1). Jamais pour une application à venir, suspendue ou retirée.
 */
export function canStartTrial(status: SaasProductStatus, by: 'customer' | 'ocall'): boolean {
  if (status === 'ACTIVE') return true;
  return by === 'ocall' && (status === 'PILOT' || status === 'PREPRODUCTION');
}

/** Frais de mise en service d'un couple organisation/application. */
export const SETUP_FEE_STATUSES = ['DUE', 'INVOICED', 'PAID', 'WAIVED'] as const;
export type SetupFeeStatus = (typeof SETUP_FEE_STATUSES)[number];
export const SETUP_FEE_STATUS_LABELS: Record<SetupFeeStatus, string> = {
  DUE: 'À facturer',
  INVOICED: 'Facturés',
  PAID: 'Réglés',
  WAIVED: 'Non dus',
};

/**
 * Le setup n'est facturable qu'une seule fois par organisation et application : jamais au
 * renouvellement, jamais au passage à l'offre avec vitrine. Sans trace, il est dû.
 */
export function isSetupFeeDue(status: SetupFeeStatus | null | undefined): boolean {
  return status === undefined || status === null || status === 'DUE';
}

export interface SubscriptionQuote {
  setupFee: number;
  monthlyPrice: number;
  /** Montant de la première échéance payante : setup éventuel + première mensualité. */
  firstPayment: number;
  /** Mensualités suivantes (sans setup). */
  recurring: number;
}

/** Montant de souscription d'une application, à partir de son offre (prix figés ou en vigueur). */
export function quoteSubscription(
  plan: { monthlyPrice: number; setupFee: number },
  setupStatus: SetupFeeStatus | null | undefined,
): SubscriptionQuote {
  if (plan.monthlyPrice < 0 || plan.setupFee < 0) throw new Error('Tarif invalide.');
  const setupFee = isSetupFeeDue(setupStatus) ? plan.setupFee : 0;
  return {
    setupFee,
    monthlyPrice: plan.monthlyPrice,
    firstPayment: setupFee + plan.monthlyPrice,
    recurring: plan.monthlyPrice,
  };
}

/** Total de plusieurs applications (ex. Park + School sans vitrine : 500 000 puis 100 000). */
export function quoteTotal(quotes: readonly SubscriptionQuote[]): SubscriptionQuote {
  return quotes.reduce(
    (t, q) => ({
      setupFee: t.setupFee + q.setupFee,
      monthlyPrice: t.monthlyPrice + q.monthlyPrice,
      firstPayment: t.firstPayment + q.firstPayment,
      recurring: t.recurring + q.recurring,
    }),
    { setupFee: 0, monthlyPrice: 0, firstPayment: 0, recurring: 0 },
  );
}

/** État fonctionnel d'un abonnement, tel que présenté au client et au Super Admin. */
export type CommercialState =
  | 'TRIAL_ACTIVE'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE'
  | 'RENEWAL_PENDING'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'NOT_ACTIVATED';

export const COMMERCIAL_STATE_LABELS: Record<CommercialState, string> = {
  TRIAL_ACTIVE: 'Essai en cours',
  TRIAL_EXPIRED: 'Essai expiré',
  ACTIVE: 'Abonnement actif',
  RENEWAL_PENDING: 'Renouvellement en attente',
  SUSPENDED: 'Suspendu',
  CANCELED: 'Résilié',
  EXPIRED: 'Expiré',
  NOT_ACTIVATED: 'Non activé',
};

export interface AppSubscriptionSnapshot {
  status: SubscriptionStatus;
  expiresAt: Date | string | null;
  /** Fin de l'essai (table des essais) ; null si aucun essai. */
  trialEndsAt: Date | string | null;
}

/**
 * État fonctionnel calculé par le serveur, sans dépendre d'une tâche planifiée : un essai échu ou
 * un abonnement dont l'échéance est passée est présenté comme tel dès l'instant de l'échéance.
 */
export function commercialState(
  sub: AppSubscriptionSnapshot,
  now: Date = new Date(),
): CommercialState {
  switch (sub.status) {
    case 'TRIALING':
      return sub.trialEndsAt && isTrialActive(sub.trialEndsAt, now)
        ? 'TRIAL_ACTIVE'
        : 'TRIAL_EXPIRED';
    case 'ACTIVE':
      return sub.expiresAt !== null && new Date(sub.expiresAt).getTime() <= now.getTime()
        ? 'EXPIRED'
        : 'ACTIVE';
    case 'PAST_DUE':
    case 'PENDING_ACTIVATION':
      return 'RENEWAL_PENDING';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'CANCELED':
      return 'CANCELED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'NOT_ACTIVATED':
      return 'NOT_ACTIVATED';
    default:
      // Statut inconnu : traité comme expiré (jamais d'accès complet par défaut).
      return 'EXPIRED';
  }
}

/**
 * Droit d'accès à une application à partir de son abonnement (décision D3) :
 * - essai en cours, abonnement actif, renouvellement en attente : accès complet ;
 * - essai expiré, abonnement expiré, suspendu ou résilié : lecture seule (données conservées) ;
 * - abonnement « non activé » antérieur au socle S1 : accès complet conservé (aucune restriction
 *   rétroactive ; toute nouvelle souscription démarre en essai).
 * Aucun abonnement : `none`. Toute erreur de l'appelant doit aboutir à un refus, jamais à `full`.
 */
export function subscriptionAccess(
  sub: AppSubscriptionSnapshot | null,
  now: Date = new Date(),
): ProductAccess {
  if (!sub) return 'none';
  switch (commercialState(sub, now)) {
    case 'TRIAL_ACTIVE':
    case 'ACTIVE':
    case 'RENEWAL_PENDING':
    case 'NOT_ACTIVATED':
      return 'full';
    default:
      return 'read_only';
  }
}

/**
 * Option vitrine (décision D5) : publier un site exige une offre « avec vitrine », sauf pour une
 * organisation dont un site était déjà publié avant le socle S1 (antériorité, aucune restriction
 * rétroactive). L'édition d'un brouillon reste toujours possible.
 */
export function canPublishShowcase(input: {
  planIncludesShowcase: boolean;
  grandfathered: boolean;
}): boolean {
  return input.planIncludesShowcase || input.grandfathered;
}

/** Application du portail Ocall Suite, telle que présentée au client. */
export interface SuitePortalApp {
  code: string;
  slug: string | null;
  name: string;
  tagline: string;
  productStatus: SaasProductStatus;
  /** Lien vers l'application si l'accès est ouvert. */
  href: string | null;
  access: ProductAccess;
  subscription: {
    state: CommercialState;
    planName: string;
    monthlyPrice: number;
    includesShowcase: boolean;
    expiresAt: string | null;
  } | null;
  trial: { startedAt: string; endsAt: string; daysRemaining: number; active: boolean } | null;
  /** Le client peut démarrer lui-même un essai (application « Disponible », essai jamais utilisé). */
  canStartTrial: boolean;
  /** Le client peut demander une activation payante (ou un essai pour une application en préproduction). */
  canRequestActivation: boolean;
  /** Offres en vigueur proposées (application commercialisable). */
  plans: {
    id: string;
    name: string;
    monthlyPrice: number;
    setupFee: number;
    includesShowcase: boolean;
  }[];
  setupFeeStatus: SetupFeeStatus | null;
}
