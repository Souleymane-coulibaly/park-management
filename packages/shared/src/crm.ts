/**
 * Règles du Sprint 6 partagées par l'API (autorité) et l'interface : CRM, fidélité, planning du
 * personnel et bornes de commande.
 */

// ─── CRM ───

/** Durée de conservation d'une fiche client sans visite, au-delà de laquelle elle est anonymisée. */
export const CUSTOMER_RETENTION_MONTHS = 36;
/** Un employé sans accès à l'historique ne peut que rechercher (≥ 3 caractères, 10 résultats). */
export const CUSTOMER_SEARCH_MIN_LENGTH = 3;
export const CUSTOMER_SEARCH_LIMIT_RESTRICTED = 10;

/**
 * Normalise un numéro de téléphone saisi librement : chiffres uniquement, « + » initial conservé.
 * Renvoie null si le résultat ne ressemble pas à un numéro (6 à 15 chiffres).
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 15) return null;
  if (/[^0-9+\s().-]/.test(trimmed)) return null;
  return `${plus}${digits}`;
}

/** Numéro masqué pour l'affichage : seuls les 4 derniers chiffres restent visibles. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const visible = phone.slice(-4);
  return `${'•'.repeat(Math.max(0, phone.length - 4))}${visible}`;
}

/** Nom affiché d'une fiche (les champs sont facultatifs). */
export function customerDisplayName(c: {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  anonymizedAt?: Date | string | null;
}): string {
  if (c.anonymizedAt) return 'Client anonymisé';
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
  return name || c.phone || 'Client sans nom';
}

// ─── Fidélité ───

/** Deux portefeuilles distincts : jamais de transfert automatique entre Parc et Restaurant. */
export const LOYALTY_ACTIVITIES = ['PARK', 'RESTAURANT'] as const;
export type LoyaltyActivity = (typeof LOYALTY_ACTIVITIES)[number];

export const LOYALTY_ACTIVITY_LABELS: Record<LoyaltyActivity, string> = {
  PARK: 'Fidélité Parc',
  RESTAURANT: 'Fidélité Restaurant',
};

export const LOYALTY_TRANSACTION_LABELS = {
  EARN: 'Points gagnés',
  REDEEM: 'Points utilisés',
  ADJUST: 'Correction manuelle',
  REVERSAL: 'Annulation',
} as const;

export const MAX_LOYALTY_POINTS = 10_000_000;

/** Points gagnés pour un montant effectivement payé : 1 point par tranche complète. */
export function computeEarnedPoints(paidAmount: number, earnAmountStep: number): number {
  if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0) return 0;
  if (!Number.isSafeInteger(earnAmountStep) || earnAmountStep <= 0) return 0;
  return Math.floor(paidAmount / earnAmountStep);
}

export type RedemptionDecision =
  | { ok: true; points: number; discount: number }
  | {
      ok: false;
      code: 'INVALID_POINTS' | 'BELOW_MINIMUM' | 'INSUFFICIENT_POINTS' | 'EXCEEDS_TOTAL';
    };

/**
 * Utilisation de points sur une vente non payée : la remise (points × valeur) est calculée par le
 * serveur et ne peut ni dépasser le total de la vente ni rendre le solde négatif.
 */
export function decideRedemption(
  points: number,
  balance: number,
  rule: { redeemValue: number; minRedeemPoints: number },
  saleTotal: number,
): RedemptionDecision {
  if (!Number.isSafeInteger(points) || points <= 0 || points > MAX_LOYALTY_POINTS) {
    return { ok: false, code: 'INVALID_POINTS' };
  }
  if (points < rule.minRedeemPoints) return { ok: false, code: 'BELOW_MINIMUM' };
  if (points > balance) return { ok: false, code: 'INSUFFICIENT_POINTS' };
  const discount = points * rule.redeemValue;
  if (discount > saleTotal) return { ok: false, code: 'EXCEEDS_TOTAL' };
  return { ok: true, points, discount };
}

// ─── Planning du personnel ───

export const STAFF_POSITION_KINDS = [
  'CASHIER',
  'KITCHEN',
  'ENTRANCE',
  'SURVEILLANCE',
  'CLEANING',
  'OTHER',
] as const;
export type StaffPositionKind = (typeof STAFF_POSITION_KINDS)[number];

export const STAFF_POSITION_KIND_LABELS: Record<StaffPositionKind, string> = {
  CASHIER: 'Caisse',
  KITCHEN: 'Cuisine',
  ENTRANCE: 'Entrée',
  SURVEILLANCE: 'Surveillance',
  CLEANING: 'Entretien',
  OTHER: 'Autre',
};

/** Postes créés par défaut pour une organisation (modifiables et complétables). */
export const DEFAULT_STAFF_POSITIONS: readonly { name: string; kind: StaffPositionKind }[] = [
  { name: 'Caisse', kind: 'CASHIER' },
  { name: 'Cuisine', kind: 'KITCHEN' },
  { name: 'Entrée', kind: 'ENTRANCE' },
  { name: 'Surveillance', kind: 'SURVEILLANCE' },
  { name: 'Entretien', kind: 'CLEANING' },
];

/** Durée maximale d'un créneau (garde-fou contre une erreur de saisie). */
export const MAX_SHIFT_HOURS = 16;
/** Période maximale consultée d'un coup (vue mensuelle et un peu plus). */
export const MAX_PLANNING_RANGE_DAYS = 45;

// ─── Bornes de commande ───

/** Code d'appairage : 8 caractères sans ambiguïté (pas de 0/O, 1/I/L), valable 15 minutes. */
export const KIOSK_PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const KIOSK_PAIRING_CODE_LENGTH = 8;
export const KIOSK_PAIRING_TTL_MINUTES = 15;
/** Durée de validité du jeton d'appareil (renouvelée par un nouvel appairage). */
export const KIOSK_TOKEN_TTL_DAYS = 180;
/** Une session client dure au plus 15 minutes ; l'écran revient à l'accueil après 90 s d'inactivité. */
export const KIOSK_SESSION_MINUTES = 15;
export const KIOSK_IDLE_SECONDS = 90;
export const KIOSK_CONFIRMATION_SECONDS = 20;
/** Anti-abus : commandes par borne sur 10 minutes. */
export const KIOSK_MAX_ORDERS_PER_10_MIN = 30;

export function isKioskPairingCode(value: string): boolean {
  return new RegExp(`^[${KIOSK_PAIRING_ALPHABET}]{${KIOSK_PAIRING_CODE_LENGTH}}$`).test(value);
}

/** Numéro affiché au client de la borne : « B-0042 ». */
export function formatKioskNumber(n: number): string {
  return `B-${String(n).padStart(4, '0')}`;
}

/** Une URL de photo produit doit être en https (aucun contenu mixte, aucun schéma exotique). */
export function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && url.length <= 500;
  } catch {
    return false;
  }
}
