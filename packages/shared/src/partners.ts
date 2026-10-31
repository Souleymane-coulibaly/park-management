/**
 * Partenaires commerciaux (Sprint 12B) : règles partagées par l'API (contrôle) et les interfaces
 * (affichage). Les taux de commission ne sont JAMAIS ici : ils vivent dans les règles validées par
 * Ocall (CommissionRule).
 */

export const PARTNER_STATUS_LABELS = {
  PENDING_VERIFICATION: 'À vérifier',
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
} as const;
export type PartnerStatus = keyof typeof PARTNER_STATUS_LABELS;

export const PROSPECT_STATUS_LABELS = {
  NEW: 'Nouveau',
  CONTACTED: 'Contacté',
  DEMO_REQUESTED: 'Démo demandée',
  QUALIFIED: 'Qualifié',
  WON: 'Gagné',
  LOST: 'Perdu',
} as const;
export type ProspectStatus = keyof typeof PROSPECT_STATUS_LABELS;
/** Statuts qu'un partenaire peut donner lui-même (« gagné » relève de l'attribution par Ocall). */
export const PARTNER_SETTABLE_PROSPECT_STATUSES = [
  'NEW',
  'CONTACTED',
  'DEMO_REQUESTED',
  'QUALIFIED',
  'LOST',
] as const;

export const ATTRIBUTION_STATUS_LABELS = {
  PENDING: 'À confirmer',
  CONFIRMED: 'Confirmée',
  REJECTED: 'Rejetée',
} as const;
export type AttributionStatus = keyof typeof ATTRIBUTION_STATUS_LABELS;

export const COMMISSION_STATUS_LABELS = {
  ACCRUED: 'Acquise (à valider)',
  VALIDATED: 'Validée',
  REVERSED: 'Annulée',
  PAID: 'Versée',
} as const;
export type CommissionStatus = keyof typeof COMMISSION_STATUS_LABELS;

export const COMMISSION_KIND_LABELS = {
  SETUP: 'Mise en service',
  MONTHLY: 'Mensualité',
  ADJUSTMENT: 'Régularisation',
} as const;
export type CommissionKind = keyof typeof COMMISSION_KIND_LABELS;

export const PAYOUT_STATUS_LABELS = {
  RECORDED: 'À confirmer',
  CONFIRMED: 'Confirmé',
  REJECTED: 'Rejeté',
} as const;

/** Durée de réservation d'un prospect pour le partenaire qui l'a enregistré (prolongeable). */
export const PROSPECT_PROTECTION_DAYS = 90;
/** Conservation des prospects non convertis, comme les demandes de démonstration. */
export const PROSPECT_RETENTION_MONTHS = 24;

/**
 * Clé de comparaison d'un téléphone pour détecter les doublons de prospects : les 8 derniers
 * chiffres (numéro national au Mali), indicatif et séparateurs ignorés.
 */
export function phoneMatchKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-8);
}

export const normalizeEmail = (email: string | null | undefined) =>
  email ? email.trim().toLowerCase() : null;

const LEGAL_FORMS = new Set([
  'sarl',
  'sa',
  'sas',
  'sasu',
  'suarl',
  'ets',
  'etablissements',
  'gie',
  'sci',
]);

/** Nom d'entreprise comparable : minuscules, sans accents, sans forme juridique ni ponctuation. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL_FORMS.has(w))
    .join(' ');
}

/** Code de parrainage : majuscules et chiffres, 4 à 16 caractères. */
export const isPartnerCode = (code: string) => /^[A-Z0-9]{4,16}$/.test(code);

/** Numéro de versement de commissions : VER-2026-00003. */
export function formatPayoutNumber(year: number, sequence: number): string {
  return `VER-${year}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Répartition d'un règlement entre les lignes de sa facture, au prorata (paiements partiels) ;
 * l'arrondi est porté par la dernière ligne pour que la somme soit exacte. Sert au tableau de
 * bord commercial et au calcul des commissions (une seule règle).
 */
export function allocatePayment(
  lines: { kind: 'SETUP' | 'MONTHLY' | 'ADJUSTMENT'; amount: number }[],
  invoiceTotal: number,
  paymentAmount: number,
): { setup: number; monthly: number; adjustments: number } {
  const out = { setup: 0, monthly: 0, adjustments: 0 };
  if (invoiceTotal <= 0 || lines.length === 0) return out;
  let allocated = 0;
  lines.forEach((l, i) => {
    const share =
      i === lines.length - 1
        ? paymentAmount - allocated
        : Math.round((paymentAmount * l.amount) / invoiceTotal);
    allocated += share;
    if (l.kind === 'SETUP') out.setup += share;
    else if (l.kind === 'MONTHLY') out.monthly += share;
    else out.adjustments += share;
  });
  return out;
}

/** Ajoute des mois à une date (fin de mois bornée). */
export function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(date.getUTCDate(), last));
  d.setUTCHours(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  return d;
}

/**
 * Commissions d'un encaissement confirmé : mise en service au taux « setup », mensualités au taux
 * « monthly » seulement dans la fenêtre (N mois après la première activation du client). Les
 * ajustements de facture ne sont pas commissionnés. Montants arrondis à l'inférieur.
 */
export function computeCommissions(input: {
  allocation: { setup: number; monthly: number };
  rule: { setupRateBps: number; monthlyRateBps: number; monthlyWindowMonths: number };
  /** Date de première activation de l'abonnement (ou de l'encaissement si pas encore activé). */
  windowStart: Date;
  paidAt: Date;
}): { kind: 'SETUP' | 'MONTHLY'; baseAmount: number; rateBps: number; amount: number }[] {
  const out: { kind: 'SETUP' | 'MONTHLY'; baseAmount: number; rateBps: number; amount: number }[] =
    [];
  const { allocation, rule } = input;
  if (allocation.setup > 0 && rule.setupRateBps > 0) {
    out.push({
      kind: 'SETUP',
      baseAmount: allocation.setup,
      rateBps: rule.setupRateBps,
      amount: Math.floor((allocation.setup * rule.setupRateBps) / 10_000),
    });
  }
  const windowEnd = addMonthsUtc(input.windowStart, rule.monthlyWindowMonths);
  if (allocation.monthly > 0 && rule.monthlyRateBps > 0 && input.paidAt < windowEnd) {
    out.push({
      kind: 'MONTHLY',
      baseAmount: allocation.monthly,
      rateBps: rule.monthlyRateBps,
      amount: Math.floor((allocation.monthly * rule.monthlyRateBps) / 10_000),
    });
  }
  return out.filter((c) => c.amount > 0);
}

/** Taux lisible : 1500 → « 15 % ». */
export const formatRateBps = (bps: number) =>
  `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
