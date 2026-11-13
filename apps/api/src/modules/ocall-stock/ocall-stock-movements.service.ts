import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { AuditService } from '../../common/audit/audit.service';
import {
  type StockContext,
  stockCan,
  stockSiteAllowed,
  stockSiteWhere,
} from './ocall-stock-access';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type {
  StockLevelsQueryDto,
  StockMoveDto,
  StockMovementDto,
  StockMovementsQueryDto,
} from './ocall-stock.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const num = (v: Prisma.Decimal | string | null) => (v === null ? null : Number(v));

interface LevelRow {
  siteId: string;
  variantId: string;
  onHand: string;
  reserved: string;
  inTransit: string;
  minStock: string | null;
  total: bigint;
}

/**
 * Stocks et mouvements (S2) : niveaux par site (en stock, réservé, disponible, en transit), détail par
 * emplacement, saisies manuelles (entrée, sortie, ajustement), déplacements internes, registre. Toute
 * écriture passe par le moteur (`OcallStockLedgerService`) : rien ne modifie une quantité directement.
 */
@Injectable()
export class OcallStockMovementsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly sites: OcallStockSitesService,
    private readonly catalog: OcallStockCatalogService,
    private readonly audit: AuditService,
  ) {}

  /** Stock par site et par variante, paginé ; seuil d'alerte comparé au stock du site. */
  async levels(ctx: StockContext, query: StockLevelsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    if (query.siteId && !stockSiteAllowed(ctx, query.siteId))
      return { items: [], total: 0, page, pageSize };
    let productIds: string[] | null = query.productId ? [query.productId] : null;
    if (query.q?.trim()) {
      const found = await this.catalog.searchProductIds(ctx.organizationId, query.q.trim(), 500);
      productIds = productIds ? productIds.filter((id) => found.includes(id)) : found;
      if (productIds.length === 0) return { items: [], total: 0, page, pageSize };
    }
    // Stock (par emplacement, cumulé par site) et transit (expédié vers le site, ni reçu ni déclaré
    // manquant) réunis : un article attendu dans un site où il n'a encore aucun stock apparaît aussi.
    const scope = (column: Prisma.Sql) => [
      ...(ctx.siteIds ? [Prisma.sql`${column} = ANY(${ctx.siteIds}::uuid[])`] : []),
      ...(query.siteId ? [Prisma.sql`${column} = ${query.siteId}::uuid`] : []),
    ];
    const levelWhere = [
      Prisma.sql`l."organizationId" = ${ctx.organizationId}::uuid`,
      ...scope(Prisma.sql`l."siteId"`),
      ...(query.locationId ? [Prisma.sql`l."locationId" = ${query.locationId}::uuid`] : []),
    ];
    const transitWhere = [
      Prisma.sql`t."organizationId" = ${ctx.organizationId}::uuid`,
      Prisma.sql`t.status IN ('SHIPPED', 'PARTIALLY_RECEIVED')`,
      ...scope(Prisma.sql`t."toSiteId"`),
      // Le transit n'est rattaché à aucun emplacement : absent d'une vue par emplacement.
      ...(query.locationId ? [Prisma.sql`false`] : []),
    ];
    const rows = await this.db.$queryRaw<LevelRow[]>`
      WITH lv AS (
        SELECT l."siteId", l."variantId", SUM(l."onHand") AS "onHand", SUM(l."reserved") AS "reserved"
        FROM "StockLevel" l WHERE ${Prisma.join(levelWhere, ' AND ')}
        GROUP BY l."siteId", l."variantId"
      ), tr AS (
        SELECT t."toSiteId" AS "siteId", tl."variantId",
               SUM(tl."shippedQuantity" - tl."receivedQuantity" - tl."lostQuantity") AS "inTransit"
        FROM "StockTransferLine" tl JOIN "StockTransfer" t ON t.id = tl."transferId"
        WHERE ${Prisma.join(transitWhere, ' AND ')}
        GROUP BY t."toSiteId", tl."variantId"
      ), merged AS (
        SELECT COALESCE(lv."siteId", tr."siteId") AS "siteId", COALESCE(lv."variantId", tr."variantId") AS "variantId",
               COALESCE(lv."onHand", 0) AS "onHand", COALESCE(lv."reserved", 0) AS "reserved",
               COALESCE(tr."inTransit", 0) AS "inTransit"
        FROM lv FULL OUTER JOIN tr ON tr."siteId" = lv."siteId" AND tr."variantId" = lv."variantId"
      )
      SELECT m."siteId", m."variantId", m."onHand"::text AS "onHand", m."reserved"::text AS "reserved",
             m."inTransit"::text AS "inTransit", p."minStock"::text AS "minStock", COUNT(*) OVER () AS total
      FROM merged m
      JOIN "StockVariant" v ON v.id = m."variantId"
      JOIN "StockProduct" p ON p.id = v."productId"
      WHERE ${productIds ? Prisma.sql`v."productId" = ANY(${productIds}::uuid[])` : Prisma.sql`true`}
        ${query.belowMin ? Prisma.sql`AND p."minStock" IS NOT NULL AND m."onHand" < p."minStock"` : Prisma.empty}
      ORDER BY p.name ASC, v.name ASC NULLS FIRST, m."siteId"
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const total = rows[0] ? Number(rows[0].total) : 0;
    const [variants, sites] = await Promise.all([
      this.db.stockVariant.findMany({
        where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.variantId) } },
        select: {
          id: true,
          name: true,
          sku: true,
          product: { select: { id: true, name: true, unit: true } },
        },
      }),
      this.db.stockSite.findMany({
        where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.siteId) } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      items: rows.map((r) => {
        const onHand = D(r.onHand);
        const reserved = D(r.reserved);
        return {
          site: sites.find((x) => x.id === r.siteId)!,
          variant: variants.find((v) => v.id === r.variantId)!,
          onHand: onHand.toNumber(),
          reserved: reserved.toNumber(),
          available: onHand.minus(reserved).toNumber(),
          inTransit: Number(r.inTransit),
          minStock: num(r.minStock),
          belowMin: r.minStock !== null && onHand.lessThan(D(r.minStock)),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** Détail par emplacement d'un article (toutes variantes, sites accessibles). */
  async productLevels(ctx: StockContext, productId: string) {
    const product = await this.db.stockProduct.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: productId } },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException({
        code: 'STOCK_PRODUCT_NOT_FOUND',
        message: 'Article introuvable.',
      });
    const levels = await this.db.stockLevel.findMany({
      where: { organizationId: ctx.organizationId, variant: { productId }, ...stockSiteWhere(ctx) },
      orderBy: [{ site: { name: 'asc' } }, { location: { code: 'asc' } }],
      select: {
        variantId: true,
        onHand: true,
        reserved: true,
        site: { select: { id: true, code: true, name: true } },
        location: { select: { id: true, code: true, name: true } },
      },
    });
    return levels.map((l) => ({
      ...l,
      onHand: l.onHand.toNumber(),
      reserved: l.reserved.toNumber(),
      available: l.onHand.minus(l.reserved).toNumber(),
    }));
  }

  /** Entrée, sortie ou ajustement manuel, idempotent (clé de l'appareil). */
  async record(ctx: StockContext, dto: StockMovementDto) {
    const permission = dto.kind === 'ADJUSTMENT' ? 'stock.adjust' : 'stock.movements.create';
    if (!stockCan(ctx, permission)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    if (dto.quantity === 0 || (dto.kind !== 'ADJUSTMENT' && dto.quantity < 0)) {
      throw new BadRequestException({
        code: 'STOCK_QUANTITY_INVALID',
        message: 'Quantité positive (entrée, sortie) ou non nulle (ajustement).',
      });
    }
    if (dto.kind !== 'IN' && !dto.reason) {
      throw new BadRequestException({
        code: 'STOCK_REASON_REQUIRED',
        message: 'Indiquez le motif de la sortie ou de l’ajustement.',
      });
    }
    const quantity = dto.kind === 'OUT' ? D(dto.quantity).negated() : D(dto.quantity);
    const result = await this.db.$transaction(async (tx) => {
      const location = await this.sites.location(ctx, dto.locationId, { active: true }, tx);
      const r = await this.ledger.apply(tx, ctx, `manual:${dto.idempotencyKey}`, [
        {
          variantId: dto.variantId,
          locationId: location.id,
          kind: dto.kind,
          quantity,
          idempotencyKey: `manual:${dto.idempotencyKey}`,
          sourceType: 'MANUAL',
          reason: dto.reason ?? null,
          unitCost: dto.kind === 'IN' ? (dto.unitCost ?? null) : null,
        },
      ]);
      return r;
    });
    const movement = result.movements[0]!;
    if (!result.replayed) {
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'stock.movement_recorded',
        targetType: 'StockMovement',
        targetId: movement.id,
        metadata: { kind: dto.kind, quantity: quantity.toNumber() },
      });
    }
    return {
      replayed: result.replayed,
      movementId: movement.id,
      quantityAfter: movement.quantityAfter.toNumber(),
    };
  }

  /** Déplacement interne d'un emplacement à un autre du même site : deux mouvements, une transaction. */
  async move(ctx: StockContext, dto: StockMoveDto) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException({
        code: 'STOCK_MOVE_SAME_LOCATION',
        message: 'Choisissez un autre emplacement.',
      });
    }
    const quantity = D(dto.quantity);
    const result = await this.db.$transaction(async (tx) => {
      const from = await this.sites.location(ctx, dto.fromLocationId, { active: true }, tx);
      const to = await this.sites.location(ctx, dto.toLocationId, { active: true }, tx);
      if (from.siteId !== to.siteId) {
        throw new BadRequestException({
          code: 'STOCK_MOVE_OTHER_SITE',
          message: 'Un déplacement reste dans le site : utilisez un transfert entre sites.',
        });
      }
      return this.ledger.apply(tx, ctx, `move:${dto.idempotencyKey}`, [
        {
          variantId: dto.variantId,
          locationId: from.id,
          kind: 'MOVE_OUT',
          quantity: quantity.negated(),
          idempotencyKey: `move:${dto.idempotencyKey}:out`,
          sourceType: 'MANUAL',
          reason: `Vers ${to.code}`,
        },
        {
          variantId: dto.variantId,
          locationId: to.id,
          kind: 'MOVE_IN',
          quantity,
          idempotencyKey: `move:${dto.idempotencyKey}:in`,
          sourceType: 'MANUAL',
          reason: `Depuis ${from.code}`,
        },
      ]);
    });
    if (!result.replayed) {
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'stock.moved',
        targetType: 'StockVariant',
        targetId: dto.variantId,
        metadata: { quantity: quantity.toNumber() },
      });
    }
    return { replayed: result.replayed };
  }

  /** Registre des mouvements, du plus récent au plus ancien, paginé. */
  async movements(ctx: StockContext, query: StockMovementsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    if (query.siteId && !stockSiteAllowed(ctx, query.siteId))
      return { items: [], total: 0, page, pageSize };
    const where: Prisma.StockMovementWhereInput = {
      organizationId: ctx.organizationId,
      ...stockSiteWhere(ctx),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.productId ? { variant: { productId: query.productId } } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.stockMovement.count({ where }),
      this.db.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          kind: true,
          quantity: true,
          quantityAfter: true,
          reason: true,
          sourceType: true,
          sourceId: true,
          actorUserId: true,
          createdAt: true,
          site: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true } },
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: items.map((m) => ({
        ...m,
        quantity: m.quantity.toNumber(),
        quantityAfter: m.quantityAfter.toNumber(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
