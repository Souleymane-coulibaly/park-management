/**
 * Ocall Facture (F1, F2) — documents commerciaux : calcul des montants (FCFA, sans décimale), statuts et
 * transitions, conversions entre documents, facturation (reste dû, encaissements, avoirs, échéance),
 * montant en toutes lettres. Partagé par l'API (qui seule fait
 * foi) et le web (aperçu pendant la saisie).
 */
import { FACTURE_DOCUMENT_TYPE_LABELS, type FactureDocumentType } from './facture';

// ─── Montants ───

/** Prix unitaire maximal d'une ligne (FCFA hors taxe). */
export const FACTURE_MAX_UNIT_PRICE = 1_000_000_000;
/** Quantité maximale d'une ligne ; trois décimales au plus (0,001). */
export const FACTURE_MAX_QUANTITY = 1_000_000;
/** Nombre maximal de lignes d'un document. */
export const FACTURE_MAX_LINES = 200;
/** Total TTC maximal d'un document (FCFA) : reste exact en nombre JavaScript. */
export const FACTURE_MAX_DOCUMENT_TOTAL = 10_000_000_000_000;

export interface FactureLineAmountInput {
  /** Quantité, trois décimales au plus. */
  quantity: number;
  /** Prix unitaire hors taxe, en FCFA entiers. */
  unitPrice: number;
  /** Remise de la ligne, en pourcentage entier de 0 à 100. */
  discountPercent: number;
  /** Taux de TVA, en pourcentage entier de 0 à 20. */
  vatRate: number;
}

export interface FactureVatBucket {
  rate: number;
  /** Base hors taxe soumise à ce taux. */
  base: number;
  /** TVA due à ce taux (arrondie au franc). */
  amount: number;
}

export interface FactureTotals {
  /** Total hors taxe de chaque ligne, dans l'ordre. */
  lines: number[];
  /** Somme des lignes avant remise (sous-total brut). */
  grossHt: number;
  /** Remises cumulées : sous-total brut moins total hors taxe. */
  totalDiscount: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  /** Ventilation de la TVA par taux, taux croissants. */
  vat: FactureVatBucket[];
}

/** Quantité en millièmes (entier exact) ; refuse plus de trois décimales. */
export function quantityToMilli(quantity: number): number {
  const milli = Math.round(quantity * 1000);
  if (!Number.isFinite(quantity) || Math.abs(milli - quantity * 1000) > 1e-6) {
    throw new Error('Quantité invalide : trois décimales au plus.');
  }
  return milli;
}

/** Division entière arrondie au plus proche, la moitié vers le haut (montants positifs). */
const roundDiv = (numerator: bigint, denominator: bigint) =>
  (numerator * 2n + denominator) / (denominator * 2n);

/** Montant brut d'une ligne, avant remise : quantité × prix unitaire, arrondi au franc. */
export function lineGrossHt(line: Pick<FactureLineAmountInput, 'quantity' | 'unitPrice'>): number {
  return lineTotalHt({ ...line, discountPercent: 0, vatRate: 0 });
}

/** Total hors taxe d'une ligne : quantité × prix unitaire, moins la remise, arrondi au franc. */
export function lineTotalHt(line: FactureLineAmountInput): number {
  const milli = BigInt(quantityToMilli(line.quantity));
  const value = roundDiv(
    milli * BigInt(line.unitPrice) * BigInt(100 - line.discountPercent),
    100_000n,
  );
  return Number(value);
}

/**
 * Totaux d'un document. La TVA est calculée sur la base hors taxe cumulée de chaque taux (arrondie au
 * franc une fois par taux), jamais ligne à ligne : le total TTC est égal au total HT plus la TVA imprimée.
 */
export function computeFactureTotals(lines: readonly FactureLineAmountInput[]): FactureTotals {
  const totals = lines.map(lineTotalHt);
  const bases = new Map<number, number>();
  lines.forEach((line, i) => bases.set(line.vatRate, (bases.get(line.vatRate) ?? 0) + totals[i]!));
  const vat = [...bases.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, base]) => ({
      rate,
      base,
      amount: Number(roundDiv(BigInt(base) * BigInt(rate), 100n)),
    }));
  const totalHt = totals.reduce((sum, v) => sum + v, 0);
  const grossHt = lines.reduce((sum, line) => sum + lineGrossHt(line), 0);
  const totalVat = vat.reduce((sum, b) => sum + b.amount, 0);
  return {
    lines: totals,
    grossHt,
    totalDiscount: grossHt - totalHt,
    totalHt,
    totalVat,
    totalTtc: totalHt + totalVat,
    vat,
  };
}

// ─── Statuts et transitions ───

export const FACTURE_DOCUMENT_STATUSES = [
  'DRAFT',
  'ISSUED',
  'SENT',
  'ACCEPTED',
  'REFUSED',
  'CANCELLED',
  'PARTIALLY_PAID',
  'PAID',
  'CREDITED',
] as const;
export type FactureDocumentStatus = (typeof FACTURE_DOCUMENT_STATUSES)[number];

export const FACTURE_DOCUMENT_STATUS_LABELS: Record<FactureDocumentStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émis',
  SENT: 'Envoyé',
  ACCEPTED: 'Accepté',
  REFUSED: 'Refusé',
  CANCELLED: 'Annulé',
  PARTIALLY_PAID: 'Payée en partie',
  PAID: 'Soldée',
  CREDITED: 'Annulée par avoir',
};

/** Types créés directement ; un avoir naît toujours d'une facture émise (`credit-note`). */
export const FACTURE_CREATABLE_TYPES = ['QUOTE', 'PRO_FORMA', 'ORDER', 'INVOICE'] as const;
export type FactureCreatableType = (typeof FACTURE_CREATABLE_TYPES)[number];

/** Types émis (numérotés) : tous ; une facture ou un avoir émis est définitif (jamais annulé). */
export const FACTURE_ISSUABLE_TYPES: readonly FactureDocumentType[] = [
  'QUOTE',
  'PRO_FORMA',
  'ORDER',
  'INVOICE',
  'CREDIT_NOTE',
];

/** Documents qu'un client accepte ou refuse : devis et pro forma (un bon de commande vaut accord). */
export const FACTURE_ACCEPTABLE_TYPES: readonly FactureDocumentType[] = ['QUOTE', 'PRO_FORMA'];

/** Document émis et encore en vigueur : envoyable, convertible (selon son type). */
export const FACTURE_LIVE_STATUSES: readonly FactureDocumentStatus[] = [
  'ISSUED',
  'SENT',
  'ACCEPTED',
  'PARTIALLY_PAID',
  'PAID',
];

/** Conversions permises : devis → pro forma, bon de commande ou facture ; pro forma → bon ou facture. */
export const FACTURE_CONVERSIONS: Partial<
  Record<FactureDocumentType, readonly FactureDocumentType[]>
> = {
  QUOTE: ['PRO_FORMA', 'ORDER', 'INVOICE'],
  PRO_FORMA: ['ORDER', 'INVOICE'],
  ORDER: ['INVOICE'],
};

export function canConvertFactureDocument(
  source: { type: FactureDocumentType; status: FactureDocumentStatus },
  target: FactureDocumentType,
): boolean {
  return (
    FACTURE_LIVE_STATUSES.includes(source.status) &&
    (FACTURE_CONVERSIONS[source.type]?.includes(target) ?? false)
  );
}

export function canAcceptFactureDocument(doc: {
  type: FactureDocumentType;
  status: FactureDocumentStatus;
}): boolean {
  return (
    FACTURE_ACCEPTABLE_TYPES.includes(doc.type) &&
    (doc.status === 'ISSUED' || doc.status === 'SENT')
  );
}

/** Documents définitifs une fois émis : jamais annulés, corrigés par un avoir (facture). */
export const FACTURE_FINAL_TYPES: readonly FactureDocumentType[] = ['INVOICE', 'CREDIT_NOTE'];

/**
 * Un devis, une pro forma ou un bon de commande émis s'annule (son numéro reste attribué) ; un brouillon
 * se supprime ; une facture émise ne s'annule jamais : elle se corrige par un avoir.
 */
export function canCancelFactureDocument(doc: {
  type: FactureDocumentType;
  status: FactureDocumentStatus;
}): boolean {
  return (
    !FACTURE_FINAL_TYPES.includes(doc.type) && doc.status !== 'DRAFT' && doc.status !== 'CANCELLED'
  );
}

// ─── Facturation (F2) : reste dû, encaissements, avoirs ───

export const FACTURE_PAYMENT_METHODS = [
  'CASH',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
  'CHECK',
  'CARD',
  'OTHER',
] as const;
export type FacturePaymentMethod = (typeof FACTURE_PAYMENT_METHODS)[number];

export const FACTURE_PAYMENT_METHOD_LABELS: Record<FacturePaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Virement',
  CHECK: 'Chèque',
  CARD: 'Carte bancaire',
  OTHER: 'Autre',
};

/** Délai de paiement d'une facture (jours après l'émission). */
export const FACTURE_MAX_PAYMENT_TERMS_DAYS = 365;

export interface FactureInvoiceAmounts {
  totalTtc: number;
  /** Encaissements en vigueur (hors encaissements annulés). */
  amountPaid: number;
  /** Avoirs émis sur la facture (TTC). */
  amountCredited: number;
}

/**
 * Reste dû d'une facture : TTC moins encaissements et avoirs. Négatif quand un avoir est émis après
 * paiement : c'est alors un trop-perçu à rembourser au client.
 */
export const factureBalance = (i: FactureInvoiceAmounts) =>
  i.totalTtc - i.amountPaid - i.amountCredited;

/**
 * Statut d'une facture émise, déduit de ses montants : soldée (rien à payer, au moins un encaissement),
 * annulée par avoir (avoirs seuls), payée en partie, sinon émise ou envoyée.
 */
export function factureInvoiceStatus(
  i: FactureInvoiceAmounts & { sent: boolean },
): FactureDocumentStatus {
  if (factureBalance(i) <= 0) return i.amountPaid > 0 ? 'PAID' : 'CREDITED';
  if (i.amountPaid > 0 || i.amountCredited > 0) return 'PARTIALLY_PAID';
  return i.sent ? 'SENT' : 'ISSUED';
}

/** Statuts d'une facture émise qui reste à encaisser (encaissement, relance). */
export const FACTURE_OPEN_INVOICE_STATUSES: readonly FactureDocumentStatus[] = [
  'ISSUED',
  'SENT',
  'PARTIALLY_PAID',
];

export function canRecordFacturePayment(
  doc: { type: FactureDocumentType; status: FactureDocumentStatus } & FactureInvoiceAmounts,
): boolean {
  return (
    doc.type === 'INVOICE' &&
    FACTURE_OPEN_INVOICE_STATUSES.includes(doc.status) &&
    factureBalance(doc) > 0
  );
}

/** Un avoir se crée sur une facture émise dont le TTC n'est pas déjà entièrement crédité. */
export function canCreditFactureInvoice(
  doc: { type: FactureDocumentType; status: FactureDocumentStatus } & FactureInvoiceAmounts,
): boolean {
  return doc.type === 'INVOICE' && doc.status !== 'DRAFT' && doc.amountCredited < doc.totalTtc;
}

/** Échéance dépassée : date d'échéance antérieure à aujourd'hui (UTC, heure du Mali) et reste dû. */
export function isFactureOverdue(
  doc: {
    type: FactureDocumentType;
    status: FactureDocumentStatus;
    dueDate: string | Date | null;
  } & FactureInvoiceAmounts,
  today: Date,
): boolean {
  if (!canRecordFacturePayment(doc) || !doc.dueDate) return false;
  const due = new Date(doc.dueDate).getTime();
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return due < day;
}

// ─── Montant en toutes lettres ───

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0 à 99 (orthographe traditionnelle). `final` : « quatre-vingts » prend un s en fin de nombre. */
function belowHundred(n: number, final: boolean): string {
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n >= 80) {
    const rest = n - 80;
    if (rest === 0) return final ? 'quatre-vingts' : 'quatre-vingt';
    return `quatre-vingt-${belowHundred(rest, false)}`;
  }
  const ten = n >= 60 ? 6 : Math.floor(n / 10);
  const rest = n - ten * 10;
  if (rest === 0) return TENS[ten]!;
  if (rest === 1 || rest === 11) return `${TENS[ten]} et ${UNITS[rest]}`;
  return `${TENS[ten]}-${belowHundred(rest, false)}`;
}

/** 1 à 999. `final` : « cents » et « quatre-vingts » prennent un s s'ils terminent le nombre. */
function belowThousand(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    const plural = hundreds > 1 && rest === 0 && final;
    parts.push(hundreds === 1 ? 'cent' : `${UNITS[hundreds]} ${plural ? 'cents' : 'cent'}`);
  }
  if (rest > 0) parts.push(belowHundred(rest, final));
  return parts.join(' ');
}

const SCALES: [number, string, string][] = [
  [1_000_000_000_000, 'billion', 'billions'],
  [1_000_000_000, 'milliard', 'milliards'],
  [1_000_000, 'million', 'millions'],
];

/** Entier positif en toutes lettres, en français (ex. 1 200 000 → « un million deux cent mille »). */
export function numberToFrenchWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Entier positif attendu.');
  if (value === 0) return 'zéro';
  const parts: string[] = [];
  let rest = value;
  for (const [scale, singular, plural] of SCALES) {
    const count = Math.floor(rest / scale);
    if (count > 0) {
      // « millions », « milliards » sont des noms : « deux cents millions », « quatre-vingts millions ».
      parts.push(`${numberToFrenchWords(count)} ${count > 1 ? plural : singular}`);
      rest %= scale;
    }
  }
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    // « mille » est invariable et jamais précédé de « un » ; « deux cent mille », « quatre-vingt mille ».
    parts.push(thousands === 1 ? 'mille' : `${belowThousand(thousands, false)} mille`);
    rest %= 1000;
  }
  if (rest > 0) parts.push(belowThousand(rest, true));
  return parts.join(' ');
}

const FEMININE: readonly FactureDocumentType[] = ['PRO_FORMA', 'INVOICE'];

/**
 * Mention d'arrêté du montant, d'usage sur les documents commerciaux au Mali :
 * « Arrêté le présent devis à la somme de un million deux cent mille francs CFA TTC. »
 */
export function factureAmountInWords(type: FactureDocumentType, totalTtc: number): string {
  const label = FACTURE_DOCUMENT_TYPE_LABELS[type].toLowerCase();
  const head = FEMININE.includes(type)
    ? `Arrêtée la présente ${label}`
    : `Arrêté le présent ${label}`;
  const words = numberToFrenchWords(totalTtc);
  return `${head} à la somme de ${words} franc${totalTtc > 1 ? 's' : ''} CFA toutes taxes comprises.`;
}
