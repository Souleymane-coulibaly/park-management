import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_DEFAULT_SLOW_MOVING_DAYS,
  STOCK_OUTGOING_KINDS,
  STOCK_REPORT_METHODS,
  stockIsSlowMoving,
  stockMarginRate,
  stockMargins,
  stockReportPeriod,
  stockUnitCost,
  stockValue,
  stockWeightedCost,
} from '@ocall/shared';
import { type StockContext, stockCan, stockSiteAllowed } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const DAY = 86_400_000;
const TOP = 10;
const ALERT_LIMIT = 200;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

interface Scope {
  organizationId: string;
  /** Sites retenus : null = tous ceux de l'organisation. */
  sites: string[] | null;
}

/** Filtre SQL des sites (colonne `alias."siteId"`), paramétré. */
function siteSql(alias: string, sites: string[] | null) {
  if (sites === null) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`${alias}."siteId"`)} = ANY(${sites}::uuid[])`;
}

export interface StockAlertRow {
  variantId: string;
  productId: string;
  sku: string;
  label: string;
  unit: string;
  siteId: string;
  siteName: string;
  available: number;
  onHand: number;
  minStock: number | null;
  lastOutAt: Date | null;
}

/**
 * Ocall Stock — S6 : tableaux de bord et alertes. Agrégats calculés par PostgreSQL (requêtes paramétrées),
 * toujours limités à l'organisation et aux sites du membre. Chaque bloc n'est renvoyé qu'avec le droit qui
 * le concerne (ventes, stocks, prix d'achat, achats, mouvements) ; sinon il vaut null.
 */
@Injectable()
export class OcallStockReportsService {
  constructor(private readonly db: OcallStockPrismaService) {}

  async dashboard(ctx: StockContext, query: { from?: string; to?: string; siteId?: string }) {
    const period = stockReportPeriod(query.from, query.to, new Date());
    if (period.error) {
      throw new BadRequestException({ code: 'STOCK_REPORT_PERIOD', message: period.error });
    }
    const scope = await this.scope(ctx, query.siteId);
    const start = period.from;
    const end = new Date(period.to.getTime() + DAY);
    const seeCost = stockCan(ctx, 'stock.prices.purchase.read');
    const sites = await this.db.stockSite.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(scope.sites ? { id: { in: scope.sites } } : {}),
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const costs = seeCost ? await this.unitCosts(ctx.organizationId, end) : null;

    const sales = stockCan(ctx, 'stock.sales.read')
      ? await this.sales(scope, start, end, costs)
      : null;
    const stock = stockCan(ctx, 'stock.levels.read') ? await this.stockValue(scope, costs) : null;
    const alerts = stockCan(ctx, 'stock.levels.read') ? await this.alertCounts(ctx, scope) : null;
    const purchases = stockCan(ctx, 'stock.purchases.read')
      ? await this.purchases(scope, start, end, seeCost)
      : null;
    const variances = stockCan(ctx, 'stock.movements.read')
      ? await this.variances(scope, start, end, costs)
      : null;

    return {
      period: {
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
      },
      siteId: query.siteId ?? null,
      sales: sales ? (({ bySite: _b, ...rest }) => rest)(sales) : null,
      stock: stock ? (({ bySite: _b, ...rest }) => rest)(stock) : null,
      alerts,
      purchases,
      variances,
      sites: sites.map((s) => ({
        ...s,
        revenue: sales?.bySite.get(s.id)?.revenue ?? (sales ? 0 : null),
        salesCount: sales?.bySite.get(s.id)?.count ?? (sales ? 0 : null),
        stockValue: stock ? (stock.bySite.get(s.id) ?? 0) : null,
      })),
      methods: STOCK_REPORT_METHODS,
    };
  }

  /** Ruptures, stocks sous le seuil et articles à faible rotation, par article et par site. */
  async alerts(ctx: StockContext, siteId?: string) {
    const scope = await this.scope(ctx, siteId);
    const days = await this.slowMovingDays(ctx.organizationId);
    const rows = await this.levelRows(scope);
    const now = new Date();
    const outOfStock = rows.filter((r) => r.available <= 0 && r.onHand <= 0);
    const low = rows.filter(
      (r) =>
        r.minStock !== null && r.available <= r.minStock && !(r.available <= 0 && r.onHand <= 0),
    );
    const slowMoving = rows.filter((r) =>
      stockIsSlowMoving(r.onHand, r.lastOutAt, r.createdAt, now, days),
    );
    const strip = ({ createdAt: _c, ...r }: StockAlertRow & { createdAt: Date }) => r;
    return {
      slowMovingDays: days,
      counts: { outOfStock: outOfStock.length, low: low.length, slowMoving: slowMoving.length },
      outOfStock: outOfStock.slice(0, ALERT_LIMIT).map(strip),
      low: low.slice(0, ALERT_LIMIT).map(strip),
      slowMoving: slowMoving.slice(0, ALERT_LIMIT).map(strip),
      methods: {
        lowStock: STOCK_REPORT_METHODS.lowStock,
        slowMoving: STOCK_REPORT_METHODS.slowMoving,
      },
    };
  }

  /** Nombre d'alertes à traiter (ruptures et stocks sous le seuil), pour le menu. */
  async alertCount(ctx: StockContext) {
    const counts = await this.alertCounts(ctx, await this.scope(ctx));
    return { count: counts.outOfStock + counts.low };
  }

  // ─── Blocs ───

  private async sales(
    scope: Scope,
    start: Date,
    end: Date,
    costs: Map<string, { cost: number | null; purchasePrice: number | null }> | null,
  ) {
    const org = scope.organizationId;
    const [totals] = await this.db.$queryRaw<
      { count: bigint; total: bigint | null; vat: bigint | null }[]
    >`
      SELECT count(*) AS count, sum(s."total") AS total, sum(s."vatTotal") AS vat
      FROM "StockSale" s
      WHERE s."organizationId" = ${org}::uuid AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        ${siteSql('s', scope.sites)}`;
    const [refunds] = await this.db.$queryRaw<{ total: bigint | null }[]>`
      SELECT sum(r."refundAmount") AS total
      FROM "StockSaleReturn" r JOIN "StockSale" s ON s."id" = r."saleId"
      WHERE r."organizationId" = ${org}::uuid AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
        ${siteSql('s', scope.sites)}`;
    const days = await this.db.$queryRaw<{ day: Date; count: bigint; total: bigint }[]>`
      SELECT date_trunc('day', s."createdAt") AS day, count(*) AS count, sum(s."total") AS total
      FROM "StockSale" s
      WHERE s."organizationId" = ${org}::uuid AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        ${siteSql('s', scope.sites)}
      GROUP BY 1 ORDER BY 1`;
    const bySiteRows = await this.db.$queryRaw<{ siteId: string; count: bigint; total: bigint }[]>`
      SELECT s."siteId", count(*) AS count, sum(s."total") AS total
      FROM "StockSale" s
      WHERE s."organizationId" = ${org}::uuid AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        ${siteSql('s', scope.sites)}
      GROUP BY s."siteId"`;
    // Lignes des ventes de la période, nettes de leurs retours ; hors taxe au prorata de la ligne.
    const lines = await this.db.$queryRaw<
      {
        variantId: string;
        label: string;
        sku: string;
        quantity: Prisma.Decimal;
        revenue: Prisma.Decimal | null;
        revenueHt: Prisma.Decimal | null;
      }[]
    >`
      SELECT l."variantId", max(l."label") AS label, max(l."sku") AS sku,
             sum(l."quantity" - l."returnedQuantity") AS quantity,
             sum(l."total" - l."refundedAmount") AS revenue,
             sum(CASE WHEN l."total" = 0 THEN 0
                 ELSE (l."total" - l."refundedAmount")::numeric * (l."total" - l."vatAmount") / l."total" END)
               AS "revenueHt"
      FROM "StockSaleLine" l JOIN "StockSale" s ON s."id" = l."saleId"
      WHERE l."organizationId" = ${org}::uuid AND s."createdAt" >= ${start} AND s."createdAt" < ${end}
        ${siteSql('s', scope.sites)}
      GROUP BY l."variantId"`;
    const perLine = lines.map((l) => ({
      variantId: l.variantId,
      label: l.label,
      sku: l.sku,
      quantity: n(l.quantity),
      revenue: n(l.revenue),
      revenueHt: Math.round(n(l.revenueHt)),
    }));
    const gross = n(totals?.total);
    const refunded = n(refunds?.total);
    const margins = costs
      ? stockMargins(
          perLine
            .filter((l) => l.quantity > 0)
            .map((l) => ({
              quantity: l.quantity,
              revenueHt: l.revenueHt,
              purchasePrice: costs.get(l.variantId)?.purchasePrice ?? null,
              unitCost: costs.get(l.variantId)?.cost ?? null,
            })),
        )
      : null;
    const count = n(totals?.count);
    return {
      count,
      revenue: gross,
      revenueHt: gross - n(totals?.vat),
      refunds: refunded,
      netRevenue: gross - refunded,
      averageBasket: count > 0 ? Math.round(gross / count) : 0,
      byDay: days.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        count: n(d.count),
        revenue: n(d.total),
      })),
      top: [...perLine]
        .filter((l) => l.quantity > 0)
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
        .slice(0, TOP),
      margins: margins
        ? {
            ...margins,
            estimatedRate: stockMarginRate(margins.estimated, margins.revenueHt),
            grossRate: stockMarginRate(margins.gross, margins.revenueHt),
            netProfit: null,
          }
        : null,
      bySite: new Map(
        bySiteRows.map((r) => [r.siteId, { count: n(r.count), revenue: n(r.total) }]),
      ),
    };
  }

  private async stockValue(
    scope: Scope,
    costs: Map<
      string,
      { cost: number | null; purchasePrice: number | null; source: string }
    > | null,
  ) {
    const rows = await this.db.$queryRaw<
      { variantId: string; siteId: string; onHand: Prisma.Decimal }[]
    >`
      SELECT l."variantId", l."siteId", sum(l."onHand") AS "onHand"
      FROM "StockLevel" l
      WHERE l."organizationId" = ${scope.organizationId}::uuid AND l."onHand" <> 0
        ${siteSql('l', scope.sites)}
      GROUP BY l."variantId", l."siteId"`;
    const bySite = new Map<string, number>();
    let value = 0;
    let fromProduct = 0;
    const unvalued = new Set<string>();
    for (const r of rows) {
      const q = n(r.onHand);
      if (q <= 0) continue;
      if (!costs) continue;
      const c = costs.get(r.variantId);
      const v = stockValue(q, c?.cost ?? null);
      if (v === null) {
        unvalued.add(r.variantId);
        continue;
      }
      if (c?.source === 'PRODUCT') fromProduct += 1;
      value += v;
      bySite.set(r.siteId, (bySite.get(r.siteId) ?? 0) + v);
    }
    return {
      /** Null sans le droit de voir les prix d'achat. */
      value: costs ? value : null,
      valuedFromProduct: costs ? fromProduct : null,
      unvalued: costs ? unvalued.size : null,
      variants: new Set(rows.filter((r) => n(r.onHand) > 0).map((r) => r.variantId)).size,
      bySite,
    };
  }

  private async purchases(scope: Scope, start: Date, end: Date, seeCost: boolean) {
    const org = scope.organizationId;
    const [received] = await this.db.$queryRaw<
      { receipts: bigint; value: Prisma.Decimal | null }[]
    >`
      SELECT count(DISTINCT r."id") AS receipts, sum(rl."quantity" * rl."unitCost") AS value
      FROM "StockReceipt" r JOIN "StockReceiptLine" rl ON rl."receiptId" = r."id"
      WHERE r."organizationId" = ${org}::uuid AND r."status" = 'VALIDATED'
        AND r."createdAt" >= ${start} AND r."createdAt" < ${end}
        ${siteSql('r', scope.sites)}`;
    const orders = await this.db.stockPurchaseOrder.count({
      where: {
        organizationId: org,
        createdAt: { gte: start, lt: end },
        status: { not: 'DRAFT' },
        ...(scope.sites ? { siteId: { in: scope.sites } } : {}),
      },
    });
    return {
      orders,
      receipts: n(received?.receipts),
      receivedValue: seeCost ? Math.round(n(received?.value)) : null,
    };
  }

  private async variances(
    scope: Scope,
    start: Date,
    end: Date,
    costs: Map<string, { cost: number | null }> | null,
  ) {
    const rows = await this.db.$queryRaw<{ variantId: string; quantity: Prisma.Decimal }[]>`
      SELECT m."variantId", m."quantity"
      FROM "StockMovement" m
      WHERE m."organizationId" = ${scope.organizationId}::uuid AND m."kind" = 'COUNT'
        AND m."createdAt" >= ${start} AND m."createdAt" < ${end}
        ${siteSql('m', scope.sites)}`;
    let surplus = 0;
    let shortage = 0;
    let value: number | null = costs ? 0 : null;
    for (const r of rows) {
      const q = n(r.quantity);
      if (q > 0) surplus += q;
      else shortage += -q;
      const v = costs ? stockValue(q, costs.get(r.variantId)?.cost ?? null) : null;
      if (value !== null && v !== null) value += v;
    }
    return {
      adjustments: rows.length,
      surplus: Math.round(surplus * 1000) / 1000,
      shortage: Math.round(shortage * 1000) / 1000,
      /** Valeur nette des écarts (positive = surplus) au coût retenu. */
      value,
    };
  }

  private async alertCounts(ctx: StockContext, scope: Scope) {
    const a = await this.alerts(ctx, scope.sites?.length === 1 ? scope.sites[0] : undefined);
    return a.counts;
  }

  // ─── Outils ───

  /** Périmètre : un site précis (dans ceux du membre), sinon ceux du membre (null = tous). */
  private async scope(ctx: StockContext, siteId?: string): Promise<Scope> {
    if (siteId) {
      const site = await this.db.stockSite.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: siteId } },
        select: { id: true },
      });
      if (!site || !stockSiteAllowed(ctx, siteId)) {
        throw new NotFoundException({ code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' });
      }
      return { organizationId: ctx.organizationId, sites: [siteId] };
    }
    return { organizationId: ctx.organizationId, sites: ctx.siteIds };
  }

  private async slowMovingDays(organizationId: string) {
    const settings = await this.db.stockSettings.findUnique({
      where: { organizationId },
      select: { slowMovingDays: true },
    });
    return settings?.slowMovingDays ?? STOCK_DEFAULT_SLOW_MOVING_DAYS;
  }

  /**
   * Coût retenu par article : CMUP des réceptions validées jusqu'à la fin de la période, sinon prix d'achat
   * de la fiche (variante, puis article). Le prix de la fiche sert aussi à la marge estimée.
   */
  private async unitCosts(organizationId: string, until: Date) {
    const receipts = await this.db.$queryRaw<
      { variantId: string; unitCost: number; quantity: Prisma.Decimal }[]
    >`
      SELECT rl."variantId", rl."unitCost", sum(rl."quantity") AS quantity
      FROM "StockReceiptLine" rl JOIN "StockReceipt" r ON r."id" = rl."receiptId"
      WHERE rl."organizationId" = ${organizationId}::uuid AND r."status" = 'VALIDATED'
        AND r."createdAt" < ${until}
      GROUP BY rl."variantId", rl."unitCost"`;
    const byVariant = new Map<string, { quantity: number; unitCost: number }[]>();
    for (const r of receipts) {
      const list = byVariant.get(r.variantId) ?? [];
      list.push({ quantity: n(r.quantity), unitCost: r.unitCost });
      byVariant.set(r.variantId, list);
    }
    const variants = await this.db.stockVariant.findMany({
      where: { organizationId },
      select: { id: true, purchasePrice: true, product: { select: { purchasePrice: true } } },
    });
    const out = new Map<
      string,
      { cost: number | null; purchasePrice: number | null; source: string }
    >();
    for (const v of variants) {
      const purchasePrice = v.purchasePrice ?? v.product.purchasePrice;
      const unit = stockUnitCost(stockWeightedCost(byVariant.get(v.id) ?? []), purchasePrice);
      out.set(v.id, { cost: unit.cost, purchasePrice, source: unit.source });
    }
    return out;
  }

  /** Niveaux par article et par site (articles stockés actifs), avec seuil et dernière sortie. */
  private async levelRows(scope: Scope) {
    const kinds = [...STOCK_OUTGOING_KINDS];
    const rows = await this.db.$queryRaw<
      {
        variantId: string;
        productId: string;
        sku: string;
        label: string;
        unit: string;
        siteId: string;
        siteName: string;
        onHand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        minStock: Prisma.Decimal | null;
        lastOutAt: Date | null;
        createdAt: Date;
      }[]
    >`
      SELECT l."variantId", p."id" AS "productId", v."sku",
             CASE WHEN v."name" IS NULL THEN p."name" ELSE p."name" || ' — ' || v."name" END AS label,
             p."unit", l."siteId", st."name" AS "siteName",
             sum(l."onHand") AS "onHand", sum(l."reserved") AS reserved, p."minStock",
             (SELECT max(m."createdAt") FROM "StockMovement" m
               WHERE m."organizationId" = l."organizationId" AND m."variantId" = l."variantId"
                 AND m."siteId" = l."siteId" AND m."kind"::text = ANY(${kinds}::text[])) AS "lastOutAt",
             v."createdAt"
      FROM "StockLevel" l
      JOIN "StockVariant" v ON v."id" = l."variantId"
      JOIN "StockProduct" p ON p."id" = v."productId"
      JOIN "StockSite" st ON st."id" = l."siteId"
      WHERE l."organizationId" = ${scope.organizationId}::uuid
        AND NOT v."isArchived" AND NOT p."isArchived" AND p."isStockable" AND NOT st."isArchived"
        ${siteSql('l', scope.sites)}
      GROUP BY l."organizationId", l."variantId", p."id", v."sku", v."name", p."name", p."unit",
               l."siteId", st."name", p."minStock", v."createdAt"
      ORDER BY label, st."name"`;
    return rows.map((r) => {
      const onHand = n(r.onHand);
      return {
        variantId: r.variantId,
        productId: r.productId,
        sku: r.sku,
        label: r.label,
        unit: r.unit,
        siteId: r.siteId,
        siteName: r.siteName,
        onHand,
        available: Math.round((onHand - n(r.reserved)) * 1000) / 1000,
        minStock: r.minStock === null ? null : n(r.minStock),
        lastOutAt: r.lastOutAt,
        createdAt: r.createdAt,
      };
    });
  }
}
