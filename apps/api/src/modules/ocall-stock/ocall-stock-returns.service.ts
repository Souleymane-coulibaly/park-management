import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { stockReturnNumber } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type StockContext, stockSiteAllowed, stockSiteWhere } from './ocall-stock-access';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type { CreateStockSupplierReturnDto } from './ocall-stock.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Retours fournisseurs (S3) : sorties de stock tracées vers un fournisseur, avec motif, en ajout seul
 * (garanti par la base). Soumis à la politique de stock négatif ; une même demande envoyée deux fois n'est
 * enregistrée qu'une fois.
 */
@Injectable()
export class OcallStockReturnsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly sites: OcallStockSitesService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: StockContext, supplierId?: string) {
    const rows = await this.db.stockSupplierReturn.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...stockSiteWhere(ctx),
        ...(supplierId ? { supplierId } : {}),
      },
      orderBy: { number: 'desc' },
      take: 200,
      include: { supplier: { select: { id: true, name: true } }, lines: true },
    });
    const variants = await this.db.stockVariant.findMany({
      where: {
        organizationId: ctx.organizationId,
        id: { in: rows.flatMap((r) => r.lines.map((l) => l.variantId)) },
      },
      select: { id: true, name: true, sku: true, product: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      label: stockReturnNumber(r.number),
      supplier: r.supplier,
      siteId: r.siteId,
      orderId: r.orderId,
      reason: r.reason,
      createdAt: r.createdAt,
      lines: r.lines.map((l) => ({
        variant: variants.find((v) => v.id === l.variantId)!,
        locationId: l.locationId,
        quantity: l.quantity.toNumber(),
      })),
    }));
  }

  async create(ctx: StockContext, dto: CreateStockSupplierReturnDto) {
    const keys = dto.lines.map((l) => `${l.variantId}:${l.locationId}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException({
        code: 'STOCK_RETURN_DUPLICATE_LINE',
        message: 'Un article et un emplacement figurent une seule fois.',
      });
    }
    const result = await this.db.$transaction(async (tx) => {
      // Même clé : retour déjà enregistré (verrou consultatif : deux envois simultanés s'attendent).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:supplier-return:${dto.idempotencyKey}`}, 0))`;
      const existing = await tx.stockSupplierReturn.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ctx.organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, replayed: true };
      await this.sites.activeSite(ctx, dto.siteId, tx);
      const supplier = await tx.stockSupplier.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.supplierId } },
        select: { id: true },
      });
      if (!supplier)
        throw new NotFoundException({
          code: 'STOCK_SUPPLIER_NOT_FOUND',
          message: 'Fournisseur introuvable.',
        });
      if (dto.orderId) {
        const order = await tx.stockPurchaseOrder.findUnique({
          where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.orderId } },
          select: { supplierId: true },
        });
        if (!order || order.supplierId !== dto.supplierId) {
          throw new NotFoundException({
            code: 'STOCK_PURCHASE_NOT_FOUND',
            message: 'Commande introuvable pour ce fournisseur.',
          });
        }
      }
      for (const l of dto.lines) {
        const location = await this.sites.location(ctx, l.locationId, {}, tx);
        if (location.siteId !== dto.siteId) {
          throw new BadRequestException({
            code: 'STOCK_RETURN_SITE',
            message: 'La marchandise part du site du retour.',
          });
        }
      }
      const counter = await tx.stockNumberCounter.upsert({
        where: {
          organizationId_kind: { organizationId: ctx.organizationId, kind: 'SUPPLIER_RETURN' },
        },
        create: { organizationId: ctx.organizationId, kind: 'SUPPLIER_RETURN', value: 1 },
        update: { value: { increment: 1 } },
      });
      const created = await tx.stockSupplierReturn.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          supplierId: dto.supplierId,
          siteId: dto.siteId,
          orderId: dto.orderId ?? null,
          reason: dto.reason,
          idempotencyKey: dto.idempotencyKey,
          createdByUserId: ctx.userId,
          lines: {
            create: dto.lines.map((l) => ({
              variantId: l.variantId,
              locationId: l.locationId,
              quantity: D(l.quantity),
            })),
          },
        },
      });
      await this.ledger.apply(
        tx,
        ctx,
        `supplier-return:${created.id}`,
        dto.lines.map((l) => ({
          variantId: l.variantId,
          locationId: l.locationId,
          kind: 'SUPPLIER_RETURN' as const,
          quantity: D(l.quantity).negated(),
          idempotencyKey: `supplier-return:${created.id}:${l.variantId}:${l.locationId}`,
          sourceType: 'SUPPLIER_RETURN' as const,
          sourceId: created.id,
          reason: `${stockReturnNumber(created.number)} : ${dto.reason}`,
        })),
      );
      return { id: created.id, replayed: false };
    });
    if (!result.replayed) {
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'stock.supplier_return_created',
        targetType: 'StockSupplierReturn',
        targetId: result.id,
      });
    }
    const all = await this.list(ctx, dto.supplierId);
    return { ...all.find((r) => r.id === result.id)!, replayed: result.replayed };
  }

  /** Retour accessible (site du membre), pour les documents joints. */
  async assertAccessible(ctx: StockContext, id: string) {
    const r = await this.db.stockSupplierReturn.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: { siteId: true },
    });
    if (!r || !stockSiteAllowed(ctx, r.siteId)) {
      throw new NotFoundException({
        code: 'STOCK_RETURN_NOT_FOUND',
        message: 'Retour introuvable.',
      });
    }
  }
}
