/**
 * Ocall Parc sprint 8 : pass et abonnements des visiteurs — règles pures partagées par l'API (vente,
 * contrôle d'accès, renouvellement, suspension) et le site (configuration, guichet, fiche abonné).
 *
 * Domaine distinct des abonnements SaaS d'Ocall Suite. Les dates de validité sont des dates locales
 * (AAAA-MM-JJ) ; le « jour » d'un passage est celui du parc où il a lieu (son fuseau), et les quotas
 * quotidiens se remettent à zéro à minuit dans ce fuseau (décision D4).
 */
import { addDays, type ScanRefusalReason } from './park';

export const PASS_KINDS = ['DAY', 'WEEK', 'MONTHLY', 'ANNUAL'] as const;
export type PassKind = (typeof PASS_KINDS)[number];
export const PASS_KIND_LABELS: Record<PassKind, string> = {
  DAY: 'Pass journalier',
  WEEK: 'Pass hebdomadaire',
  MONTHLY: 'Abonnement mensuel',
  ANNUAL: 'Abonnement annuel',
};

export const PASS_DURATION_UNITS = ['DAYS', 'MONTHS'] as const;
export type PassDurationUnit = (typeof PASS_DURATION_UNITS)[number];
export const PASS_QR_MODES = ['STATIC', 'DYNAMIC'] as const;
export type PassQrMode = (typeof PASS_QR_MODES)[number];
export const PASS_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];
/** État présenté : le statut, ou « EXPIRED » / « UPCOMING » déduits des dates. */
export type PassState = PassStatus | 'EXPIRED' | 'UPCOMING';
export const PASS_STATE_LABELS: Record<PassState, string> = {
  PENDING: 'En attente de paiement',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
  UPCOMING: 'À venir',
};
export const WEEKDAY_LABELS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'] as const;

/** Valeurs par défaut d'une offre selon son type (décisions D1, D2, D3, D7, D9). */
export interface PassOfferDefaults {
  durationUnit: PassDurationUnit;
  durationValue: number;
  totalEntries: number | null;
  dailyEntries: number | null;
  qrMode: PassQrMode;
  photoRequired: boolean;
  renewable: boolean;
}
export const PASS_KIND_DEFAULTS: Record<PassKind, PassOfferDefaults> = {
  DAY: {
    durationUnit: 'DAYS',
    durationValue: 1,
    totalEntries: 1,
    dailyEntries: 1,
    qrMode: 'STATIC',
    photoRequired: false,
    renewable: false,
  },
  WEEK: {
    durationUnit: 'DAYS',
    durationValue: 7,
    totalEntries: null,
    dailyEntries: 1,
    qrMode: 'STATIC',
    photoRequired: false,
    renewable: false,
  },
  MONTHLY: {
    durationUnit: 'MONTHS',
    durationValue: 1,
    totalEntries: null,
    dailyEntries: 1,
    qrMode: 'DYNAMIC',
    photoRequired: true,
    renewable: true,
  },
  ANNUAL: {
    durationUnit: 'MONTHS',
    durationValue: 12,
    totalEntries: null,
    dailyEntries: null,
    qrMode: 'DYNAMIC',
    photoRequired: true,
    renewable: true,
  },
};

/** La photo est toujours obligatoire pour un abonnement mensuel ou annuel (décision D9). */
export const passPhotoRequired = (kind: PassKind, offerFlag: boolean): boolean =>
  offerFlag || kind === 'MONTHLY' || kind === 'ANNUAL';

/** Ajoute des mois calendaires à une date locale (fin de mois bornée : 31 janv. + 1 mois → 28/29 févr.). */
export function addMonthsLocal(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Dernier jour (inclus) d'une période commençant `start` : N jours consécutifs (`DAYS`), ou N mois
 * calendaires (`MONTHS` : jusqu'à la veille du même jour N mois plus tard).
 */
export function periodEndDate(start: string, unit: PassDurationUnit, value: number): string {
  return unit === 'DAYS' ? addDays(start, value - 1) : addDays(addMonthsLocal(start, value), -1);
}

/** Jour de la semaine (0 = dimanche) d'une date locale. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Nombre de jours de `from` à `to` (dates locales, `to` exclu). */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

/**
 * Début d'un renouvellement (décision D6) : le lendemain de l'échéance précédente si elle court encore,
 * sinon le jour du paiement ; jamais de chevauchement.
 */
export function renewalStartDate(previousEnd: string, paymentDay: string): string {
  return previousEnd >= paymentDay ? addDays(previousEnd, 1) : paymentDay;
}

/**
 * Prolongation à la réactivation (décision D5) : jours entiers de suspension, plafonnés par l'offre ;
 * aucune si l'offre ne reporte pas la suspension sur la validité.
 */
export function suspensionExtensionDays(
  suspendedDay: string,
  reactivatedDay: string,
  rules: { maxSuspensionDays: number; suspensionExtends: boolean },
): number {
  if (!rules.suspensionExtends) return 0;
  return Math.max(0, Math.min(daysBetween(suspendedDay, reactivatedDay), rules.maxSuspensionDays));
}

/** Règles d'un pass figées à la vente (indépendantes des modifications ultérieures de l'offre). */
export interface PassRules {
  offerName: string;
  totalEntries: number | null;
  dailyEntries: number | null;
  allowedWeekdays: number[];
  qrMode: PassQrMode;
  siteIds: string[];
  durationUnit: PassDurationUnit;
  durationValue: number;
  maxSuspensionDays: number;
  suspensionExtends: boolean;
  renewable: boolean;
  /** Fuseau du parc de la vente : jour local des suspensions, renouvellements et états présentés. */
  timezone: string;
}

/** Période payée vue par le contrôle d'accès (dates locales incluses). */
export interface PassPeriodWindow {
  id: string;
  startDate: string;
  endDate: string;
  entriesUsed: number;
}

/**
 * Motif de refus d'un pass pour un passage le jour `today` (heure du parc) dans l'établissement
 * `establishmentId` ; null si l'entrée est autorisée (sous réserve des horaires du parc). Ordre : parc
 * non autorisé, annulé, suspendu, en attente de paiement ou pas encore valable, expiré, jour non
 * autorisé, quota du jour, quota de la période. Les quotas globaux sont partagés entre tous les parcs
 * autorisés (même compteur de période).
 */
export function passRefusal(input: {
  status: PassStatus;
  rules: PassRules;
  establishmentId: string;
  today: string;
  periods: PassPeriodWindow[];
  entriesToday: number;
}): { reason: ScanRefusalReason | null; period: PassPeriodWindow | null } {
  const { rules, today } = input;
  if (!rules.siteIds.includes(input.establishmentId)) {
    return { reason: 'OTHER_ESTABLISHMENT', period: null };
  }
  if (input.status === 'CANCELLED') return { reason: 'CANCELLED', period: null };
  if (input.status === 'SUSPENDED') return { reason: 'SUSPENDED', period: null };
  if (input.status === 'PENDING') return { reason: 'NOT_YET_VALID', period: null };
  const period = input.periods.find((p) => p.startDate <= today && today <= p.endDate) ?? null;
  if (!period) {
    const upcoming = input.periods.some((p) => p.startDate > today);
    return { reason: upcoming ? 'NOT_YET_VALID' : 'EXPIRED', period: null };
  }
  if (rules.allowedWeekdays.length > 0 && !rules.allowedWeekdays.includes(weekdayOf(today))) {
    return { reason: 'DAY_NOT_ALLOWED', period };
  }
  if (rules.dailyEntries !== null && input.entriesToday >= rules.dailyEntries) {
    return { reason: 'DAILY_QUOTA_REACHED', period };
  }
  if (rules.totalEntries !== null && period.entriesUsed >= rules.totalEntries) {
    return { reason: 'QUOTA_REACHED', period };
  }
  return { reason: null, period };
}

/** État présenté d'un pass à une date locale. */
export function passState(
  status: PassStatus,
  startDate: string,
  endDate: string,
  today: string,
): PassState {
  if (status !== 'ACTIVE') return status;
  if (today > endDate) return 'EXPIRED';
  if (today < startDate) return 'UPCOMING';
  return 'ACTIVE';
}

// ─── QR des pass ───

/** QR dynamique : fenêtre de 30 s ; tolérance d'une fenêtre (décalage d'horloge, lecture tardive). */
export const PASS_QR_WINDOW_SECONDS = 30;
export const PASS_QR_TOLERANCE_WINDOWS = 1;
export const passQrWindow = (ms: number): number =>
  Math.floor(ms / (PASS_QR_WINDOW_SECONDS * 1000));

export const PASS_STATIC_QR_PREFIX = 'OCPS-';
export const PASS_DYNAMIC_QR_PREFIX = 'OCPD-';
export const PASS_CARD_QR_PREFIX = 'OCPC-';
const ID = '[A-Za-z0-9_-]{16}';
const SIG = '[A-Za-z0-9_-]{22}';

export type AccessQr =
  | { type: 'pass_static'; publicId: string; signature: string }
  | { type: 'pass_dynamic'; publicId: string; window: number; signature: string }
  | { type: 'card'; cardNumber: string; signature: string };

/**
 * Lit le contenu d'un QR de pass ou de carte (le billet classique `OCP1-` est lu par `parseTicketQr`) ;
 * null si le format ne correspond pas. La SIGNATURE n'est vérifiée que par le serveur.
 */
export function parseAccessQr(scanned: string): AccessQr | null {
  const text = scanned.trim();
  let m = new RegExp(`^${PASS_STATIC_QR_PREFIX}(${ID})\\.(${SIG})$`).exec(text);
  if (m) return { type: 'pass_static', publicId: m[1]!, signature: m[2]! };
  m = new RegExp(`^${PASS_DYNAMIC_QR_PREFIX}(${ID})\\.(\\d{1,12})\\.(${SIG})$`).exec(text);
  if (m) return { type: 'pass_dynamic', publicId: m[1]!, window: Number(m[2]), signature: m[3]! };
  m = new RegExp(`^${PASS_CARD_QR_PREFIX}(${ID})\\.(${SIG})$`).exec(text);
  if (m) return { type: 'card', cardNumber: m[1]!, signature: m[2]! };
  return null;
}
