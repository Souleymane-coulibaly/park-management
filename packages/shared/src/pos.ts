/**
 * Règles de calcul de la caisse. L'API est la seule autorité sur les montants : elle applique
 * ces fonctions aux tarifs lus en base, jamais à des prix transmis par le client.
 * Tous les montants sont des entiers en FCFA (le franc CFA n'a pas de subdivision en usage).
 */
export const MAX_SALE_LINES = 100;
export const MAX_LINE_QUANTITY = 999;
/** Plafond de sécurité d'un montant (100 millions de FCFA). */
export const MAX_AMOUNT = 100_000_000;

export const PaymentMethod = { CASH: 'CASH', WAVE: 'WAVE' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS: readonly PaymentMethod[] = Object.values(PaymentMethod);

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  WAVE: 'Wave',
};

export const PREPARATION_STATUS_LABELS = {
  NOT_SENT: 'Non envoyée en cuisine',
  SENT: 'Envoyée en cuisine',
  IN_PREPARATION: 'En préparation',
  READY: 'Prête',
  SERVED: 'Servie',
} as const;

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface SaleTotals {
  lineTotals: number[];
  total: number;
}

function assertAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT) {
    throw new RangeError(`${label} invalide : entier entre 0 et ${MAX_AMOUNT} FCFA attendu.`);
  }
}

/** Calcule les totaux de ligne et le total d'une vente. */
export function computeSaleTotals(lines: readonly PricedLine[]): SaleTotals {
  if (lines.length === 0 || lines.length > MAX_SALE_LINES) {
    throw new RangeError(`Une vente comporte de 1 à ${MAX_SALE_LINES} lignes.`);
  }
  const lineTotals = lines.map(({ unitPrice, quantity }) => {
    assertAmount(unitPrice, 'Prix unitaire');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      throw new RangeError(`Quantité invalide : entier entre 1 et ${MAX_LINE_QUANTITY} attendu.`);
    }
    return unitPrice * quantity;
  });
  const total = lineTotals.reduce((sum, t) => sum + t, 0);
  assertAmount(total, 'Total');
  return { lineTotals, total };
}

/** Monnaie à rendre pour un paiement en espèces ; null si le montant remis est insuffisant. */
export function computeChange(total: number, amountTendered: number): number | null {
  assertAmount(total, 'Total');
  assertAmount(amountTendered, 'Montant remis');
  return amountTendered >= total ? amountTendered - total : null;
}

/**
 * Espèces attendues dans le tiroir à la fermeture : fond de caisse + encaissements en espèces
 * (montants des ventes, la monnaie rendue étant déjà sortie du tiroir).
 */
export function computeExpectedCash(
  openingFloat: number,
  cashPaymentAmounts: readonly number[],
): number {
  assertAmount(openingFloat, 'Fond de caisse');
  return cashPaymentAmounts.reduce((sum, amount) => sum + amount, openingFloat);
}

/** Écart de caisse : négatif = manque, positif = excédent. */
export function computeCashVariance(expectedCash: number, countedCash: number): number {
  assertAmount(countedCash, 'Espèces comptées');
  return countedCash - expectedCash;
}

/** Numéro de vente lisible : 42 → « 000042 ». */
export function formatSaleNumber(number: number): string {
  return String(number).padStart(6, '0');
}
