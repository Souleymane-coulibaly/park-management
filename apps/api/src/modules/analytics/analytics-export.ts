import {
  ANALYTICS_EXPORT_LABELS,
  type AnalyticsExportReport,
  type AnalyticsMeta,
  type Compared,
  type EstablishmentsAnalytics,
  HEATMAP_METRIC_LABELS,
  type Heatmap,
  ISO_WEEKDAY_LABELS,
  MARGIN_GAP_LABELS,
  type MarginAnalytics,
  type ParkAnalytics,
  type RestaurantAnalytics,
  type RestaurantHourly,
  type AnalyticsOverview,
} from '@ocall/shared';
import type { CsvValue } from './csv';

/**
 * Rapports exportables. Chacun est construit à partir de la MÊME réponse que l'écran
 * correspondant : mêmes règles de calcul, mêmes autorisations, mêmes chiffres.
 */

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportTable {
  title: string;
  columns: ExportColumn[];
  rows: Record<string, CsvValue>[];
  /** Précisions imprimées en tête du fichier (ex. marges estimées, remises fidélité). */
  notes: string[];
}

const ACTIVITY_LABELS = { ALL: 'Toutes', RESTAURANT: 'Restaurant', PARK: 'Parc' } as const;
const hourLabel = (h: number) =>
  `${String(h).padStart(2, '0')} h – ${String(h + 1).padStart(2, '0')} h`;
const indicator = (label: string, c: Compared | null): Record<string, CsvValue> | null =>
  c && { indicator: label, current: c.current, previous: c.previous, change: c.change };

export type ExportSource =
  | { report: 'overview'; data: AnalyticsOverview }
  | { report: 'restaurant-products'; data: RestaurantAnalytics }
  | { report: 'restaurant-hourly'; data: RestaurantHourly }
  | { report: 'park'; data: ParkAnalytics }
  | { report: 'heatmap'; data: Heatmap }
  | { report: 'margins'; data: MarginAnalytics }
  | { report: 'establishments'; data: EstablishmentsAnalytics };

const COMPARED_COLUMNS: ExportColumn[] = [
  { key: 'indicator', label: 'Indicateur' },
  { key: 'current', label: 'Période' },
  { key: 'previous', label: 'Période précédente' },
  { key: 'change', label: 'Variation (%)' },
];

export function buildExportTable(source: ExportSource): ExportTable {
  const title = ANALYTICS_EXPORT_LABELS[source.report];
  switch (source.report) {
    case 'overview': {
      const d = source.data;
      const rows = [
        indicator('CA encaissé (FCFA)', d.revenue),
        indicator('Transactions payées', d.paidSales),
        {
          indicator: 'Panier moyen (FCFA)',
          current: d.averageBasket.current,
          previous: d.averageBasket.previous,
          change: null,
        },
        indicator('Commandes restaurant', d.orders),
        indicator('Visiteurs entrés (scans acceptés)', d.visitors),
        indicator('CA Restaurant (FCFA)', d.byActivity.RESTAURANT?.revenue ?? null),
        indicator('CA Parc (FCFA)', d.byActivity.PARK?.revenue ?? null),
      ].filter((r): r is Record<string, CsvValue> => r !== null);
      return { title, columns: COMPARED_COLUMNS, rows, notes: [] };
    }
    case 'restaurant-products': {
      const d = source.data;
      const total = d.products.reduce((s, p) => s + p.revenue, 0);
      return {
        title,
        columns: [
          { key: 'product', label: 'Produit' },
          { key: 'category', label: 'Catégorie' },
          { key: 'quantity', label: 'Quantité vendue' },
          { key: 'revenue', label: 'CA (FCFA)' },
          { key: 'share', label: 'Part du CA (%)' },
        ],
        rows: d.products.map((p) => ({
          product: p.product,
          category: p.category,
          quantity: p.quantity,
          revenue: p.revenue,
          share: total > 0 ? Math.round((p.revenue / total) * 1000) / 10 : null,
        })),
        notes: [
          `CA par produit au prix des lignes, avant remises fidélité (${d.totals.loyaltyDiscount} FCFA sur la période) ; CA encaissé : ${d.totals.revenue.current} FCFA.`,
        ],
      };
    }
    case 'restaurant-hourly': {
      const d = source.data;
      return {
        title,
        columns: [
          { key: 'hour', label: 'Heure locale' },
          { key: 'product', label: 'Produit' },
          { key: 'category', label: 'Catégorie' },
          { key: 'quantity', label: 'Quantité vendue' },
          { key: 'revenue', label: 'CA (FCFA)' },
        ],
        rows: d.rows.map((r) => ({
          hour: hourLabel(r.hour),
          product: r.product,
          category: r.category,
          quantity: r.quantity,
          revenue: r.revenue,
        })),
        notes: [
          `Heures ${d.filters.hourFrom} h – ${d.filters.hourTo} h${d.filters.weekday ? `, ${ISO_WEEKDAY_LABELS[d.filters.weekday - 1]} uniquement` : ''} ; heure d'encaissement.`,
        ],
      };
    }
    case 'park': {
      const d = source.data;
      return {
        title,
        columns: [
          { key: 'category', label: 'Catégorie de billet' },
          { key: 'soldUnits', label: 'Vendus (unités)' },
          { key: 'paidUnits', label: 'Payés (unités)' },
          { key: 'issued', label: 'Billets émis' },
          { key: 'scanned', label: 'Billets scannés (entrées)' },
          { key: 'revenue', label: 'Recettes (FCFA)' },
        ],
        rows: d.categories.map((c) => ({ ...c })),
        notes: [
          `Scans refusés sur la période : ${d.totals.refusedScans.total} (jamais comptés comme entrées).`,
          'Une formule famille compte pour une unité vendue et émet un billet par personne.',
        ],
      };
    }
    case 'heatmap': {
      const d = source.data;
      return {
        title: `${title} — ${HEATMAP_METRIC_LABELS[d.metric]}`,
        columns: [
          { key: 'weekday', label: 'Jour' },
          { key: 'days', label: 'Jours dans la période' },
          ...Array.from({ length: 24 }, (_, h) => ({ key: `h${h}`, label: hourLabel(h) })),
        ],
        rows: d.cells.map((hours, i) => ({
          weekday: ISO_WEEKDAY_LABELS[i],
          days: d.weekdayCount[i],
          ...Object.fromEntries(hours.map((v, h) => [`h${h}`, v])),
        })),
        notes: ['Totaux sur la période, par jour de la semaine et heure locale.'],
      };
    }
    case 'margins': {
      const d = source.data;
      return {
        title,
        columns: [
          { key: 'establishment', label: 'Établissement' },
          { key: 'product', label: 'Produit' },
          { key: 'variant', label: 'Variante' },
          { key: 'category', label: 'Catégorie' },
          { key: 'quantity', label: 'Quantité vendue' },
          { key: 'revenue', label: 'CA (FCFA)' },
          { key: 'unitCost', label: 'Coût matière unitaire estimé (FCFA)' },
          { key: 'materialCost', label: 'Coût matière estimé (FCFA)' },
          { key: 'margin', label: 'Marge brute estimée (FCFA)' },
          { key: 'marginRate', label: 'Taux de marge (%)' },
          { key: 'status', label: 'Statut du coût' },
        ],
        rows: d.rows.map((r) => ({
          establishment: r.establishment,
          product: r.product,
          variant: r.variant,
          category: r.category,
          quantity: r.quantity,
          revenue: r.revenue,
          unitCost: r.unitCost,
          materialCost: r.materialCost,
          margin: r.margin,
          marginRate: r.marginRate,
          status: r.gap
            ? `${MARGIN_GAP_LABELS[r.gap]}${r.missingCosts.length ? ` (${r.missingCosts.join(', ')})` : ''}`
            : 'Coût connu',
        })),
        notes: [
          'Marge brute ESTIMÉE = CA − coût matière au coût d’achat actuel des ingrédients. Ce n’est pas un bénéfice net : personnel, loyer, énergie, taxes et autres charges ne sont pas intégrés.',
          d.summary.complete
            ? 'Coûts connus pour tous les articles vendus.'
            : `Marge INCOMPLÈTE : ${d.summary.revenueUncosted} FCFA de CA sans coût matière connu.`,
        ],
      };
    }
    case 'establishments': {
      const d = source.data;
      return {
        title,
        columns: [
          { key: 'establishment', label: 'Établissement' },
          { key: 'revenue', label: 'CA encaissé (FCFA)' },
          { key: 'previousRevenue', label: 'CA période précédente (FCFA)' },
          { key: 'change', label: 'Variation (%)' },
          { key: 'paidSales', label: 'Transactions payées' },
          { key: 'averageBasket', label: 'Panier moyen (FCFA)' },
          { key: 'orders', label: 'Commandes restaurant' },
          { key: 'itemsSold', label: 'Articles vendus' },
          { key: 'visitors', label: 'Visiteurs entrés' },
        ],
        rows: [
          ...d.rows.map((r) => ({
            establishment: r.establishment,
            revenue: r.revenue.current,
            previousRevenue: r.revenue.previous,
            change: r.revenue.change,
            paidSales: r.paidSales.current,
            averageBasket: r.averageBasket,
            orders: r.orders,
            itemsSold: r.itemsSold,
            visitors: r.visitors,
          })),
          {
            establishment: 'Total organisation',
            revenue: d.consolidated.revenue.current,
            previousRevenue: d.consolidated.revenue.previous,
            change: d.consolidated.revenue.change,
            paidSales: d.consolidated.paidSales.current,
            averageBasket: d.consolidated.averageBasket,
            orders: d.consolidated.orders,
            itemsSold: d.consolidated.itemsSold,
            visitors: d.consolidated.visitors,
          },
        ],
        notes: [],
      };
    }
  }
}

/** Ne conserve que les colonnes demandées (clés connues) ; null si une clé est inconnue. */
export function selectColumns(table: ExportTable, keys: string[] | null): ExportTable | null {
  if (!keys) return table;
  const columns = table.columns.filter((c) => keys.includes(c.key));
  if (columns.length !== new Set(keys).size) return null;
  return { ...table, columns };
}

/** Lignes du fichier : en-tête (période, périmètre, fuseau, devise, date), puis le tableau. */
export function exportRows(
  table: ExportTable,
  meta: AnalyticsMeta,
  report: AnalyticsExportReport,
): CsvValue[][] {
  return [
    ['Ocall Park', table.title],
    ['Rapport', report],
    ['Période', meta.period.current.label],
    ['Comparée à', meta.period.previous.label],
    ['Établissement(s)', meta.establishments.map((e) => e.name).join(', ') || 'Aucun'],
    ['Activité', ACTIVITY_LABELS[meta.activity]],
    ['Fuseau horaire', `${meta.timezone} (heures locales de chaque établissement)`],
    ['Devise', 'FCFA (XOF), montants TTC'],
    ['Généré le', meta.generatedAt],
    ...table.notes.map((n) => ['Note', n]),
    [],
    table.columns.map((c) => c.label),
    ...table.rows.map((r) => table.columns.map((c) => r[c.key])),
  ];
}
