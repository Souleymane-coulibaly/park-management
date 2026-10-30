import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  type Activity,
  type ActivityTotals,
  type AnalyticsRange,
  type CategoryMargin,
  type CategorySales,
  type Compared,
  type CostEvolution,
  type EstablishmentsAnalytics,
  HEATMAP_METRIC_ACTIVITY,
  type Heatmap,
  type HeatmapMetric,
  type HourPoint,
  type MarginAnalytics,
  type MarginRow,
  type ParkAnalytics,
  type RestaurantAnalytics,
  type RestaurantHourly,
  type AnalyticsOverview,
  averageBasket,
  daysOf,
  marginRate,
  percentChange,
  unitMaterialCost,
  weekdayOccurrences,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { type AnalyticsScope, metaOf } from './analytics-scope';
import {
  type CountRow,
  type GridRow,
  type LineFilters,
  type PaymentTotalsRow,
  type SimpleGridRow,
  costMovements,
  entryCounts,
  entryGrid,
  hourTotals,
  isEmptyScope,
  orderCounts,
  orderGrid,
  paymentGrid,
  paymentTotals,
  productLines,
  refusedScans,
  ticketCategories,
  variantSales,
} from './analytics-queries';

/** Durée maximale d'une requête d'analyse : protège la base (et donc la caisse) des abus. */
export const ANALYTICS_STATEMENT_TIMEOUT_MS = 10_000;

const compared = (current: number, previous: number): Compared => ({
  current,
  previous,
  change: percentChange(current, previous),
});
const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);
const isoWeekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function activityTotals(rows: PaymentTotalsRow[]): ActivityTotals {
  const revenue = sum(rows, (r) => r.revenue);
  const prevRevenue = sum(rows, (r) => r.prevRevenue);
  const sales = sum(rows, (r) => r.sales);
  const prevSales = sum(rows, (r) => r.prevSales);
  return {
    revenue: compared(revenue, prevRevenue),
    paidSales: compared(sales, prevSales),
    averageBasket: {
      current: averageBasket(revenue, sales),
      previous: averageBasket(prevRevenue, prevSales),
    },
  };
}

const countTotal = (rows: CountRow[]) =>
  compared(
    sum(rows, (r) => r.current),
    sum(rows, (r) => r.previous),
  );

/** Jours locaux d'un intervalle (la borne de fin, exclue, peut tomber en cours de journée). */
function rangeDays(range: AnalyticsRange): string[] {
  const end = range.to.slice(11) === '00:00' ? range.to.slice(0, 10) : nextDay(range.to);
  return daysOf(range.from.slice(0, 10), end);
}
const nextDay = (ts: string) => {
  const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Analyses (Sprint 9) : composition des indicateurs à partir des primitives SQL. Aucune écriture :
 * chaque analyse s'exécute dans une transaction en LECTURE SEULE, bornée dans le temps.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transaction en lecture seule (toute écriture serait refusée par PostgreSQL) avec une durée
   * maximale par requête. Un dépassement renvoie une erreur explicite plutôt qu'une attente.
   */
  async readOnly<T>(fn: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          await tx.$executeRawUnsafe(
            `SET LOCAL statement_timeout = ${ANALYTICS_STATEMENT_TIMEOUT_MS}`,
          );
          return fn(tx);
        },
        { maxWait: 5_000, timeout: ANALYTICS_STATEMENT_TIMEOUT_MS * 3 },
      );
    } catch (error) {
      if (/statement timeout|57014/i.test(String((error as Error)?.message ?? error))) {
        throw new ServiceUnavailableException({
          code: 'ANALYTICS_TIMEOUT',
          message: 'Analyse trop longue : réduisez la période ou choisissez un établissement.',
        });
      }
      throw error;
    }
  }

  async overview(scope: AnalyticsScope): Promise<AnalyticsOverview> {
    return this.readOnly(async (db) => {
      const totals = await paymentTotals(db, scope, scope.activities);
      const orders = scope.activities.includes('RESTAURANT') ? await orderCounts(db, scope) : null;
      const entries = scope.activities.includes('PARK') ? await entryCounts(db, scope) : null;
      const curGrid = await paymentGrid(db, scope, scope.activities, scope.period.current);
      const prevGrid = await paymentGrid(db, scope, scope.activities, scope.period.previous);
      const all = activityTotals(totals);
      const byActivity: AnalyticsOverview['byActivity'] = {};
      for (const a of scope.activities) {
        byActivity[a] = activityTotals(totals.filter((r) => r.activity === a));
      }
      const dailyOf = (grid: GridRow[], days: string[]) =>
        days.map((date) => ({
          date,
          value: sum(
            grid.filter((g) => g.day === date),
            (g) => g.revenue,
          ),
        }));
      return {
        meta: metaOf(scope),
        revenue: all.revenue,
        paidSales: all.paidSales,
        averageBasket: all.averageBasket,
        orders: orders ? countTotal(orders) : null,
        visitors: entries ? countTotal(entries) : null,
        byActivity,
        daily: {
          current: dailyOf(curGrid, scope.period.days),
          previous: dailyOf(prevGrid, rangeDays(scope.period.previous)),
        },
      };
    });
  }

  async restaurant(scope: AnalyticsScope): Promise<RestaurantAnalytics> {
    return this.readOnly(async (db) => {
      const totals = await paymentTotals(db, scope, ['RESTAURANT']);
      const orders = await orderCounts(db, scope);
      const products = await productLines(db, scope, 'product');
      const grid = await paymentGrid(db, scope, ['RESTAURANT'], scope.period.current);
      const ordersGrid = await orderGrid(db, scope, scope.period.current);
      const unsold = isEmptyScope(scope, ['RESTAURANT'])
        ? []
        : await db.product.findMany({
            where: {
              organizationId: scope.organizationId,
              isActive: true,
              id: { notIn: products.flatMap((p) => (p.productId ? [p.productId] : [])) },
              variants: {
                some: {
                  isActive: true,
                  prices: { some: { establishmentId: { in: scope.establishmentIds } } },
                },
              },
            },
            select: { id: true, name: true, category: { select: { name: true } } },
            orderBy: { name: 'asc' },
          });

      const categories = new Map<string, CategorySales>();
      for (const p of products) {
        const c = categories.get(p.category) ?? { category: p.category, quantity: 0, revenue: 0 };
        c.quantity += p.quantity;
        c.revenue += p.revenue;
        categories.set(p.category, c);
      }
      const base = activityTotals(totals);
      return {
        meta: metaOf(scope),
        totals: {
          ...base,
          orders: countTotal(orders),
          itemsSold: compared(
            sum(totals, (r) => r.quantity),
            sum(totals, (r) => r.prevQuantity),
          ),
          loyaltyDiscount: sum(totals, (r) => r.loyalty),
        },
        products: products.map((p) => ({
          productId: p.productId,
          product: p.product,
          category: p.category,
          quantity: p.quantity,
          revenue: p.revenue,
        })),
        categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
        unsold: unsold.map((p) => ({
          productId: p.id,
          product: p.name,
          category: p.category.name,
        })),
        daily: scope.period.days.map((date) => ({
          date,
          revenue: sum(
            grid.filter((g) => g.day === date),
            (g) => g.revenue,
          ),
          orders: sum(
            ordersGrid.filter((g) => g.day === date),
            (g) => g.count,
          ),
        })),
        hourly: HOURS.map((hour) => ({
          hour,
          orders: sum(
            ordersGrid.filter((g) => g.hour === hour),
            (g) => g.count,
          ),
          quantity: sum(
            grid.filter((g) => g.hour === hour),
            (g) => g.quantity,
          ),
          revenue: sum(
            grid.filter((g) => g.hour === hour),
            (g) => g.revenue,
          ),
        })),
        weekdays: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          revenue: sum(
            grid.filter((g) => isoWeekday(g.day) === weekday),
            (g) => g.revenue,
          ),
          orders: sum(
            ordersGrid.filter((g) => isoWeekday(g.day) === weekday),
            (g) => g.count,
          ),
        })),
      };
    });
  }

  async restaurantHourly(
    scope: AnalyticsScope,
    filters: Required<Pick<LineFilters, 'hourFrom' | 'hourTo'>> & {
      weekday: number | null;
      productId: string | null;
    },
  ): Promise<RestaurantHourly> {
    return this.readOnly(async (db) => {
      const rows = await productLines(db, scope, 'hour', filters);
      const totals = await hourTotals(db, scope, filters);
      const hours: HourPoint[] = HOURS.filter(
        (h) => h >= filters.hourFrom && h < filters.hourTo,
      ).map((hour) => {
        const t = totals.find((x) => x.hour === hour);
        return {
          hour,
          orders: t?.orders ?? 0,
          quantity: t?.quantity ?? 0,
          revenue: t?.revenue ?? 0,
        };
      });
      return {
        meta: metaOf(scope),
        filters,
        rows: rows
          .map((r) => ({
            productId: r.productId,
            product: r.product,
            category: r.category,
            hour: r.hour ?? 0,
            quantity: r.quantity,
            revenue: r.revenue,
          }))
          .sort((a, b) => a.hour - b.hour || b.revenue - a.revenue),
        hours,
      };
    });
  }

  async park(scope: AnalyticsScope): Promise<ParkAnalytics> {
    return this.readOnly(async (db) => {
      const totals = await paymentTotals(db, scope, ['PARK']);
      const categories = await ticketCategories(db, scope);
      const entries = await entryCounts(db, scope);
      const refused = await refusedScans(db, scope);
      const curEntries = await entryGrid(db, scope, scope.period.current);
      const prevEntries = await entryGrid(db, scope, scope.period.previous);
      const revenueGrid = await paymentGrid(db, scope, ['PARK'], scope.period.current);

      const issued = sum(categories, (c) => c.issued);
      const used = sum(categories, (c) => c.used);
      const byDay = (grid: SimpleGridRow[], day: string) =>
        sum(
          grid.filter((g) => g.day === day),
          (g) => g.count,
        );
      return {
        meta: metaOf(scope),
        totals: {
          ...activityTotals(totals),
          soldUnits: compared(
            sum(categories, (c) => c.soldUnits),
            sum(categories, (c) => c.prevSoldUnits),
          ),
          paidUnits: compared(
            sum(totals, (r) => r.quantity),
            sum(totals, (r) => r.prevQuantity),
          ),
          issued: compared(
            issued,
            sum(categories, (c) => c.prevIssued),
          ),
          scanned: countTotal(entries),
          refusedScans: { total: sum(Object.values(refused), (n) => n), byReason: refused },
          cancelledTickets: sum(categories, (c) => c.cancelled),
          usageRate: issued > 0 ? Math.round((used / issued) * 1000) / 10 : null,
        },
        categories: categories.map((c) => ({
          categoryId: c.categoryId,
          category: c.category,
          soldUnits: c.soldUnits,
          paidUnits: c.paidUnits,
          issued: c.issued,
          scanned: c.scanned,
          revenue: c.revenue,
        })),
        daily: scope.period.days.map((date) => ({
          date,
          entries: byDay(curEntries, date),
          revenue: sum(
            revenueGrid.filter((g) => g.day === date),
            (g) => g.revenue,
          ),
        })),
        previousDaily: rangeDays(scope.period.previous).map((date) => ({
          date,
          entries: byDay(prevEntries, date),
        })),
        hourly: HOURS.map((hour) => ({
          hour,
          entries: sum(
            curEntries.filter((g) => g.hour === hour),
            (g) => g.count,
          ),
        })),
        weekdays: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          entries: sum(
            curEntries.filter((g) => isoWeekday(g.day) === weekday),
            (g) => g.count,
          ),
        })),
      };
    });
  }

  /**
   * Carte thermique jour × heure. Les commandes et les entrées physiques ne sont jamais mélangées :
   * chaque métrique a sa propre source et sa propre activité.
   */
  async heatmap(scope: AnalyticsScope, metric: HeatmapMetric): Promise<Heatmap> {
    const activity = HEATMAP_METRIC_ACTIVITY[metric];
    return this.readOnly(async (db) => {
      const range = scope.period.current;
      const cells = [1, 2, 3, 4, 5, 6, 7].map(() => HOURS.map(() => 0));
      const add = (day: string, hour: number, value: number) => {
        cells[isoWeekday(day) - 1]![hour]! += value;
      };
      if (scope.activities.includes(activity)) {
        if (metric === 'orders') {
          for (const g of await orderGrid(db, scope, range)) add(g.day, g.hour, g.count);
        } else if (metric === 'entries') {
          for (const g of await entryGrid(db, scope, range)) add(g.day, g.hour, g.count);
        } else {
          for (const g of await paymentGrid(db, scope, ['RESTAURANT'], range)) {
            add(g.day, g.hour, metric === 'revenue' ? g.revenue : g.quantity);
          }
        }
      }
      return {
        meta: metaOf(scope),
        metric,
        cells,
        weekdayCount: weekdayOccurrences(scope.period.days),
        max: Math.max(0, ...cells.flat()),
      };
    });
  }

  /**
   * Coûts matière et marges ESTIMÉS : coût d'achat ACTUEL des ingrédients de la recette de
   * l'établissement de vente. Sans recette ou avec un coût manquant, la marge est déclarée
   * incomplète, jamais estimée. Ce n'est pas un bénéfice : charges et taxes non intégrées.
   */
  async margins(scope: AnalyticsScope): Promise<MarginAnalytics> {
    return this.readOnly(async (db) => {
      const sold = await variantSales(db, scope);
      const components = sold.length
        ? await db.recipeComponent.findMany({
            where: {
              organizationId: scope.organizationId,
              variantId: { in: [...new Set(sold.map((s) => s.variantId))] },
              stockItem: { establishmentId: { in: scope.establishmentIds }, isActive: true },
            },
            select: {
              variantId: true,
              quantity: true,
              stockItem: { select: { establishmentId: true, name: true, unitCost: true } },
            },
          })
        : [];
      const moves = await costMovements(db, scope);

      const rows: MarginRow[] = sold.map((s) => {
        const unit = unitMaterialCost(
          components
            .filter(
              (c) =>
                c.variantId === s.variantId && c.stockItem.establishmentId === s.establishmentId,
            )
            .map((c) => ({
              stockItemName: c.stockItem.name,
              quantity: Number(c.quantity),
              unitCost: c.stockItem.unitCost,
            })),
        );
        const materialCost = unit.cost === null ? null : Math.round(unit.cost * s.quantity);
        const margin = materialCost === null ? null : s.revenue - materialCost;
        return {
          ...s,
          unitPrice: s.quantity > 0 ? Math.round(s.revenue / s.quantity) : null,
          unitCost: unit.cost === null ? null : Math.round(unit.cost),
          materialCost,
          margin,
          marginRate: margin === null ? null : marginRate(s.revenue, margin),
          gap: unit.gap,
          missingCosts: unit.missing,
        };
      });

      const categories = new Map<string, CategoryMargin>();
      for (const r of rows) {
        const c = categories.get(r.category) ?? {
          category: r.category,
          revenue: 0,
          revenueCosted: 0,
          materialCost: 0,
          margin: 0,
          marginRate: null,
          complete: true,
        };
        c.revenue += r.revenue;
        if (r.materialCost === null) {
          c.complete = false;
        } else {
          c.revenueCosted += r.revenue;
          c.materialCost += r.materialCost;
          c.margin += r.revenue - r.materialCost;
        }
        categories.set(r.category, c);
      }
      for (const c of categories.values()) c.marginRate = marginRate(c.revenueCosted, c.margin);

      const costs = new Map<string, CostEvolution>();
      for (const m of moves) {
        const c = costs.get(m.stockItemId) ?? {
          stockItemId: m.stockItemId,
          stockItem: m.stockItem,
          establishment: m.establishment,
          unit: m.unit,
          currentUnitCost: m.currentUnitCost,
          points: [],
          change: null,
        };
        c.points.push({ date: m.day, unitCost: m.unitCost });
        costs.set(m.stockItemId, c);
      }
      for (const c of costs.values()) {
        c.change = percentChange(c.points.at(-1)!.unitCost, c.points[0]!.unitCost);
      }

      const costed = rows.filter((r) => r.materialCost !== null);
      const revenue = sum(rows, (r) => r.revenue);
      const revenueCosted = sum(costed, (r) => r.revenue);
      const materialCost = sum(costed, (r) => r.materialCost!);
      return {
        meta: metaOf(scope),
        summary: {
          revenue,
          revenueCosted,
          revenueUncosted: revenue - revenueCosted,
          materialCost,
          grossMargin: revenueCosted - materialCost,
          marginRate: marginRate(revenueCosted, revenueCosted - materialCost),
          complete: costed.length === rows.length,
        },
        rows,
        categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
        costs: [...costs.values()],
      };
    });
  }

  /** Comparaison des établissements du périmètre et consolidation de l'organisation. */
  async establishments(scope: AnalyticsScope): Promise<EstablishmentsAnalytics> {
    return this.readOnly(async (db) => {
      const totals = await paymentTotals(db, scope, scope.activities);
      const hasRestaurant = scope.activities.includes('RESTAURANT');
      const hasPark = scope.activities.includes('PARK');
      const orders = hasRestaurant ? await orderCounts(db, scope) : [];
      const entries = hasPark ? await entryCounts(db, scope) : [];
      const lines = hasRestaurant ? await productLines(db, scope, 'establishment') : [];

      const rows = scope.establishments.map((e) => {
        const t = totals.filter((r) => r.establishmentId === e.id);
        const covers = (a: Activity) => e.activities.includes(a) && scope.activities.includes(a);
        const revenue = sum(t, (r) => r.revenue);
        const sales = sum(t, (r) => r.sales);
        const revenueByActivity: Partial<Record<Activity, number>> = {};
        for (const a of scope.activities.filter(covers)) {
          revenueByActivity[a] = sum(
            t.filter((r) => r.activity === a),
            (r) => r.revenue,
          );
        }
        return {
          establishmentId: e.id,
          establishment: e.name,
          activities: e.activities,
          revenue: compared(
            revenue,
            sum(t, (r) => r.prevRevenue),
          ),
          revenueByActivity,
          paidSales: compared(
            sales,
            sum(t, (r) => r.prevSales),
          ),
          averageBasket: averageBasket(revenue, sales),
          orders: covers('RESTAURANT')
            ? (orders.find((o) => o.establishmentId === e.id)?.current ?? 0)
            : null,
          itemsSold: covers('RESTAURANT')
            ? sum(
                t.filter((r) => r.activity === 'RESTAURANT'),
                (r) => r.quantity,
              )
            : null,
          visitors: covers('PARK')
            ? (entries.find((o) => o.establishmentId === e.id)?.current ?? 0)
            : null,
        };
      });

      const products = new Map<
        string,
        { total: number; byEstablishment: Record<string, number> }
      >();
      for (const l of lines) {
        const p = products.get(l.product) ?? { total: 0, byEstablishment: {} };
        p.total += l.quantity;
        p.byEstablishment[l.establishmentId!] =
          (p.byEstablishment[l.establishmentId!] ?? 0) + l.quantity;
        products.set(l.product, p);
      }
      const all = activityTotals(totals);
      return {
        meta: metaOf(scope),
        rows,
        consolidated: {
          revenue: all.revenue,
          paidSales: all.paidSales,
          averageBasket: all.averageBasket.current,
          orders: hasRestaurant ? sum(orders, (o) => o.current) : null,
          itemsSold: hasRestaurant
            ? sum(
                totals.filter((r) => r.activity === 'RESTAURANT'),
                (r) => r.quantity,
              )
            : null,
          visitors: hasPark ? sum(entries, (o) => o.current) : null,
        },
        topProducts: [...products.entries()]
          .map(([product, p]) => ({ product, ...p }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10),
      };
    });
  }
}
