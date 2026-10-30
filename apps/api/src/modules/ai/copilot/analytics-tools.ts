import type { Prisma } from '@ocall/database';
import {
  type Activity,
  COPILOT_PERIODS,
  type CopilotPeriod,
  type Permission,
  type ResolvedPeriod,
  addDays,
  matchProductName,
  resolveAnalyticsPeriod,
  resolveCopilotPeriod,
  zonedMidnight,
} from '@ocall/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AnalyticsScope } from '../../analytics/analytics-scope';
import type { AnalyticsService } from '../../analytics/analytics.service';
import type { JsonSchema } from '../providers/ai-provider';

/**
 * Registre FERMÉ des fonctions analytiques du copilote : uniquement des lectures, calculées par le
 * serveur. Le modèle ne choisit qu'une fonction de cette liste et des paramètres bornés (période,
 * nombre de lignes) ; il ne fournit jamais l'établissement, ni SQL, ni commande. Les périodes sont
 * calculées dans le fuseau de l'établissement.
 *
 * Sprint 9B : les analyses avancées (produit × heure, CA par produit, heures de pointe, jour le plus
 * fréquenté, marges par catégorie) réutilisent le service d'analyses du Sprint 9 — mêmes règles de
 * calcul que les écrans, transaction en lecture seule.
 */

export interface AnalyticsContext {
  prisma: PrismaService;
  organizationId: string;
  establishment: { id: string; name: string; timezone: string };
  now: Date;
  /** Analyses du Sprint 9 (lecture seule). */
  analytics: AnalyticsService;
}

export interface AnalyticsResult {
  tool: string;
  title: string;
  /** Période analysée, toujours affichée à l'utilisateur. */
  period: { label: string; from: string; to: string } | null;
  /** Chiffres calculés par le serveur : seuls chiffres affichés comme résultats. */
  data: Record<string, unknown>;
  /** Données manquantes ou absentes, signalées plutôt que comblées. */
  missing: string[];
}

export interface AnalyticsTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  permission: Permission;
  /** Activité exigée de l'établissement (restaurant, parc) ; absente = toutes. */
  activity?: Activity;
  /** Validation stricte des arguments proposés par le modèle ; null = refusés. */
  parse(args: unknown): Record<string, unknown> | null;
  run(ctx: AnalyticsContext, args: Record<string, unknown>): Promise<AnalyticsResult>;
}

const periodSchema = {
  type: 'string',
  enum: [...COPILOT_PERIODS],
  description:
    'Période analysée : today, yesterday, this_week (depuis lundi), last_7_days, this_month, last_30_days.',
};

const strictObject = (properties: Record<string, unknown>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** Accepte exactement les clés attendues : toute clé en plus (ex. un établissement) est refusée. */
function exactKeys(args: unknown, keys: string[]): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  const given = Object.keys(record);
  if (given.length !== keys.length || !given.every((k) => keys.includes(k))) return null;
  return record;
}

const isPeriod = (v: unknown): v is CopilotPeriod => COPILOT_PERIODS.includes(v as CopilotPeriod);

function parsePeriodOnly(args: unknown) {
  const a = exactKeys(args, ['period']);
  return a && isPeriod(a.period) ? { period: a.period } : null;
}

function window(ctx: AnalyticsContext, period: CopilotPeriod) {
  const resolved = resolveCopilotPeriod(period, ctx.now, ctx.establishment.timezone);
  return {
    resolved,
    range: {
      gte: zonedMidnight(resolved.from, ctx.establishment.timezone),
      lt: zonedMidnight(resolved.to, ctx.establishment.timezone),
    },
  };
}

const periodOf = (r: ResolvedPeriod) => ({ label: r.label, from: r.from, to: r.to });

/**
 * Périmètre d'analyse du copilote : l'établissement de la session uniquement, une activité, la
 * période choisie (résolue dans le fuseau de l'établissement).
 */
function analyticsScope(
  ctx: AnalyticsContext,
  period: CopilotPeriod,
  activity: Activity,
): { scope: AnalyticsScope; resolved: ResolvedPeriod } {
  const tz = ctx.establishment.timezone;
  const resolved = resolveCopilotPeriod(period, ctx.now, tz);
  const p = resolveAnalyticsPeriod(
    { period: 'custom', from: resolved.from, to: addDays(resolved.to, -1) },
    ctx.now,
    tz,
  );
  if ('error' in p) throw new Error(`Période invalide : ${p.error}`);
  return {
    resolved,
    scope: {
      organizationId: ctx.organizationId,
      establishments: [{ ...ctx.establishment, activities: [activity] }],
      establishmentIds: [ctx.establishment.id],
      activity,
      activities: [activity],
      period: p,
      timezone: tz,
    },
  };
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const hourLabel = (h: number) => `${h} h`;
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Ventes comptées : de l'établissement, non annulées (comme les tableaux de bord). */
const saleScope = (ctx: AnalyticsContext, activity?: Activity): Prisma.SaleWhereInput => ({
  organizationId: ctx.organizationId,
  establishmentId: ctx.establishment.id,
  status: 'OPEN',
  ...(activity ? { activity } : {}),
});

const ACTIVITY_FILTER = ['ALL', 'RESTAURANT', 'PARK'] as const;

export const ANALYTICS_TOOLS: readonly AnalyticsTool[] = [
  {
    name: 'revenue_summary',
    description:
      "Chiffre d'affaires encaissé (paiements confirmés), nombre de ventes payées et panier moyen sur une période.",
    parameters: strictObject({
      period: periodSchema,
      activity: {
        type: 'string',
        enum: [...ACTIVITY_FILTER],
        description: 'ALL pour tout, RESTAURANT ou PARK pour une seule activité.',
      },
    }),
    permission: 'sale.read_all',
    parse(args) {
      const a = exactKeys(args, ['period', 'activity']) ?? exactKeys(args, ['period']);
      if (!a || !isPeriod(a.period)) return null;
      const activity = a.activity ?? 'ALL';
      if (!ACTIVITY_FILTER.includes(activity as (typeof ACTIVITY_FILTER)[number])) return null;
      return { period: a.period, activity };
    },
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      const activity = args.activity === 'ALL' ? undefined : (args.activity as Activity);
      const payments = await ctx.prisma.payment.groupBy({
        by: ['saleId'],
        where: { status: 'SUCCEEDED', createdAt: range, sale: saleScope(ctx, activity) },
        _sum: { amount: true },
      });
      const revenue = payments.reduce((s, p) => s + (p._sum.amount ?? 0), 0);
      const paidSales = payments.length;
      return {
        tool: 'revenue_summary',
        title: "Chiffre d'affaires",
        period: periodOf(resolved),
        data: {
          revenueXof: revenue,
          paidSales,
          averageBasketXof: paidSales ? Math.round(revenue / paidSales) : null,
          activity: args.activity,
        },
        missing: paidSales ? [] : ['Aucune vente payée sur cette période.'],
      };
    },
  },
  {
    name: 'top_products',
    description: 'Produits les plus vendus (quantités et montants) sur une période, restaurant.',
    parameters: strictObject({
      period: periodSchema,
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Nombre de produits (1 à 10).',
      },
    }),
    permission: 'sale.read_all',
    activity: 'RESTAURANT',
    parse(args) {
      const a = exactKeys(args, ['period', 'limit']);
      if (!a || !isPeriod(a.period)) return null;
      const limit = a.limit;
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10) return null;
      return { period: a.period, limit };
    },
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      const rows = await ctx.prisma.saleLine.groupBy({
        by: ['productName', 'variantName'],
        where: {
          variantId: { not: null },
          // Daté à l'encaissement (règle commune aux analyses du Sprint 9).
          sale: {
            ...saleScope(ctx, 'RESTAURANT'),
            payments: { some: { status: 'SUCCEEDED', createdAt: range } },
          },
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: args.limit as number,
      });
      return {
        tool: 'top_products',
        title: 'Produits les plus vendus',
        period: periodOf(resolved),
        data: {
          products: rows.map((r, i) => ({
            rank: i + 1,
            name:
              r.variantName === 'Standard' ? r.productName : `${r.productName} (${r.variantName})`,
            quantity: r._sum.quantity ?? 0,
            amountXof: r._sum.lineTotal ?? 0,
          })),
        },
        missing: rows.length ? [] : ['Aucune vente payée sur cette période.'],
      };
    },
  },
  {
    name: 'low_stock',
    description: "Articles de stock au niveau ou sous leur seuil d'alerte (proches de la rupture).",
    parameters: strictObject({}),
    permission: 'stock.read',
    activity: 'RESTAURANT',
    parse: (args) => exactKeys(args ?? {}, []),
    async run(ctx) {
      const items = await ctx.prisma.stockItem.findMany({
        where: {
          organizationId: ctx.organizationId,
          establishmentId: ctx.establishment.id,
          isActive: true,
        },
        select: { name: true, unit: true, quantity: true, alertThreshold: true },
        orderBy: { name: 'asc' },
      });
      const withThreshold = items.filter((i) => i.alertThreshold !== null);
      const low = withThreshold.filter((i) => i.quantity.lte(i.alertThreshold!));
      const missing: string[] = [];
      if (!items.length) missing.push('Aucun article de stock n’est suivi dans cet établissement.');
      else if (withThreshold.length < items.length) {
        missing.push(
          `${items.length - withThreshold.length} article(s) sans seuil d'alerte : non évalué(s).`,
        );
      }
      return {
        tool: 'low_stock',
        title: 'Stocks proches de la rupture',
        period: null,
        data: {
          items: low.map((i) => ({
            name: i.name,
            unit: i.unit,
            quantity: Number(i.quantity),
            alertThreshold: Number(i.alertThreshold),
          })),
          evaluated: withThreshold.length,
        },
        missing,
      };
    },
  },
  {
    name: 'park_entries',
    description:
      'Nombre de visiteurs entrés dans le parc (billets scannés et acceptés) sur une période.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    activity: 'PARK',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      const entries = await ctx.prisma.ticketScan.count({
        where: {
          organizationId: ctx.organizationId,
          establishmentId: ctx.establishment.id,
          result: 'ACCEPTED',
          createdAt: range,
        },
      });
      return {
        tool: 'park_entries',
        title: 'Entrées au parc',
        period: periodOf(resolved),
        data: { entries },
        missing: entries ? [] : ['Aucune entrée enregistrée sur cette période.'],
      };
    },
  },
  {
    name: 'best_day',
    description: "Jour de la période où le chiffre d'affaires encaissé a été le plus élevé.",
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      // Requête paramétrée (aucune donnée interpolée) : regroupement par jour local.
      const days = await ctx.prisma.$queryRaw<
        Array<{ day: string; revenue: bigint; sales: bigint }>
      >`
        SELECT to_char(p."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${ctx.establishment.timezone}, 'YYYY-MM-DD') AS day,
               SUM(p.amount)::bigint AS revenue,
               COUNT(DISTINCT p."saleId")::bigint AS sales
        FROM "Payment" p
        JOIN "Sale" s ON s.id = p."saleId"
        WHERE p.status = 'SUCCEEDED'
          AND p."organizationId" = ${ctx.organizationId}::uuid
          AND s."establishmentId" = ${ctx.establishment.id}::uuid
          AND s.status = 'OPEN'
          AND p."createdAt" >= ${range.gte} AND p."createdAt" < ${range.lt}
        GROUP BY 1
        ORDER BY revenue DESC, day ASC
        LIMIT 1`;
      const best = days[0];
      return {
        tool: 'best_day',
        title: 'Meilleur jour',
        period: periodOf(resolved),
        data: best
          ? {
              day: `${best.day.slice(8, 10)}/${best.day.slice(5, 7)}/${best.day.slice(0, 4)}`,
              revenueXof: Number(best.revenue),
              paidSales: Number(best.sales),
            }
          : { day: null },
        missing: best ? [] : ['Aucune vente payée sur cette période.'],
      };
    },
  },
  {
    name: 'prepared_orders',
    description: 'Commandes préparées en cuisine (prêtes) et servies sur une période, restaurant.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    activity: 'RESTAURANT',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      const [ready, served] = await Promise.all([
        ctx.prisma.sale.count({ where: { ...saleScope(ctx, 'RESTAURANT'), readyAt: range } }),
        ctx.prisma.sale.count({ where: { ...saleScope(ctx, 'RESTAURANT'), servedAt: range } }),
      ]);
      return {
        tool: 'prepared_orders',
        title: 'Commandes préparées',
        period: periodOf(resolved),
        data: { readyOrders: ready, servedOrders: served },
        missing: ready || served ? [] : ['Aucune commande préparée sur cette période.'],
      };
    },
  },
  {
    name: 'ticket_sales',
    description: 'Billets vendus (hors annulés) et montant, par catégorie, sur une période, parc.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    activity: 'PARK',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { resolved, range } = window(ctx, args.period as CopilotPeriod);
      const rows = await ctx.prisma.ticket.groupBy({
        by: ['ticketCategoryId'],
        where: {
          organizationId: ctx.organizationId,
          establishmentId: ctx.establishment.id,
          status: { not: 'CANCELLED' },
          createdAt: range,
        },
        _count: { _all: true },
        _sum: { pricePaid: true },
      });
      const categories = await ctx.prisma.ticketCategory.findMany({
        where: { id: { in: rows.map((r) => r.ticketCategoryId) } },
        select: { id: true, name: true },
      });
      const names = new Map(categories.map((c) => [c.id, c.name]));
      const byCategory = rows.map((r) => ({
        category: names.get(r.ticketCategoryId) ?? 'Catégorie',
        tickets: r._count._all,
        amountXof: r._sum.pricePaid ?? 0,
      }));
      return {
        tool: 'ticket_sales',
        title: 'Billets vendus',
        period: periodOf(resolved),
        data: {
          tickets: byCategory.reduce((s, c) => s + c.tickets, 0),
          amountXof: byCategory.reduce((s, c) => s + c.amountXof, 0),
          byCategory,
        },
        missing: rows.length ? [] : ['Aucun billet vendu sur cette période.'],
      };
    },
  },
  {
    name: 'product_hourly_sales',
    description:
      'Ventes encaissées par produit et par heure locale (quantités et montant) sur une plage horaire. ' +
      'Ex. « combien de poulets braisés entre 12 h et 14 h ? » (product « poulet braisé », hour_from 12, ' +
      'hour_to 14) ou « quel produit rapporte le plus à 19 h ? » (product vide, hour_from 19, hour_to 20). Restaurant.',
    parameters: strictObject({
      period: periodSchema,
      product: {
        type: 'string',
        description:
          'Nom du produit tel que dit par l’utilisateur ; chaîne vide pour tous les produits.',
      },
      hour_from: {
        type: 'integer',
        minimum: 0,
        maximum: 23,
        description: 'Heure de début (incluse).',
      },
      hour_to: { type: 'integer', minimum: 1, maximum: 24, description: 'Heure de fin (exclue).' },
    }),
    permission: 'sale.read_all',
    activity: 'RESTAURANT',
    parse(args) {
      const a = exactKeys(args, ['period', 'product', 'hour_from', 'hour_to']);
      if (!a || !isPeriod(a.period) || typeof a.product !== 'string' || a.product.length > 80) {
        return null;
      }
      if (!isInt(a.hour_from, 0, 23) || !isInt(a.hour_to, 1, 24) || a.hour_to <= a.hour_from) {
        return null;
      }
      return {
        period: a.period,
        product: a.product.trim(),
        hourFrom: a.hour_from,
        hourTo: a.hour_to,
      };
    },
    async run(ctx, args) {
      const { scope, resolved } = analyticsScope(ctx, args.period as CopilotPeriod, 'RESTAURANT');
      const hourFrom = args.hourFrom as number;
      const hourTo = args.hourTo as number;
      const base = {
        tool: 'product_hourly_sales',
        title: `Ventes par produit, ${hourLabel(hourFrom)} – ${hourLabel(hourTo)}`,
        period: periodOf(resolved),
      };
      let productId: string | null = null;
      let productName: string | null = null;
      if (args.product) {
        // Produit cherché par le serveur dans le catalogue de l'établissement, jamais deviné.
        const catalog = await ctx.prisma.product.findMany({
          where: {
            organizationId: ctx.organizationId,
            variants: { some: { prices: { some: { establishmentId: ctx.establishment.id } } } },
          },
          select: { id: true, name: true },
        });
        const match = matchProductName(args.product as string, catalog);
        if (match.status !== 'MATCHED') {
          return {
            ...base,
            data: {
              product: null,
              candidates: match.status === 'AMBIGUOUS' ? match.candidates.map((c) => c.name) : [],
            },
            missing: [
              match.status === 'AMBIGUOUS'
                ? `Plusieurs produits correspondent à « ${args.product} » : précisez lequel.`
                : `Aucun produit du catalogue ne correspond à « ${args.product} ».`,
            ],
          };
        }
        productId = match.item.id;
        productName = match.item.name;
      }
      const r = await ctx.analytics.restaurantHourly(scope, {
        hourFrom,
        hourTo,
        weekday: null,
        productId,
      });
      const byProduct = new Map<string, { quantity: number; amountXof: number }>();
      for (const row of r.rows) {
        const p = byProduct.get(row.product) ?? { quantity: 0, amountXof: 0 };
        p.quantity += row.quantity;
        p.amountXof += row.revenue;
        byProduct.set(row.product, p);
      }
      const products = [...byProduct.entries()]
        .map(([name, p]) => ({ name, ...p }))
        .sort((a, b) => b.amountXof - a.amountXof)
        .slice(0, 10);
      return {
        ...base,
        data: {
          product: productName,
          hourFrom,
          hourTo,
          quantity: r.hours.reduce((s, h) => s + h.quantity, 0),
          amountXof: r.hours.reduce((s, h) => s + h.revenue, 0),
          byHour: r.hours.map((h) => ({
            hour: h.hour,
            quantity: h.quantity,
            amountXof: h.revenue,
          })),
          products,
        },
        missing: r.rows.length ? [] : ['Aucune vente encaissée sur cette plage horaire.'],
      };
    },
  },
  {
    name: 'top_products_revenue',
    description:
      'Produits qui ont généré le plus de chiffre d’affaires (lignes encaissées) sur une période. Restaurant.',
    parameters: strictObject({
      period: periodSchema,
      limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Nombre de produits.' },
    }),
    permission: 'sale.read_all',
    activity: 'RESTAURANT',
    parse(args) {
      const a = exactKeys(args, ['period', 'limit']);
      return a && isPeriod(a.period) && isInt(a.limit, 1, 10)
        ? { period: a.period, limit: a.limit }
        : null;
    },
    async run(ctx, args) {
      const { scope, resolved } = analyticsScope(ctx, args.period as CopilotPeriod, 'RESTAURANT');
      const r = await ctx.analytics.restaurant(scope);
      const products = [...r.products]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, args.limit as number)
        .map((p, i) => ({
          rank: i + 1,
          name: p.product,
          amountXof: p.revenue,
          quantity: p.quantity,
        }));
      return {
        tool: 'top_products_revenue',
        title: 'Produits qui rapportent le plus',
        period: periodOf(resolved),
        data: { products },
        missing: products.length ? [] : ['Aucune vente payée sur cette période.'],
      };
    },
  },
  {
    name: 'busiest_hours',
    description:
      'Heures locales qui génèrent le plus de commandes, avec leur montant encaissé, sur une période. Restaurant.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    activity: 'RESTAURANT',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { scope, resolved } = analyticsScope(ctx, args.period as CopilotPeriod, 'RESTAURANT');
      const r = await ctx.analytics.restaurant(scope);
      const hours = r.hourly
        .filter((h) => h.orders > 0)
        .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)
        .slice(0, 3)
        .map((h) => ({ hour: h.hour, orders: h.orders, amountXof: h.revenue }));
      return {
        tool: 'busiest_hours',
        title: 'Heures de pointe',
        period: periodOf(resolved),
        data: { hours },
        missing: hours.length ? [] : ['Aucune commande sur cette période.'],
      };
    },
  },
  {
    name: 'busiest_park_day',
    description:
      'Jour le plus fréquenté du parc (entrées réelles = scans acceptés) et jour de la semaine le plus fréquenté, sur une période. Parc.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'sale.read_all',
    activity: 'PARK',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { scope, resolved } = analyticsScope(ctx, args.period as CopilotPeriod, 'PARK');
      const r = await ctx.analytics.park(scope);
      const total = r.totals.scanned.current;
      const best = [...r.daily].sort((a, b) => b.entries - a.entries)[0];
      const weekday = [...r.weekdays].sort((a, b) => b.entries - a.entries)[0];
      return {
        tool: 'busiest_park_day',
        title: 'Jour le plus fréquenté',
        period: periodOf(resolved),
        data: {
          day: total > 0 && best ? best.date : null,
          entries: total > 0 && best ? best.entries : 0,
          busiestWeekday: total > 0 && weekday ? WEEKDAYS[weekday.weekday - 1] : null,
          totalEntries: total,
          refusedScans: r.totals.refusedScans.total,
        },
        missing: total > 0 ? [] : ['Aucune entrée enregistrée sur cette période.'],
      };
    },
  },
  {
    name: 'category_margins',
    description:
      'Marge brute ESTIMÉE par catégorie de produits (CA − coût matière au coût d’achat actuel des recettes) et catégorie la plus rentable parmi celles dont les coûts sont complets. Ce n’est pas un bénéfice net. Restaurant.',
    parameters: strictObject({ period: periodSchema }),
    permission: 'analytics.margins',
    activity: 'RESTAURANT',
    parse: parsePeriodOnly,
    async run(ctx, args) {
      const { scope, resolved } = analyticsScope(ctx, args.period as CopilotPeriod, 'RESTAURANT');
      const r = await ctx.analytics.margins(scope);
      const categories = r.categories.map((c) => ({
        category: c.category,
        revenueXof: c.revenue,
        materialCostXof: c.materialCost,
        estimatedMarginXof: c.margin,
        marginRatePct: c.marginRate,
        complete: c.complete,
      }));
      const complete = categories.filter((c) => c.complete);
      const best = [...complete].sort((a, b) => b.estimatedMarginXof - a.estimatedMarginXof)[0];
      const incomplete = categories.filter((c) => !c.complete).map((c) => c.category);
      return {
        tool: 'category_margins',
        title: 'Marges estimées par catégorie',
        period: periodOf(resolved),
        data: {
          categories,
          mostProfitable: best?.category ?? null,
          note: 'Marge brute estimée au coût d’achat actuel des ingrédients ; personnel, loyer, énergie et taxes non intégrés.',
        },
        missing: [
          ...(categories.length ? [] : ['Aucune vente payée sur cette période.']),
          ...(incomplete.length
            ? [`Marge incomplète (recette ou coût manquant) : ${incomplete.join(', ')}.`]
            : []),
          ...(categories.length && !complete.length
            ? ['Aucune catégorie n’a de coûts complets : la plus rentable ne peut être déterminée.']
            : []),
        ],
      };
    },
  },
];
