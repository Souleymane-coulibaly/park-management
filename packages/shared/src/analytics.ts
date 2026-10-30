import type { Activity } from './business';
import { addDays, localMoment } from './park';

/**
 * Analyses (Sprint 9) : périodes, règles communes et formes des réponses, partagées par l'API,
 * les écrans et les exports — une seule définition des indicateurs.
 *
 * Règles de calcul (voir docs/ANALYSES.md) :
 * - CA encaissé = somme des paiements RÉUSSIS des ventes non annulées, datés à l'encaissement
 *   (un paiement est créé réussi au moment où il est encaissé ; un seul paiement réussi par vente) ;
 * - une vente impayée n'entre jamais dans le CA ; une commande impayée reste une commande ;
 * - visiteurs = scans ACCEPTÉS (au plus un par billet, garanti par la base) ; un scan refusé
 *   n'est jamais une entrée ;
 * - heures et jours en heure locale de CHAQUE établissement.
 */

export const ANALYTICS_PERIODS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'custom',
] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  today: "Aujourd'hui",
  yesterday: 'Hier',
  last_7_days: '7 derniers jours',
  last_30_days: '30 derniers jours',
  this_month: 'Mois en cours',
  custom: 'Période personnalisée',
};

/** Filtre d'activité : toutes, restaurant ou parc. */
export const ANALYTICS_ACTIVITIES = ['ALL', 'RESTAURANT', 'PARK'] as const;
export type AnalyticsActivity = (typeof ANALYTICS_ACTIVITIES)[number];

/** Durée maximale d'une période personnalisée (protège la base des agrégations abusives). */
export const ANALYTICS_MAX_RANGE_DAYS = 366;
/** Nombre maximal de lignes d'un export. */
export const ANALYTICS_EXPORT_MAX_ROWS = 50_000;

/**
 * Intervalle en heure locale « AAAA-MM-JJTHH:MM », borne de fin exclue. Il s'applique à l'heure
 * locale de chaque établissement : 12 h à Bamako et 12 h à Dakar sont toutes deux « 12 h ».
 */
export interface AnalyticsRange {
  from: string;
  to: string;
  label: string;
}

export interface ResolvedAnalyticsPeriod {
  period: AnalyticsPeriod;
  current: AnalyticsRange;
  /** Période précédente de même durée ; pour « Aujourd'hui », hier jusqu'à la même heure. */
  previous: AnalyticsRange;
  /** Jours locaux couverts par la période courante (AAAA-MM-JJ), dans l'ordre. */
  days: string[];
}

export type AnalyticsPeriodError =
  'MISSING_DATES' | 'INVALID_DATE' | 'RANGE_INVERTED' | 'RANGE_TOO_LONG';

export const ANALYTICS_PERIOD_ERRORS: Record<AnalyticsPeriodError, string> = {
  MISSING_DATES: 'Indiquez la date de début et la date de fin.',
  INVALID_DATE: 'Date invalide (format attendu AAAA-MM-JJ).',
  RANGE_INVERTED: 'La date de fin précède la date de début.',
  RANGE_TOO_LONG: `La période ne peut pas dépasser ${ANALYTICS_MAX_RANGE_DAYS} jours.`,
};

const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const isRealDate = (d: string | undefined): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const at = (date: string, minutes = 0) =>
  `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Jours locaux de `from` (inclus) à `to` (exclu). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

function dayRange(from: string, toExclusive: string, label: string): AnalyticsRange {
  return { from: at(from), to: at(toExclusive), label };
}

const spanLabel = (from: string, toExclusive: string) => {
  const last = addDays(toExclusive, -1);
  return from === last ? `le ${frDate(from)}` : `du ${frDate(from)} au ${frDate(last)}`;
};

/**
 * Résout une période d'analyse dans le fuseau de l'organisation. Les dates personnalisées sont
 * des dates locales incluses. Renvoie un code d'erreur plutôt qu'une période approximative.
 */
export function resolveAnalyticsPeriod(
  input: { period: AnalyticsPeriod; from?: string; to?: string },
  now: Date,
  timeZone: string,
): ResolvedAnalyticsPeriod | { error: AnalyticsPeriodError } {
  const local = localMoment(now, timeZone);
  const today = local.date;
  const tomorrow = addDays(today, 1);
  const lastN = (n: number) => {
    const from = addDays(today, -(n - 1));
    return {
      current: dayRange(from, tomorrow, `${n} derniers jours, ${spanLabel(from, tomorrow)}`),
      previous: dayRange(
        addDays(from, -n),
        from,
        `${n} jours précédents, ${spanLabel(addDays(from, -n), from)}`,
      ),
    };
  };

  let ranges: { current: AnalyticsRange; previous: AnalyticsRange };
  switch (input.period) {
    case 'today': {
      const yesterday = addDays(today, -1);
      ranges = {
        current: dayRange(today, tomorrow, `Aujourd'hui (${frDate(today)})`),
        previous: {
          from: at(yesterday),
          to: at(yesterday, local.minutes),
          label: `Hier (${frDate(yesterday)}) jusqu'à ${at(yesterday, local.minutes).slice(11)}`,
        },
      };
      break;
    }
    case 'yesterday': {
      const y = addDays(today, -1);
      const before = addDays(y, -1);
      ranges = {
        current: dayRange(y, today, `Hier (${frDate(y)})`),
        previous: dayRange(before, y, `Avant-hier (${frDate(before)})`),
      };
      break;
    }
    case 'last_7_days':
      ranges = lastN(7);
      break;
    case 'last_30_days':
      ranges = lastN(30);
      break;
    case 'this_month': {
      // Mois en cours jusqu'à aujourd'hui, comparé au même nombre de jours du mois précédent.
      const first = `${today.slice(0, 8)}01`;
      const prevFirst = `${addDays(first, -1).slice(0, 8)}01`;
      const elapsed = daysBetween(first, tomorrow);
      const prevEnd = [addDays(prevFirst, elapsed), first].sort()[0]!;
      ranges = {
        current: dayRange(first, tomorrow, `Mois en cours, ${spanLabel(first, tomorrow)}`),
        previous: dayRange(prevFirst, prevEnd, `Mois précédent, ${spanLabel(prevFirst, prevEnd)}`),
      };
      break;
    }
    case 'custom': {
      if (!input.from || !input.to) return { error: 'MISSING_DATES' };
      if (!isRealDate(input.from) || !isRealDate(input.to)) return { error: 'INVALID_DATE' };
      if (input.to < input.from) return { error: 'RANGE_INVERTED' };
      const end = addDays(input.to, 1);
      const length = daysBetween(input.from, end);
      if (length > ANALYTICS_MAX_RANGE_DAYS) return { error: 'RANGE_TOO_LONG' };
      const prevFrom = addDays(input.from, -length);
      ranges = {
        current: dayRange(input.from, end, spanLabel(input.from, end)),
        previous: dayRange(
          prevFrom,
          input.from,
          `Période précédente, ${spanLabel(prevFrom, input.from)}`,
        ),
      };
      break;
    }
  }
  return {
    period: input.period,
    ...ranges,
    days: daysOf(ranges.current.from.slice(0, 10), ranges.current.to.slice(0, 10)),
  };
}

/** Variation en % par rapport à la période précédente ; null si la base est nulle. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Panier moyen arrondi au franc ; null sans vente encaissée. */
export function averageBasket(revenue: number, paidSales: number): number | null {
  return paidSales > 0 ? Math.round(revenue / paidSales) : null;
}

/** Jours de la semaine ISO : 1 = lundi … 7 = dimanche. */
export const ISO_WEEKDAY_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

/** Nombre d'occurrences de chaque jour ISO (index 0 = lundi) parmi des jours AAAA-MM-JJ. */
export function weekdayOccurrences(days: string[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) counts[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]! += 1;
  return counts;
}

// ─── Marges estimées ───

/** Raison pour laquelle le coût matière d'un article est inconnu. */
export type MarginGap = 'NO_RECIPE' | 'MISSING_COST';

export const MARGIN_GAP_LABELS: Record<MarginGap, string> = {
  NO_RECIPE: 'Aucune recette : coût matière inconnu',
  MISSING_COST: 'Coût d’achat manquant pour un ingrédient',
};

/** Composant de recette avec son coût d'achat unitaire actuel (null = inconnu). */
export interface CostedComponent {
  stockItemName: string;
  quantity: number;
  unitCost: number | null;
}

/**
 * Coût matière d'UNE unité vendue, au coût d'achat ACTUEL des ingrédients. Jamais estimé : sans
 * recette, ou si un seul ingrédient n'a pas de coût, le coût est inconnu et la raison est donnée.
 */
export function unitMaterialCost(
  components: CostedComponent[],
): { cost: number; gap: null; missing: [] } | { cost: null; gap: MarginGap; missing: string[] } {
  if (components.length === 0) return { cost: null, gap: 'NO_RECIPE', missing: [] };
  const missing = components.filter((c) => c.unitCost === null).map((c) => c.stockItemName);
  if (missing.length > 0) return { cost: null, gap: 'MISSING_COST', missing };
  return {
    cost: components.reduce((sum, c) => sum + c.quantity * c.unitCost!, 0),
    gap: null,
    missing: [],
  };
}

/** Taux de marge brute estimée en % du CA ; null sans CA. */
export function marginRate(revenue: number, margin: number): number | null {
  return revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;
}

// ─── Formes des réponses de l'API ───

export interface AnalyticsEstablishmentRef {
  id: string;
  name: string;
  timezone: string;
  activities: Activity[];
}

export interface AnalyticsScopeInfo {
  establishments: AnalyticsEstablishmentRef[];
  activities: Activity[];
  timezone: string;
  canSeeMargins: boolean;
  canExport: boolean;
}

export interface AnalyticsMeta {
  period: { current: AnalyticsRange; previous: AnalyticsRange; days: string[] };
  establishments: { id: string; name: string }[];
  activity: AnalyticsActivity;
  timezone: string;
  currency: 'XOF';
  generatedAt: string;
}

export interface Compared {
  current: number;
  previous: number;
  change: number | null;
}

export interface ActivityTotals {
  revenue: Compared;
  paidSales: Compared;
  averageBasket: { current: number | null; previous: number | null };
}

export interface DailyPoint {
  date: string;
  value: number;
}

export interface AnalyticsOverview {
  meta: AnalyticsMeta;
  revenue: Compared;
  paidSales: Compared;
  averageBasket: { current: number | null; previous: number | null };
  /** Commandes restaurant (payées ou non) ; null sans restaurant dans le périmètre. */
  orders: Compared | null;
  /** Entrées réelles du parc (scans acceptés) ; null sans parc dans le périmètre. */
  visitors: Compared | null;
  byActivity: Partial<Record<Activity, ActivityTotals>>;
  /** CA encaissé par jour local, période courante puis précédente (même nombre de points). */
  daily: { current: DailyPoint[]; previous: DailyPoint[] };
}

export interface ProductSales {
  productId: string | null;
  product: string;
  category: string;
  quantity: number;
  revenue: number;
}

export interface CategorySales {
  category: string;
  quantity: number;
  revenue: number;
}

export interface HourPoint {
  hour: number;
  orders: number;
  quantity: number;
  revenue: number;
}

export interface RestaurantAnalytics {
  meta: AnalyticsMeta;
  totals: ActivityTotals & {
    orders: Compared;
    itemsSold: Compared;
    /** Remises fidélité : CA par produit − remises = CA encaissé. */
    loyaltyDiscount: number;
  };
  products: ProductSales[];
  categories: CategorySales[];
  /** Produits actifs proposés dans le périmètre sans aucune vente encaissée sur la période. */
  unsold: { productId: string; product: string; category: string }[];
  daily: { date: string; revenue: number; orders: number }[];
  hourly: HourPoint[];
  weekdays: { weekday: number; revenue: number; orders: number }[];
}

export interface ProductHourRow {
  productId: string | null;
  product: string;
  category: string;
  hour: number;
  quantity: number;
  revenue: number;
}

export interface RestaurantHourly {
  meta: AnalyticsMeta;
  filters: { hourFrom: number; hourTo: number; weekday: number | null; productId: string | null };
  rows: ProductHourRow[];
  /** Totaux par heure, tous produits retenus confondus. */
  hours: HourPoint[];
}

export interface TicketCategoryStats {
  categoryId: string;
  category: string;
  soldUnits: number;
  paidUnits: number;
  issued: number;
  scanned: number;
  revenue: number;
}

export interface ParkAnalytics {
  meta: AnalyticsMeta;
  totals: ActivityTotals & {
    /** Unités vendues (ventes non annulées, payées ou non). */
    soldUnits: Compared;
    /** Unités des ventes encaissées. */
    paidUnits: Compared;
    /** Billets individuels émis (non annulés). */
    issued: Compared;
    /** Entrées : scans acceptés. */
    scanned: Compared;
    /** Tentatives refusées, par motif : jamais comptées comme entrées. */
    refusedScans: { total: number; byReason: Record<string, number> };
    cancelledTickets: number;
    /** Billets émis sur la période déjà utilisés / billets émis (%) ; null sans billet émis. */
    usageRate: number | null;
  };
  categories: TicketCategoryStats[];
  daily: { date: string; entries: number; revenue: number }[];
  previousDaily: { date: string; entries: number }[];
  hourly: { hour: number; entries: number }[];
  weekdays: { weekday: number; entries: number }[];
}

export const HEATMAP_METRICS = ['orders', 'quantity', 'revenue', 'entries'] as const;
export type HeatmapMetric = (typeof HEATMAP_METRICS)[number];

export const HEATMAP_METRIC_LABELS: Record<HeatmapMetric, string> = {
  orders: 'Commandes restaurant',
  quantity: 'Quantités vendues',
  revenue: 'CA restaurant encaissé',
  entries: 'Entrées du parc (scans acceptés)',
};

export const HEATMAP_METRIC_ACTIVITY: Record<HeatmapMetric, Activity> = {
  orders: 'RESTAURANT',
  quantity: 'RESTAURANT',
  revenue: 'RESTAURANT',
  entries: 'PARK',
};

export interface Heatmap {
  meta: AnalyticsMeta;
  metric: HeatmapMetric;
  /** cells[jour ISO − 1][heure] : total sur la période. */
  cells: number[][];
  /** Occurrences de chaque jour de la semaine dans la période (moyennes). */
  weekdayCount: number[];
  max: number;
}

export interface MarginRow {
  establishmentId: string;
  establishment: string;
  variantId: string;
  product: string;
  variant: string;
  category: string;
  quantity: number;
  revenue: number;
  unitPrice: number | null;
  unitCost: number | null;
  materialCost: number | null;
  margin: number | null;
  marginRate: number | null;
  gap: MarginGap | null;
  missingCosts: string[];
}

export interface CategoryMargin {
  category: string;
  revenue: number;
  /** CA des articles dont le coût est connu. */
  revenueCosted: number;
  materialCost: number;
  margin: number;
  marginRate: number | null;
  /** Vrai si tous les articles vendus de la catégorie ont un coût connu. */
  complete: boolean;
}

export interface CostPoint {
  date: string;
  unitCost: number;
}

export interface CostEvolution {
  stockItemId: string;
  stockItem: string;
  establishment: string;
  unit: string;
  currentUnitCost: number | null;
  points: CostPoint[];
  change: number | null;
}

export interface MarginAnalytics {
  meta: AnalyticsMeta;
  summary: {
    revenue: number;
    revenueCosted: number;
    revenueUncosted: number;
    materialCost: number;
    grossMargin: number;
    marginRate: number | null;
    complete: boolean;
  };
  rows: MarginRow[];
  categories: CategoryMargin[];
  costs: CostEvolution[];
}

export interface EstablishmentComparison {
  establishmentId: string;
  establishment: string;
  activities: Activity[];
  revenue: Compared;
  revenueByActivity: Partial<Record<Activity, number>>;
  paidSales: Compared;
  averageBasket: number | null;
  orders: number | null;
  itemsSold: number | null;
  visitors: number | null;
}

export interface EstablishmentsAnalytics {
  meta: AnalyticsMeta;
  rows: EstablishmentComparison[];
  consolidated: {
    revenue: Compared;
    paidSales: Compared;
    averageBasket: number | null;
    orders: number | null;
    itemsSold: number | null;
    visitors: number | null;
  };
  /** Produits les plus vendus de l'organisation, quantités par établissement. */
  topProducts: { product: string; total: number; byEstablishment: Record<string, number> }[];
}

export const ANALYTICS_EXPORT_REPORTS = [
  'overview',
  'restaurant-products',
  'restaurant-hourly',
  'park',
  'heatmap',
  'margins',
  'establishments',
] as const;
export type AnalyticsExportReport = (typeof ANALYTICS_EXPORT_REPORTS)[number];

export const ANALYTICS_EXPORT_LABELS: Record<AnalyticsExportReport, string> = {
  overview: 'Vue globale',
  'restaurant-products': 'Ventes restaurant par produit',
  'restaurant-hourly': 'Ventes par produit et par heure',
  park: 'Billetterie par catégorie',
  heatmap: 'Carte thermique',
  margins: 'Coûts et marges estimés',
  establishments: 'Comparaison des établissements',
};
