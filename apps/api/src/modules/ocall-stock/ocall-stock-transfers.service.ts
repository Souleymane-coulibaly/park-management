import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { stockTransferNumber } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type StockContext, stockSiteAllowed } from './ocall-stock-access';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type {
  CreateStockTransferDto,
  DeclareStockTransferLossDto,
  PrepareStockTransferDto,
  ReceiveStockTransferDto,
  StockOperationsQueryDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;
type Status =
  'REQUESTED' | 'PREPARED' | 'SHIPPED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const NOT_FOUND = { code: 'STOCK_TRANSFER_NOT_FOUND', message: 'Transfert introuvable.' };
const OPEN: Status[] = ['REQUESTED', 'PREPARED', 'SHIPPED', 'PARTIALLY_RECEIVED'];

/**
 * Transferts entre sites (S2) : demandé → préparé (réservé à la source) → expédié (sorti de la source, en
 * transit) → reçu en une ou plusieurs fois, ou annulé avant l'expédition. Un manque se déclare à la
 * réception (casse, vol) : il clôt la ligne sans entrée. Chaque transition verrouille le transfert ;
 * une expédition ou une réception rejouée n'est jamais comptée deux fois.
 */
@Injectable()
export class OcallStockTransfersService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly sites: OcallStockSitesService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: StockContext, query: StockOperationsQueryDto) {
    const scope = ctx.siteIds
      ? { OR: [{ fromSiteId: { in: ctx.siteIds } }, { toSiteId: { in: ctx.siteIds } }] }
      : {};
    const rows = await this.db.stockTransfer.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...scope,
        ...(query.siteId
          ? { AND: [{ OR: [{ fromSiteId: query.siteId }, { toSiteId: query.siteId }] }] }
          : {}),
        ...(query.open ? { status: { in: OPEN } } : {}),
      },
      orderBy: { number: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        shippedAt: true,
        fromSite: { select: { id: true, code: true, name: true } },
        toSite: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
    return rows.map((t) => ({ ...t, label: stockTransferNumber(t.number) }));
  }

  async get(ctx: StockContext, id: string) {
    const t = await this.db.stockTransfer.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        fromSite: { select: { id: true, code: true, name: true } },
        toSite: { select: { id: true, code: true, name: true } },
        lines: { orderBy: { id: 'asc' } },
      },
    });
    if (!t || !(stockSiteAllowed(ctx, t.fromSiteId) || stockSiteAllowed(ctx, t.toSiteId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    const [variants, locations] = await Promise.all([
      this.db.stockVariant.findMany({
        where: { organizationId: ctx.organizationId, id: { in: t.lines.map((l) => l.variantId) } },
        select: {
          id: true,
          name: true,
          sku: true,
          product: { select: { id: true, name: true, unit: true } },
        },
      }),
      this.db.stockLocation.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: t.lines.map((l) => l.fromLocationId).filter((x): x is string => Boolean(x)) },
        },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      ...t,
      label: stockTransferNumber(t.number),
      lines: t.lines.map((l) => ({
        id: l.id,
        variant: variants.find((v) => v.id === l.variantId)!,
        quantity: l.quantity.toNumber(),
        fromLocation: locations.find((x) => x.id === l.fromLocationId) ?? null,
        shippedQuantity: l.shippedQuantity.toNumber(),
        receivedQuantity: l.receivedQuantity.toNumber(),
        lostQuantity: l.lostQuantity.toNumber(),
        inTransit: l.shippedQuantity.minus(l.receivedQuantity).minus(l.lostQuantity).toNumber(),
        lossReason: l.lossReason,
      })),
    };
  }

  async create(ctx: StockContext, dto: CreateStockTransferDto) {
    if (dto.fromSiteId === dto.toSiteId) {
      throw new BadRequestException({
        code: 'STOCK_TRANSFER_SAME_SITE',
        message: 'Choisissez deux sites différents.',
      });
    }
    const variantIds = dto.lines.map((l) => l.variantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException({
        code: 'STOCK_TRANSFER_DUPLICATE_LINE',
        message: 'Un article ne figure qu’une fois dans un transfert.',
      });
    }
    const created = await this.db.$transaction(async (tx) => {
      await this.sites.activeSite(ctx, dto.fromSiteId, tx);
      await this.activeDestination(ctx, dto.toSiteId, tx);
      const variants = await tx.stockVariant.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: variantIds },
          product: { isStockable: true },
        },
        select: { id: true },
      });
      if (variants.length !== variantIds.length) {
        throw new NotFoundException({
          code: 'STOCK_VARIANT_NOT_FOUND',
          message: 'Article introuvable ou non stocké.',
        });
      }
      const counter = await tx.stockNumberCounter.upsert({
        where: { organizationId_kind: { organizationId: ctx.organizationId, kind: 'TRANSFER' } },
        create: { organizationId: ctx.organizationId, kind: 'TRANSFER', value: 1 },
        update: { value: { increment: 1 } },
      });
      return tx.stockTransfer.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          fromSiteId: dto.fromSiteId,
          toSiteId: dto.toSiteId,
          note: dto.note ?? null,
          createdByUserId: ctx.userId,
          lines: {
            // organizationId déduit de la relation composite (organizationId, transferId).
            create: dto.lines.map((l) => ({
              variantId: l.variantId,
              quantity: D(l.quantity),
            })),
          },
        },
        select: { id: true },
      });
    });
    await this.record(ctx, 'stock.transfer_created', created.id);
    return this.get(ctx, created.id);
  }

  /** Préparation : emplacement de prélèvement par ligne, quantités réservées (plus disponibles ailleurs). */
  async prepare(ctx: StockContext, id: string, dto: PrepareStockTransferDto) {
    await this.db.$transaction(async (tx) => {
      const t = await this.lock(tx, ctx, id, ['REQUESTED'], 'from');
      const lines = await tx.stockTransferLine.findMany({
        where: { organizationId: ctx.organizationId, transferId: id },
      });
      const picks = new Map(dto.lines.map((p) => [p.lineId, p.fromLocationId]));
      if (picks.size !== lines.length || lines.some((l) => !picks.has(l.id))) {
        throw new BadRequestException({
          code: 'STOCK_TRANSFER_PICK_REQUIRED',
          message: 'Indiquez l’emplacement de prélèvement de chaque ligne.',
        });
      }
      for (const line of lines) {
        const location = await this.sites.location(ctx, picks.get(line.id)!, { active: true }, tx);
        if (location.siteId !== t.fromSiteId) {
          throw new BadRequestException({
            code: 'STOCK_TRANSFER_PICK_SITE',
            message: 'L’emplacement de prélèvement doit être dans le site de départ.',
          });
        }
        await this.ledger.reserve(
          tx,
          ctx.organizationId,
          line.variantId,
          location.id,
          line.quantity,
        );
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { fromLocationId: location.id },
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'PREPARED', preparedAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.transfer_prepared', id);
    return this.get(ctx, id);
  }

  /** Expédition : sortie de la source (réservation consommée), quantités en transit. Rejeu sans effet. */
  async ship(ctx: StockContext, id: string) {
    const shipped = await this.db.$transaction(async (tx) => {
      const t = await this.lock(
        tx,
        ctx,
        id,
        ['PREPARED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED'],
        'from',
      );
      if (t.status !== 'PREPARED') return false;
      const lines = await tx.stockTransferLine.findMany({
        where: { organizationId: ctx.organizationId, transferId: id },
      });
      await this.ledger.apply(
        tx,
        ctx,
        `transfer-ship:${id}`,
        lines.map((l) => ({
          variantId: l.variantId,
          locationId: l.fromLocationId!,
          kind: 'TRANSFER_OUT' as const,
          quantity: l.quantity.negated(),
          releaseReserved: l.quantity,
          idempotencyKey: `transfer:${l.id}:out`,
          sourceType: 'TRANSFER' as const,
          sourceId: id,
          reason: stockTransferNumber(t.number),
        })),
      );
      for (const l of lines) {
        await tx.stockTransferLine.update({
          where: { id: l.id },
          data: { shippedQuantity: l.quantity },
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'SHIPPED', shippedAt: new Date() },
      });
      return true;
    });
    if (shipped) await this.record(ctx, 'stock.transfer_shipped', id);
    return this.get(ctx, id);
  }

  /** Réception, complète ou partielle, rangée à l'emplacement choisi du site d'arrivée. */
  async receive(ctx: StockContext, id: string, dto: ReceiveStockTransferDto) {
    const received = await this.db.$transaction(async (tx) => {
      const t = await this.lock(tx, ctx, id, ['SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED'], 'to');
      // Rejeu (même clé) : la réception est déjà enregistrée, rien n'est recompté.
      const seen = await tx.stockMovement.count({
        where: {
          organizationId: ctx.organizationId,
          idempotencyKey: { startsWith: `transfer-in:${dto.idempotencyKey}:` },
        },
      });
      if (seen > 0) return false;
      if (t.status === 'RECEIVED') {
        throw new ConflictException({
          code: 'STOCK_TRANSFER_CLOSED',
          message: 'Transfert déjà entièrement reçu.',
        });
      }
      const lines = await tx.stockTransferLine.findMany({
        where: { organizationId: ctx.organizationId, transferId: id },
      });
      const entries = [];
      for (const r of dto.lines) {
        const line = lines.find((l) => l.id === r.lineId);
        if (!line)
          throw new NotFoundException({
            code: 'STOCK_TRANSFER_LINE_NOT_FOUND',
            message: 'Ligne introuvable.',
          });
        const remaining = line.shippedQuantity
          .minus(line.receivedQuantity)
          .minus(line.lostQuantity);
        if (D(r.quantity).greaterThan(remaining)) {
          throw new ConflictException({
            code: 'STOCK_TRANSFER_OVER_RECEIPT',
            message: `Quantité reçue supérieure à la quantité attendue (${remaining.toNumber()}).`,
          });
        }
        const location = await this.sites.location(ctx, r.toLocationId, { active: true }, tx);
        if (location.siteId !== t.toSiteId) {
          throw new BadRequestException({
            code: 'STOCK_TRANSFER_PUT_SITE',
            message: 'L’emplacement de rangement doit être dans le site d’arrivée.',
          });
        }
        entries.push({
          variantId: line.variantId,
          locationId: location.id,
          kind: 'TRANSFER_IN' as const,
          quantity: D(r.quantity),
          idempotencyKey: `transfer-in:${dto.idempotencyKey}:${line.id}`,
          sourceType: 'TRANSFER' as const,
          sourceId: id,
          reason: stockTransferNumber(t.number),
        });
        line.receivedQuantity = line.receivedQuantity.plus(r.quantity);
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { receivedQuantity: line.receivedQuantity },
        });
      }
      await this.ledger.apply(tx, ctx, `transfer-receive:${dto.idempotencyKey}`, entries);
      await this.close(tx, id, lines);
      return true;
    });
    if (received) await this.record(ctx, 'stock.transfer_received', id);
    return this.get(ctx, id);
  }

  /** Manque déclaré : le reste attendu de chaque ligne désignée est clos comme perdu (aucune entrée). */
  async declareLoss(ctx: StockContext, id: string, dto: DeclareStockTransferLossDto) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id, ['SHIPPED', 'PARTIALLY_RECEIVED'], 'to');
      const lines = await tx.stockTransferLine.findMany({
        where: { organizationId: ctx.organizationId, transferId: id },
      });
      for (const d of dto.lines) {
        const line = lines.find((l) => l.id === d.lineId);
        if (!line)
          throw new NotFoundException({
            code: 'STOCK_TRANSFER_LINE_NOT_FOUND',
            message: 'Ligne introuvable.',
          });
        const remaining = line.shippedQuantity
          .minus(line.receivedQuantity)
          .minus(line.lostQuantity);
        if (!remaining.isPositive()) {
          throw new ConflictException({
            code: 'STOCK_TRANSFER_LINE_CLOSED',
            message: 'Rien n’est plus attendu sur cette ligne.',
          });
        }
        line.lostQuantity = line.lostQuantity.plus(remaining);
        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: { lostQuantity: line.lostQuantity, lossReason: d.reason },
        });
      }
      await this.close(tx, id, lines);
    });
    await this.record(ctx, 'stock.transfer_loss_declared', id, { lines: dto.lines.length });
    return this.get(ctx, id);
  }

  /** Annulation avant expédition : les réservations d'un transfert préparé sont libérées. */
  async cancel(ctx: StockContext, id: string) {
    await this.db.$transaction(async (tx) => {
      const t = await this.lock(tx, ctx, id, ['REQUESTED', 'PREPARED'], 'from');
      if (t.status === 'PREPARED') {
        const lines = await tx.stockTransferLine.findMany({
          where: { organizationId: ctx.organizationId, transferId: id },
        });
        for (const l of lines) {
          await this.ledger.reserve(
            tx,
            ctx.organizationId,
            l.variantId,
            l.fromLocationId!,
            l.quantity.negated(),
          );
        }
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.transfer_cancelled', id);
    return this.get(ctx, id);
  }

  // ─── Outils ───

  /**
   * Transfert verrouillé, dans l'un des états admis ; le membre doit avoir accès au site de départ
   * (préparer, expédier, annuler) ou d'arrivée (réceptionner).
   */
  private async lock(
    tx: Tx,
    ctx: StockContext,
    id: string,
    allowed: Status[],
    side: 'from' | 'to',
  ) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StockTransfer"
      WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException(NOT_FOUND);
    const t = await tx.stockTransfer.findUniqueOrThrow({ where: { id } });
    const siteId = side === 'from' ? t.fromSiteId : t.toSiteId;
    if (!stockSiteAllowed(ctx, t.fromSiteId) && !stockSiteAllowed(ctx, t.toSiteId)) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (!stockSiteAllowed(ctx, siteId)) {
      throw new ForbiddenException({
        code: 'STOCK_SITE_FORBIDDEN',
        message: side === 'from' ? 'Réservé au site de départ.' : 'Réservé au site d’arrivée.',
      });
    }
    if (!allowed.includes(t.status)) {
      throw new ConflictException({
        code: 'STOCK_TRANSFER_STATUS',
        message: 'Action impossible dans l’état actuel du transfert.',
      });
    }
    return t;
  }

  /** Site d'arrivée : actif, de l'organisation (le demandeur n'a pas besoin d'y avoir accès). */
  private async activeDestination(ctx: StockContext, siteId: string, tx: Tx) {
    const site = await tx.stockSite.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: siteId } },
      select: { isArchived: true },
    });
    if (!site)
      throw new NotFoundException({ code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' });
    if (site.isArchived)
      throw new ConflictException({ code: 'STOCK_SITE_ARCHIVED', message: 'Site archivé.' });
  }

  /** Statut après une réception ou un manque : reçu quand plus rien n'est attendu. */
  private async close(
    tx: Tx,
    id: string,
    lines: {
      shippedQuantity: Prisma.Decimal;
      receivedQuantity: Prisma.Decimal;
      lostQuantity: Prisma.Decimal;
    }[],
  ) {
    const done = lines.every((l) =>
      l.receivedQuantity.plus(l.lostQuantity).equals(l.shippedQuantity),
    );
    await tx.stockTransfer.update({
      where: { id },
      data: done
        ? { status: 'RECEIVED', receivedAt: new Date() }
        : { status: 'PARTIALLY_RECEIVED' },
    });
  }

  private async record(
    ctx: StockContext,
    action: string,
    id: string,
    metadata?: Record<string, number>,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'StockTransfer',
      targetId: id,
      ...(metadata ? { metadata } : {}),
    });
  }
}
