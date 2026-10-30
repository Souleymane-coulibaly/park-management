import type { Prisma } from '@ocall/database';
import {
  type Activity,
  COPILOT_PERIODS,
  type CopilotPeriod,
  type Permission,
  type ResolvedPeriod,
  resolveCopilotPeriod,
  zonedMidnight,
} from '@ocall/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { JsonSchema } from '../providers/ai-provider';

/**
 * Registre FERMÉ des fonctions analytiques du copilote : uniquement des lectures, calculées par le
 * serveur. Le modèle ne choisit qu'une fonction de cette liste et des paramètres bornés (période,
 * nombre de lignes) ; il ne fournit jamais l'établissement, ni SQL, ni commande. Les périodes sont
 * calculées dans le fuseau de l'établissement.
 *
 * Point d'extension du Sprint 9 : de nouvelles analyses s'ajoutent ici, avec la même structure.
 */

export interface AnalyticsContext {
  prisma: PrismaService;
  organizationId: string;
  establishment: { id: string; name: string; timezone: string };
  now: Date;
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
          sale: { ...saleScope(ctx, 'RESTAURANT'), paymentStatus: 'PAID', createdAt: range },
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
];
