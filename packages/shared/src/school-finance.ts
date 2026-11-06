/**
 * Ocall School, gestion financière (Sprint 5) : frais, échéanciers, avantages, encaissements. Règles
 * pures partagées par l'API (seule source des montants) et le frontend (affichage). Tous les montants
 * sont des entiers en unités mineures de la devise (XOF : le franc ; EUR : le centime) : aucun calcul
 * monétaire ne passe par un nombre à virgule.
 */

/** Devises acceptées et leur nombre de décimales (ISO 4217). */
export const SCHOOL_CURRENCIES = {
  XOF: 0,
  XAF: 0,
  GNF: 0,
  MRU: 2,
  MAD: 2,
  DZD: 2,
  TND: 3,
  EUR: 2,
  USD: 2,
} as const;
export type SchoolCurrency = keyof typeof SCHOOL_CURRENCIES;
export const SCHOOL_CURRENCY_CODES = Object.keys(SCHOOL_CURRENCIES) as SchoolCurrency[];

export function isSchoolCurrency(code: string): code is SchoolCurrency {
  return Object.prototype.hasOwnProperty.call(SCHOOL_CURRENCIES, code);
}

/** Montant maximal d'une opération, en unités mineures : borne les saisies et les sommes. */
export const SCHOOL_MAX_AMOUNT = 1_000_000_000;

/**
 * Espaces de saisie (espace, tabulation, retours à la ligne, insécables U+00A0 et U+202F), construites
 * par leur code : aucun caractère invisible dans le source.
 */
const SPACES = new RegExp(`[${String.fromCharCode(32, 9, 10, 13, 0xa0, 0x202f)}]`, 'g');

/** Montant saisi (« 12 500 », « 12,5 ») converti en unités mineures, ou null s'il est invalide. */
export function parseAmount(input: string, currency: SchoolCurrency): number | null {
  const decimals = SCHOOL_CURRENCIES[currency];
  const cleaned = input.replace(SPACES, '').replace(',', '.');
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(minor) && minor <= SCHOOL_MAX_AMOUNT ? minor : null;
}

/** Montant en unités mineures affiché dans la devise (« 12 500 XOF », « 12,50 EUR »). */
export function formatAmount(minor: number, currency: SchoolCurrency, locale = 'fr-FR'): string {
  const decimals = SCHOOL_CURRENCIES[currency];
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** decimals);
  const fraction = abs % 10 ** decimals;
  const wholeText = whole.toLocaleString(locale, { maximumFractionDigits: 0 });
  const separator = locale.startsWith('fr') ? ',' : '.';
  const fractionText = decimals ? `${separator}${String(fraction).padStart(decimals, '0')}` : '';
  return `${sign}${wholeText}${fractionText} ${currency}`;
}

/**
 * Montant stocké en unités mineures converti dans l'unité de la devise (10000 → 100 pour EUR, 10000 →
 * 10000 pour XOF, 10000 → 10 pour TND). Pour les exports et les données remises au copilote IA, qui
 * présentent un nombre à côté du code de la devise : jamais d'unités mineures sous un libellé de devise.
 */
export function toMajorUnits(minor: number, currency: SchoolCurrency): number {
  const decimals = SCHOOL_CURRENCIES[currency];
  return decimals === 0 ? minor : Number((minor / 10 ** decimals).toFixed(decimals));
}

// ─── Frais ───

export const SCHOOL_FEE_CATEGORIES = [
  'REGISTRATION',
  'REENROLLMENT',
  'TUITION',
  'CANTEEN',
  'TRANSPORT',
  'EXAM',
  'OTHER',
] as const;
export type SchoolFeeCategory = (typeof SCHOOL_FEE_CATEGORIES)[number];

export const SCHOOL_FEE_CATEGORY_LABELS: Record<SchoolFeeCategory, string> = {
  REGISTRATION: 'Frais d’inscription',
  REENROLLMENT: 'Frais de réinscription',
  TUITION: 'Frais de scolarité',
  CANTEEN: 'Frais de cantine',
  TRANSPORT: 'Frais de transport',
  EXAM: 'Frais d’examen',
  OTHER: 'Frais divers',
};

// ─── Échéanciers ───

export const SCHOOL_PLAN_KINDS = ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'CUSTOM'] as const;
export type SchoolPlanKind = (typeof SCHOOL_PLAN_KINDS)[number];

export const SCHOOL_PLAN_KIND_LABELS: Record<SchoolPlanKind, string> = {
  ANNUAL: 'Annuel',
  MONTHLY: 'Mensuel',
  QUARTERLY: 'Trimestriel',
  CUSTOM: 'Personnalisé',
};

export interface PlannedInstallment {
  position: number;
  /** Date limite AAAA-MM-JJ. */
  dueOn: string;
  amount: number;
}

export type SchoolPlanInput =
  | { kind: 'ANNUAL'; dueOn: string }
  | {
      kind: 'MONTHLY' | 'QUARTERLY';
      /** Premier mois AAAA-MM et dernier mois AAAA-MM, inclus. */
      firstMonth: string;
      lastMonth: string;
      /** Jour limite dans le mois (1 à 31, ramené au dernier jour d'un mois plus court). */
      dueDay: number;
    }
  | { kind: 'CUSTOM'; installments: { dueOn: string; amount: number }[] };

/**
 * Partage exact d'un total en `count` parts entières : les premières reçoivent l'unité restante, la
 * somme vaut toujours le total.
 */
export function splitAmount(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(count) || count < 1) {
    throw new Error('Partage impossible.');
  }
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function monthsBetween(first: string, last: string): { year: number; month: number }[] {
  const a = MONTH.exec(first);
  const b = MONTH.exec(last);
  if (!a || !b) throw new Error('Mois invalide.');
  const start = Number(a[1]) * 12 + Number(a[2]) - 1;
  const end = Number(b[1]) * 12 + Number(b[2]) - 1;
  if (end < start || end - start > 23) throw new Error('Plage de mois invalide.');
  return Array.from({ length: end - start + 1 }, (_, i) => ({
    year: Math.floor((start + i) / 12),
    month: ((start + i) % 12) + 1,
  }));
}

function dueDate(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(Math.max(day, 1), last);
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Échéances d'un frais selon son échéancier : annuel (une échéance), mensuel (une par mois),
 * trimestriel (une par tranche de trois mois, à la date du premier mois de la tranche), personnalisé
 * (montants fournis, dont la somme doit égaler le total). Le total est partagé exactement.
 */
export function buildInstallments(plan: SchoolPlanInput, total: number): PlannedInstallment[] {
  if (plan.kind === 'ANNUAL') {
    if (!DAY.test(plan.dueOn)) throw new Error('Date invalide.');
    return [{ position: 1, dueOn: plan.dueOn, amount: total }];
  }
  if (plan.kind === 'CUSTOM') {
    const rows = plan.installments;
    if (rows.length < 1 || rows.length > 24) throw new Error('Une à vingt-quatre échéances.');
    if (rows.some((r) => !DAY.test(r.dueOn) || !Number.isSafeInteger(r.amount) || r.amount < 0)) {
      throw new Error('Échéance invalide.');
    }
    if (rows.reduce((s, r) => s + r.amount, 0) !== total) {
      throw new Error('La somme des échéances doit égaler le montant du frais.');
    }
    return [...rows]
      .sort((x, y) => x.dueOn.localeCompare(y.dueOn))
      .map((r, i) => ({ position: i + 1, dueOn: r.dueOn, amount: r.amount }));
  }
  const months = monthsBetween(plan.firstMonth, plan.lastMonth);
  const starts = plan.kind === 'MONTHLY' ? months : months.filter((_, i) => i % 3 === 0);
  const amounts = splitAmount(total, starts.length);
  return starts.map((m, i) => ({
    position: i + 1,
    dueOn: dueDate(m.year, m.month, plan.dueDay),
    amount: amounts[i]!,
  }));
}

// ─── Avantages : réductions, bourses, exonérations ───

export const SCHOOL_BENEFIT_KINDS = [
  'FIXED',
  'PERCENT',
  'SCHOLARSHIP',
  'EXEMPTION',
  'FAMILY',
] as const;
export type SchoolBenefitKind = (typeof SCHOOL_BENEFIT_KINDS)[number];

export const SCHOOL_BENEFIT_KIND_LABELS: Record<SchoolBenefitKind, string> = {
  FIXED: 'Réduction fixe',
  PERCENT: 'Réduction en pourcentage',
  SCHOLARSHIP: 'Bourse partielle',
  EXEMPTION: 'Exonération totale',
  FAMILY: 'Réduction familiale',
};

/** Avantage tel que le calcul le consomme. */
export interface BenefitRule {
  kind: SchoolBenefitKind;
  /**
   * FIXED : montant retiré de chaque échéance concernée (unités mineures). PERCENT, SCHOLARSHIP,
   * FAMILY : taux en points de base (10 000 = 100 %). EXEMPTION : ignoré (100 %).
   */
  value: number;
}

/** Valeur d'un avantage contrôlée : montant ou taux selon sa nature. Message, ou null si valide. */
export function benefitValueError(kind: SchoolBenefitKind, value: number): string | null {
  if (kind === 'EXEMPTION') return null;
  if (!Number.isSafeInteger(value) || value <= 0) return 'La valeur doit être un entier positif.';
  if (kind === 'FIXED') return value > SCHOOL_MAX_AMOUNT ? 'Montant trop élevé.' : null;
  return value > 10_000 ? 'Le taux ne peut dépasser 100 %.' : null;
}

/**
 * Réduction d'une échéance : les taux s'additionnent (plafonnés à 100 %) et s'appliquent au montant
 * facturé, arrondis à l'unité inférieure ; les réductions fixes s'y ajoutent ; une exonération couvre
 * tout. La réduction ne dépasse jamais le montant.
 */
export function chargeDiscount(amount: number, benefits: readonly BenefitRule[]): number {
  if (benefits.some((b) => b.kind === 'EXEMPTION')) return amount;
  const rate = Math.min(
    10_000,
    benefits.filter((b) => b.kind !== 'FIXED').reduce((s, b) => s + b.value, 0),
  );
  // Produit d'entiers bornés (1e9 × 1e4 < 2^53) : division entière exacte.
  const byRate = Math.floor((amount * rate) / 10_000);
  const fixed = benefits.filter((b) => b.kind === 'FIXED').reduce((s, b) => s + b.value, 0);
  return Math.min(amount, byRate + fixed);
}

// ─── Échéances et soldes ───

export const SCHOOL_CHARGE_STATUSES = ['UPCOMING', 'PARTIAL', 'PAID', 'OVERDUE'] as const;
export type SchoolChargeStatus = (typeof SCHOOL_CHARGE_STATUSES)[number];

export const SCHOOL_CHARGE_STATUS_LABELS: Record<SchoolChargeStatus, string> = {
  UPCOMING: 'À venir',
  PARTIAL: 'Partiellement payé',
  PAID: 'Payé',
  OVERDUE: 'En retard',
};

export interface ChargeAmounts {
  amount: number;
  discount: number;
  adjustment: number;
  paid: number;
}

/** Montant dû après réductions et ajustements. */
export function chargeDue(c: Pick<ChargeAmounts, 'amount' | 'discount' | 'adjustment'>): number {
  return c.amount - c.discount + c.adjustment;
}

/** Reste à payer, jamais négatif. */
export function chargeBalance(c: ChargeAmounts): number {
  return Math.max(0, chargeDue(c) - c.paid);
}

/**
 * Statut d'une échéance à une date : payée (rien à payer) ; en retard (date limite dépassée et un
 * reste) ; partiellement payée ; à venir.
 */
export function chargeStatus(
  c: ChargeAmounts & { dueOn: string },
  today: string,
): SchoolChargeStatus {
  if (chargeBalance(c) === 0) return 'PAID';
  if (c.dueOn.slice(0, 10) < today) return 'OVERDUE';
  return c.paid > 0 ? 'PARTIAL' : 'UPCOMING';
}

// ─── Encaissements ───

export const SCHOOL_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY'] as const;
export type SchoolPaymentMethod = (typeof SCHOOL_PAYMENT_METHODS)[number];

export const SCHOOL_PAYMENT_METHOD_LABELS: Record<SchoolPaymentMethod, string> = {
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement bancaire',
  MOBILE_MONEY: 'Mobile money (déclaré)',
};

/** Référence de transaction exigée pour un virement ou un mobile money, facultative en espèces. */
export function paymentReferenceRequired(method: SchoolPaymentMethod): boolean {
  return method !== 'CASH';
}

/**
 * Vérification d'un encaissement : un mobile money saisi à la main est seulement « déclaré », jamais
 * présenté comme vérifié par l'opérateur (aucune intégration au Sprint 5).
 */
export type SchoolPaymentVerification = 'NOT_APPLICABLE' | 'DECLARED_UNVERIFIED';

export function paymentVerification(method: SchoolPaymentMethod): SchoolPaymentVerification {
  return method === 'MOBILE_MONEY' ? 'DECLARED_UNVERIFIED' : 'NOT_APPLICABLE';
}

/**
 * Affectation automatique d'un montant aux échéances, de la plus ancienne à la plus récente (puis par
 * ordre fourni), sans jamais dépasser le reste de chacune. Renvoie les montants affectés et le reliquat.
 */
export function allocateOldestFirst(
  amount: number,
  charges: readonly { id: string; dueOn: string; balance: number }[],
): { allocations: { chargeId: string; amount: number }[]; remainder: number } {
  let left = amount;
  const allocations: { chargeId: string; amount: number }[] = [];
  const ordered = [...charges].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  for (const c of ordered) {
    if (left === 0) break;
    const part = Math.min(left, c.balance);
    if (part > 0) {
      allocations.push({ chargeId: c.id, amount: part });
      left -= part;
    }
  }
  return { allocations, remainder: left };
}

/** Numéro de reçu : préfixe, année de l'encaissement et compteur sur six chiffres (« REC-2026-000042 »). */
export function receiptNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Vue en lecture seule d'une échéance pour la famille (futur portail parents) : libellé, dates et
 * montants, sans agent, motif d'ajustement ni historique interne.
 */
export function guardianChargeView(
  c: ChargeAmounts & {
    label: string;
    labelAr: string | null;
    dueOn: string;
    currency: SchoolCurrency;
  },
  today: string,
) {
  return {
    label: c.label,
    labelAr: c.labelAr,
    dueOn: c.dueOn.slice(0, 10),
    currency: c.currency,
    amount: c.amount,
    discount: c.discount,
    due: chargeDue(c),
    paid: c.paid,
    balance: chargeBalance(c),
    status: chargeStatus(c, today),
  };
}
