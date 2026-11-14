import { detectBarcodeType, isValidGtin } from './stock-barcodes';
/**
 * Ocall Stock — S8 : IA sur Ocall AI Core. Règles partagées par l'API et l'écran.
 *
 * L'IA propose, une personne décide. Elle ne modifie jamais une quantité, ne passe jamais une commande, ne
 * change jamais un prix, ne voit jamais une autre organisation et n'invente aucun chiffre : TOUS les
 * chiffres (quantités suggérées, jours de couverture) sont calculés ici, par le serveur ; l'IA explique et
 * classe, et ses textes sont contrôlés (aucun nombre absent des données fournies).
 */

export const STOCK_AI_FEATURES = [
  'STOCK_RESTOCK',
  'STOCK_STOCKOUT',
  'STOCK_ANALYSIS',
  'STOCK_PRODUCT_PHOTO',
  'STOCK_ILLUSTRATION',
] as const;
export type StockAiFeature = (typeof STOCK_AI_FEATURES)[number];

export const STOCK_AI_FEATURE_LABELS: Record<StockAiFeature, string> = {
  STOCK_RESTOCK: 'Assistant de réapprovisionnement',
  STOCK_STOCKOUT: 'Prévision des ruptures',
  STOCK_ANALYSIS: 'Analyse commerciale',
  STOCK_PRODUCT_PHOTO: 'Fiche article depuis une photo',
  STOCK_ILLUSTRATION: 'Illustration générée par IA',
};

/** Plafonds mensuels proposés par fonctionnalité (le gérant les règle, sous le plafond Ocall). */
export const STOCK_AI_DEFAULT_LIMITS: Record<StockAiFeature, number> = {
  STOCK_RESTOCK: 50,
  STOCK_STOCKOUT: 50,
  STOCK_ANALYSIS: 30,
  STOCK_PRODUCT_PHOTO: 100,
  STOCK_ILLUSTRATION: 20,
};

/** Mention imposée sur toute illustration générée (jamais présentée comme une photo réelle). */
export const STOCK_AI_ILLUSTRATION_LABEL = 'Illustration générée par IA';
/** Mention d'un code-barres lu sur une photo. */
export const STOCK_AI_BARCODE_LABEL = 'Lu sur la photo, à vérifier';

/** Fenêtres d'historique des sorties (jours). */
export const STOCK_AI_LONG_WINDOW = 90;
export const STOCK_AI_SHORT_WINDOW = 30;
/** Couverture visée par une commande, au-delà du délai fournisseur (jours). */
export const STOCK_AI_DEFAULT_COVER_DAYS = 14;
/** Délai fournisseur supposé quand il n'est pas renseigné (signalé à l'écran). */
export const STOCK_AI_DEFAULT_LEAD_DAYS = 7;
/** Lignes au plus par suggestion ou prévision. */
export const STOCK_AI_MAX_LINES = 30;

/** Unités qui se commandent en quantités décimales ; les autres s'arrondissent à l'unité supérieure. */
const DECIMAL_UNITS = new Set([
  'kg',
  'g',
  'l',
  'litre',
  'litres',
  'ml',
  'm',
  'm2',
  'm²',
  'm3',
  'm³',
  'tonne',
]);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Moyenne journalière des sorties sur une fenêtre (jours). */
export function stockDailyRate(outflow: number, windowDays: number): number {
  return windowDays > 0 && outflow > 0 ? outflow / windowDays : 0;
}

/**
 * Quantité à commander : sorties prévues pendant le délai fournisseur et la couverture visée, plus le seuil
 * d'alerte, moins le disponible et ce qui est déjà commandé. Jamais négative ; arrondie à l'unité
 * supérieure (au millième pour les unités au poids, au volume ou à la longueur).
 */
export function stockRestockQuantity(input: {
  dailyRate: number;
  leadTimeDays: number;
  coverDays: number;
  minStock: number | null;
  available: number;
  incoming: number;
  unit: string;
}): number {
  const need =
    input.dailyRate * (input.leadTimeDays + input.coverDays) +
    (input.minStock ?? 0) -
    input.available -
    input.incoming;
  if (need <= 0.0005) return 0;
  return DECIMAL_UNITS.has(input.unit.trim().toLowerCase())
    ? Math.ceil(round3(need) * 1000 - 1e-9) / 1000
    : Math.ceil(round3(need) - 1e-9);
}

export type StockStockoutRisk = 'HIGH' | 'MEDIUM';

export const STOCK_STOCKOUT_RISK_LABELS: Record<StockStockoutRisk, string> = {
  HIGH: 'Rupture probable avant un réapprovisionnement',
  MEDIUM: 'À surveiller',
};

/**
 * Estimation PRUDENTE d'une rupture : fourchette de jours avant épuisement du disponible, au rythme le plus
 * rapide et au plus lent des deux fenêtres (30 et 90 jours). Aucune garantie : une estimation, jamais une
 * date. Risque élevé si l'épuisement le plus rapide survient avant le délai fournisseur ; à surveiller s'il
 * survient avant ce délai plus 14 jours. Null : aucune sortie, aucun risque calculable.
 */
export function stockStockoutEstimate(input: {
  available: number;
  shortRate: number;
  longRate: number;
  leadTimeDays: number;
}): { daysMin: number; daysMax: number; risk: StockStockoutRisk | null } | null {
  const rates = [input.shortRate, input.longRate].filter((r) => r > 0);
  if (rates.length === 0) return null;
  const available = Math.max(0, input.available);
  const daysMin = Math.floor(available / Math.max(...rates));
  const daysMax = Math.floor(available / Math.min(...rates));
  const risk: StockStockoutRisk | null =
    daysMin <= input.leadTimeDays ? 'HIGH' : daysMin <= input.leadTimeDays + 14 ? 'MEDIUM' : null;
  return { daysMin, daysMax, risk };
}

/** Priorité d'une ligne de réapprovisionnement, choisie par l'IA parmi une liste fermée. */
export const STOCK_RESTOCK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type StockRestockPriority = (typeof STOCK_RESTOCK_PRIORITIES)[number];
export const STOCK_RESTOCK_PRIORITY_LABELS: Record<StockRestockPriority, string> = {
  HIGH: 'Urgent',
  MEDIUM: 'Bientôt',
  LOW: 'Peut attendre',
};

/**
 * Code-barres lu sur une photo : gardé seulement s'il s'agit d'un EAN-13, EAN-8 ou UPC-A dont la clé de
 * contrôle est juste (jamais inventé, jamais « corrigé ») ; sinon null.
 */
export function stockAiPhotoBarcode(raw: string): string | null {
  const code = raw.replace(/\D/g, '');
  const type = detectBarcodeType(code);
  if (!type || type === 'INTERNAL') return null;
  return isValidGtin(type, code) ? code : null;
}
