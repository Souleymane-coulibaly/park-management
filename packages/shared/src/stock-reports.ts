/**
 * Ocall Stock — S6 : tableaux de bord, marges, valorisation, alertes. Règles de calcul partagées par l'API et
 * l'écran, avec leur méthode affichée en clair : aucun chiffre sans sa définition.
 *
 * - Chiffre d'affaires : ventes en caisse Ocall Stock seulement (les factures restent dans Ocall Facture),
 *   moins les remboursements de la période.
 * - Marge estimée : CA hors taxe − quantités vendues × prix d'achat de la fiche article.
 * - Marge brute : CA hors taxe − quantités vendues × coût moyen pondéré (CMUP) des réceptions fournisseurs.
 * - Bénéfice net : non calculé (aucune charge n'est saisie dans Ocall Stock).
 */

/** Seuil « faible rotation » proposé : aucune sortie depuis 90 jours. */
export const STOCK_DEFAULT_SLOW_MOVING_DAYS = 90;
export const STOCK_SLOW_MOVING_DAYS_MIN = 15;
export const STOCK_SLOW_MOVING_DAYS_MAX = 365;
/** Période la plus longue d'un tableau de bord (un an et un jour, années bissextiles comprises). */
export const STOCK_REPORT_MAX_DAYS = 366;

/** Mouvements qui comptent comme une sortie vers l'extérieur (rotation) ; les déplacements internes non. */
export const STOCK_OUTGOING_KINDS = [
  'OUT',
  'SALE',
  'TRANSFER_OUT',
  'SUPPLIER_RETURN',
  'FACTURE_INVOICE',
  'FACTURE_PART',
] as const;

export const STOCK_REPORT_METHODS = {
  revenue:
    'Ventes encaissées en caisse Ocall Stock sur la période, moins les remboursements de la période. Les factures Ocall Facture n’y figurent pas.',
  estimatedMargin:
    'CA hors taxe − quantités vendues × prix d’achat saisi sur la fiche article. Les articles sans prix d’achat sont exclus et comptés à part.',
  grossMargin:
    'CA hors taxe − quantités vendues × coût moyen pondéré (CMUP) des réceptions fournisseurs ; à défaut de réception, prix d’achat de la fiche (signalé).',
  netProfit:
    'Bénéfice net non calculé : Ocall Stock ne connaît pas vos charges (loyer, salaires, transport…).',
  stockValue:
    'Quantité en stock × coût moyen pondéré des réceptions ; à défaut, prix d’achat de la fiche (signalé). Articles sans aucun coût : non valorisés, comptés à part.',
  slowMoving:
    'Article en stock sans aucune sortie (vente, facture, intervention, transfert, retour fournisseur, sortie manuelle) depuis le nombre de jours réglé.',
  lowStock:
    'Disponible (en stock − réservé) inférieur ou égal au seuil d’alerte de la fiche article, par site.',
} as const;

/** Montants entiers, quantités en millièmes : aucun arrondi flottant cumulé. */
const milli = (q: number) => Math.round(q * 1000);

/**
 * Coût moyen pondéré : Σ(quantité × coût) / Σ quantité des réceptions (non annulées). Null sans réception.
 * Arrondi à l'unité monétaire.
 */
export function stockWeightedCost(
  receipts: readonly { quantity: number; unitCost: number }[],
): number | null {
  let qty = 0;
  let value = 0;
  for (const r of receipts) {
    const q = milli(r.quantity);
    if (q <= 0) continue;
    qty += q;
    value += q * r.unitCost;
  }
  return qty > 0 ? Math.round(value / qty) : null;
}

/** Coût retenu pour un article : CMUP, sinon prix d'achat de la fiche (signalé), sinon aucun. */
export function stockUnitCost(
  weighted: number | null,
  purchasePrice: number | null,
): { cost: number | null; source: 'RECEIPTS' | 'PRODUCT' | 'NONE' } {
  if (weighted !== null) return { cost: weighted, source: 'RECEIPTS' };
  if (purchasePrice !== null) return { cost: purchasePrice, source: 'PRODUCT' };
  return { cost: null, source: 'NONE' };
}

/** Ligne vendue, nette des retours, telle que la marge la lit. */
export interface StockMarginLine {
  quantity: number;
  /** Montant hors taxe encaissé (après remise, retours déduits). */
  revenueHt: number;
  /** Prix d'achat de la fiche ; null s'il est inconnu. */
  purchasePrice: number | null;
  /** Coût retenu pour la marge brute (CMUP ou repli) ; null s'il est inconnu. */
  unitCost: number | null;
}

export interface StockMargins {
  revenueHt: number;
  /** Null si aucune ligne n'a de prix d'achat. */
  estimated: number | null;
  /** Lignes exclues de la marge estimée (sans prix d'achat). */
  estimatedExcluded: number;
  gross: number | null;
  grossExcluded: number;
}

/** Marges estimée et brute d'un ensemble de lignes (méthodes : `STOCK_REPORT_METHODS`). */
export function stockMargins(lines: readonly StockMarginLine[]): StockMargins {
  let revenueHt = 0;
  let estRevenue = 0;
  let estCost = 0;
  let estCount = 0;
  let estimatedExcluded = 0;
  let grossRevenue = 0;
  let grossCost = 0;
  let grossCount = 0;
  let grossExcluded = 0;
  for (const l of lines) {
    revenueHt += l.revenueHt;
    const q = milli(l.quantity);
    if (l.purchasePrice === null) estimatedExcluded += 1;
    else {
      estRevenue += l.revenueHt;
      estCost += Math.round((q * l.purchasePrice) / 1000);
      estCount += 1;
    }
    if (l.unitCost === null) grossExcluded += 1;
    else {
      grossRevenue += l.revenueHt;
      grossCost += Math.round((q * l.unitCost) / 1000);
      grossCount += 1;
    }
  }
  return {
    revenueHt,
    estimated: estCount > 0 ? estRevenue - estCost : null,
    estimatedExcluded,
    gross: grossCount > 0 ? grossRevenue - grossCost : null,
    grossExcluded,
  };
}

/** Taux de marge (en %, une décimale) ; null sans chiffre d'affaires. */
export function stockMarginRate(margin: number | null, revenueHt: number): number | null {
  if (margin === null || revenueHt <= 0) return null;
  return Math.round((margin / revenueHt) * 1000) / 10;
}

/** Valeur d'une quantité au coût unitaire (arrondie) ; null si le coût est inconnu. */
export function stockValue(quantity: number, unitCost: number | null): number | null {
  if (unitCost === null) return null;
  return Math.round((milli(quantity) * unitCost) / 1000);
}

/** Vrai si l'article est « à faible rotation » : en stock, aucune sortie depuis `days` jours. */
export function stockIsSlowMoving(
  onHand: number,
  lastOutAt: Date | null,
  createdAt: Date,
  now: Date,
  days: number,
): boolean {
  if (onHand <= 0) return false;
  const since = lastOutAt ?? createdAt;
  return now.getTime() - since.getTime() >= days * 86_400_000;
}

/** Période [from, to] (dates UTC, bornes incluses) : 30 derniers jours par défaut, un an au plus. */
export function stockReportPeriod(
  from: string | undefined,
  to: string | undefined,
  now: Date,
): { from: Date; to: Date; error: string | null } {
  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = to ? new Date(`${to}T00:00:00Z`) : day(now);
  const start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 29 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { from: start, to: end, error: 'Dates invalides.' };
  }
  if (start > end) return { from: start, to: end, error: 'La date de début suit la date de fin.' };
  if ((end.getTime() - start.getTime()) / 86_400_000 + 1 > STOCK_REPORT_MAX_DAYS) {
    return { from: start, to: end, error: 'Période limitée à un an.' };
  }
  return { from: start, to: end, error: null };
}

// ─── Recherche globale (S6) ───

export const STOCK_SEARCH_GROUPS = [
  'products',
  'categories',
  'brands',
  'suppliers',
  'customers',
  'sales',
  'orders',
  'sites',
  'locations',
] as const;
export type StockSearchGroup = (typeof STOCK_SEARCH_GROUPS)[number];

export const STOCK_SEARCH_GROUP_LABELS: Record<StockSearchGroup, string> = {
  products: 'Articles',
  categories: 'Catégories',
  brands: 'Marques',
  suppliers: 'Fournisseurs',
  customers: 'Clients',
  sales: 'Ventes',
  orders: 'Commandes fournisseurs',
  sites: 'Magasins et entrepôts',
  locations: 'Emplacements',
};
