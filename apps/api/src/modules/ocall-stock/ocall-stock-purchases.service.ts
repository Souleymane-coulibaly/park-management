import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_PURCHASE_STATUS_LABELS,
  formatStockMoney,
  formatStockQuantity,
  stockPurchaseNumber,
  stockReceiptNumber,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type StockContext,
  stockCan,
  stockSiteAllowed,
  stockSiteWhere,
} from './ocall-stock-access';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type {
  CancelStockReceiptDto,
  CreateStockPurchaseOrderDto,
  ReceiveStockPurchaseDto,
  StockPurchaseLineDto,
  StockPurchaseQueryDto,
  UpdateStockPurchaseOrderDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;
type Status = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const NOT_FOUND = { code: 'STOCK_PURCHASE_NOT_FOUND', message: 'Commande introuvable.' };
const OPEN: Status[] = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'];

/**
 * Achats (S3) : commandes fournisseurs (brouillon modifiable, puis commandée et figée — contrôlé par la
 * base), réceptions partielles ou complètes (entrées en stock par le moteur, idempotentes), annulation d'une
 * réception (sorties compensatoires, jamais de suppression), clôture d'un reste, historique des prix
 * d'achat. Les coûts ne sont montrés qu'avec le droit de voir les prix d'achat ; un magasinier réceptionne
 * sans les voir.
 */
@Injectable()
export class OcallStockPurchasesService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly sites: OcallStockSitesService,
    private readonly audit: AuditService,
  ) {}

  // ─── Commandes ───

  async list(ctx: StockContext, query: StockPurchaseQueryDto) {
    const rows = await this.db.stockPurchaseOrder.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...stockSiteWhere(ctx),
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.open ? { status: { in: OPEN } } : {}),
      },
      orderBy: { number: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        status: true,
        expectedAt: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        site: { select: { id: true, code: true, name: true } },
        lines: {
          select: { quantity: true, receivedQuantity: true, unitCost: true, vatRate: true },
        },
      },
    });
    const seeCost = stockCan(ctx, 'stock.prices.purchase.read');
    return rows.map(({ lines, ...o }) => ({
      ...o,
      label: stockPurchaseNumber(o.number),
      lineCount: lines.length,
      totalHt: seeCost ? totals(lines).ht : undefined,
      progress: lines.length
        ? lines.reduce((n, l) => n + l.receivedQuantity.toNumber(), 0) /
          lines.reduce((n, l) => n + l.quantity.toNumber(), 0)
        : 0,
    }));
  }

  async get(ctx: StockContext, id: string) {
    const order = await this.db.stockPurchaseOrder.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        supplier: {
          select: { id: true, name: true, phone: true, email: true, leadTimeDays: true },
        },
        site: { select: { id: true, code: true, name: true } },
        lines: { orderBy: { id: 'asc' } },
        receipts: {
          orderBy: { number: 'asc' },
          include: { lines: true },
        },
      },
    });
    if (!order || !stockSiteAllowed(ctx, order.siteId)) throw new NotFoundException(NOT_FOUND);
    const seeCost = stockCan(ctx, 'stock.prices.purchase.read');
    const variants = await this.db.stockVariant.findMany({
      where: {
        organizationId: ctx.organizationId,
        id: { in: order.lines.map((l) => l.variantId) },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        product: { select: { id: true, name: true, unit: true } },
      },
    });
    const locations = await this.db.stockLocation.findMany({
      where: {
        organizationId: ctx.organizationId,
        id: { in: order.receipts.flatMap((r) => r.lines.map((l) => l.locationId)) },
      },
      select: { id: true, code: true },
    });
    const t = totals(order.lines);
    return {
      id: order.id,
      label: stockPurchaseNumber(order.number),
      status: order.status,
      supplier: order.supplier,
      site: order.site,
      expectedAt: order.expectedAt,
      note: order.note,
      orderedAt: order.orderedAt,
      closedAt: order.closedAt,
      cancelledAt: order.cancelledAt,
      createdAt: order.createdAt,
      totals: seeCost ? t : undefined,
      lines: order.lines.map((l) => ({
        id: l.id,
        variant: variants.find((v) => v.id === l.variantId)!,
        quantity: l.quantity.toNumber(),
        receivedQuantity: l.receivedQuantity.toNumber(),
        remaining: l.quantity.minus(l.receivedQuantity).toNumber(),
        unitCost: seeCost ? l.unitCost : undefined,
        vatRate: l.vatRate,
      })),
      receipts: order.receipts.map((r) => ({
        id: r.id,
        label: stockReceiptNumber(r.number),
        status: r.status,
        deliveryRef: r.deliveryRef,
        createdAt: r.createdAt,
        cancelledAt: r.cancelledAt,
        cancelReason: r.cancelReason,
        lines: r.lines.map((l) => ({
          orderLineId: l.orderLineId,
          variantId: l.variantId,
          quantity: l.quantity.toNumber(),
          unitCost: seeCost ? l.unitCost : undefined,
          location: locations.find((x) => x.id === l.locationId) ?? null,
        })),
      })),
    };
  }

  async create(ctx: StockContext, dto: CreateStockPurchaseOrderDto) {
    this.assertSeeCosts(ctx);
    const created = await this.db.$transaction(async (tx) => {
      await this.assertSupplier(tx, ctx, dto.supplierId);
      await this.sites.activeSite(ctx, dto.siteId, tx);
      await this.assertLines(tx, ctx, dto.lines);
      const counter = await tx.stockNumberCounter.upsert({
        where: { organizationId_kind: { organizationId: ctx.organizationId, kind: 'PURCHASE' } },
        create: { organizationId: ctx.organizationId, kind: 'PURCHASE', value: 1 },
        update: { value: { increment: 1 } },
      });
      return tx.stockPurchaseOrder.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          supplierId: dto.supplierId,
          siteId: dto.siteId,
          expectedAt: dto.expectedAt ? new Date(`${dto.expectedAt}T00:00:00Z`) : null,
          note: dto.note ?? null,
          createdByUserId: ctx.userId,
          // organizationId déduit de la relation composite (organizationId, orderId).
          lines: {
            create: dto.lines.map((l) => ({
              variantId: l.variantId,
              quantity: D(l.quantity),
              unitCost: l.unitCost,
              vatRate: l.vatRate,
            })),
          },
        },
        select: { id: true },
      });
    });
    await this.record(ctx, 'stock.purchase_created', created.id);
    return this.get(ctx, created.id);
  }

  /** Brouillon seulement : fournisseur, site, date, note ; les lignes envoyées remplacent les anciennes. */
  async update(ctx: StockContext, id: string, dto: UpdateStockPurchaseOrderDto) {
    this.assertSeeCosts(ctx);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id, ['DRAFT']);
      if (dto.supplierId) await this.assertSupplier(tx, ctx, dto.supplierId);
      if (dto.siteId) await this.sites.activeSite(ctx, dto.siteId, tx);
      await tx.stockPurchaseOrder.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          siteId: dto.siteId,
          expectedAt:
            dto.expectedAt === undefined
              ? undefined
              : dto.expectedAt
                ? new Date(`${dto.expectedAt}T00:00:00Z`)
                : null,
          note: dto.note,
        },
      });
      if (dto.lines) {
        await this.assertLines(tx, ctx, dto.lines);
        await tx.stockPurchaseLine.deleteMany({
          where: { organizationId: ctx.organizationId, orderId: id },
        });
        await tx.stockPurchaseLine.createMany({
          data: dto.lines.map((l) => ({
            organizationId: ctx.organizationId,
            orderId: id,
            variantId: l.variantId,
            quantity: D(l.quantity),
            unitCost: l.unitCost,
            vatRate: l.vatRate,
          })),
        });
      }
    });
    await this.record(ctx, 'stock.purchase_updated', id);
    return this.get(ctx, id);
  }

  /** Passage de la commande : lignes figées (la base refuse ensuite toute modification). */
  async order(ctx: StockContext, id: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id, ['DRAFT']);
      await tx.stockPurchaseOrder.update({
        where: { id },
        data: { status: 'ORDERED', orderedAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.purchase_ordered', id);
    return this.get(ctx, id);
  }

  /** Clôture : le reste non livré n'est plus attendu. */
  async close(ctx: StockContext, id: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id, ['ORDERED', 'PARTIALLY_RECEIVED']);
      await tx.stockPurchaseOrder.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.purchase_closed', id);
    return this.get(ctx, id);
  }

  /** Annulation : seulement avant toute réception (sinon : annuler les réceptions, ou clore). */
  async cancel(ctx: StockContext, id: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id, ['DRAFT', 'ORDERED']);
      const received = await tx.stockReceipt.count({
        where: { organizationId: ctx.organizationId, orderId: id, status: 'VALIDATED' },
      });
      if (received > 0) {
        throw new ConflictException({
          code: 'STOCK_PURCHASE_HAS_RECEIPTS',
          message: 'Commande déjà reçue en partie : clôturez-la.',
        });
      }
      await tx.stockPurchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.purchase_cancelled', id);
    return this.get(ctx, id);
  }

  // ─── Réceptions ───

  /**
   * Réception d'une livraison : entrées en stock aux emplacements choisis du site de livraison, jamais au-delà
   * du reste commandé. Rejouée (même clé), elle n'est enregistrée qu'une fois.
   */
  async receive(ctx: StockContext, id: string, dto: ReceiveStockPurchaseDto) {
    if (dto.lines.some((l) => l.unitCost !== undefined)) this.assertSeeCosts(ctx);
    if (dto.updatePurchasePrices && !stockCan(ctx, 'stock.prices.manage')) {
      throw new ForbiddenException({
        code: 'STOCK_PRICE_FORBIDDEN',
        message: 'Vous ne pouvez pas modifier les prix.',
      });
    }
    if (new Set(dto.lines.map((l) => l.orderLineId)).size !== dto.lines.length) {
      throw new BadRequestException({
        code: 'STOCK_RECEIPT_DUPLICATE_LINE',
        message: 'Une ligne de commande figure une seule fois.',
      });
    }
    const result = await this.db.$transaction(async (tx) => {
      const order = await this.lock(tx, ctx, id, [
        'ORDERED',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'CLOSED',
        'CANCELLED',
        'DRAFT',
      ]);
      const existing = await tx.stockReceipt.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ctx.organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: { id: true, orderId: true },
      });
      if (existing) {
        if (existing.orderId !== id) {
          throw new ConflictException({
            code: 'STOCK_IDEMPOTENCY_CONFLICT',
            message: 'Clé déjà utilisée pour une autre commande.',
          });
        }
        return { receiptId: existing.id, replayed: true };
      }
      if (order.status !== 'ORDERED' && order.status !== 'PARTIALLY_RECEIVED') {
        throw new ConflictException({
          code: 'STOCK_PURCHASE_STATUS',
          message: 'Cette commande ne peut pas être réceptionnée.',
        });
      }
      const lines = await tx.stockPurchaseLine.findMany({
        where: { organizationId: ctx.organizationId, orderId: id },
      });
      const counter = await tx.stockNumberCounter.upsert({
        where: { organizationId_kind: { organizationId: ctx.organizationId, kind: 'RECEIPT' } },
        create: { organizationId: ctx.organizationId, kind: 'RECEIPT', value: 1 },
        update: { value: { increment: 1 } },
      });
      const receipt = await tx.stockReceipt.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          orderId: id,
          siteId: order.siteId,
          deliveryRef: dto.deliveryRef ?? null,
          idempotencyKey: dto.idempotencyKey,
          receivedByUserId: ctx.userId,
        },
      });
      const entries = [];
      for (const r of dto.lines) {
        const line = lines.find((l) => l.id === r.orderLineId);
        if (!line)
          throw new NotFoundException({
            code: 'STOCK_PURCHASE_LINE_NOT_FOUND',
            message: 'Ligne de commande introuvable.',
          });
        const remaining = line.quantity.minus(line.receivedQuantity);
        if (D(r.quantity).greaterThan(remaining)) {
          throw new ConflictException({
            code: 'STOCK_RECEIPT_OVER_ORDER',
            message: `Quantité reçue supérieure au reste commandé (${formatStockQuantity(remaining.toString())}).`,
          });
        }
        const location = await this.sites.location(ctx, r.locationId, { active: true }, tx);
        if (location.siteId !== order.siteId) {
          throw new BadRequestException({
            code: 'STOCK_RECEIPT_SITE',
            message: 'Rangez la marchandise dans le site de livraison.',
          });
        }
        const unitCost = r.unitCost ?? line.unitCost;
        await tx.stockReceiptLine.create({
          data: {
            organizationId: ctx.organizationId,
            receiptId: receipt.id,
            orderLineId: line.id,
            variantId: line.variantId,
            locationId: location.id,
            quantity: D(r.quantity),
            unitCost,
          },
        });
        await tx.stockPurchaseLine.update({
          where: { id: line.id },
          data: { receivedQuantity: line.receivedQuantity.plus(r.quantity) },
        });
        line.receivedQuantity = line.receivedQuantity.plus(r.quantity);
        await tx.stockSupplierPrice.create({
          data: {
            organizationId: ctx.organizationId,
            supplierId: order.supplierId,
            variantId: line.variantId,
            unitCost,
            receiptId: receipt.id,
          },
        });
        if (dto.updatePurchasePrices)
          await this.updatePurchasePrice(tx, ctx, line.variantId, unitCost);
        entries.push({
          variantId: line.variantId,
          locationId: location.id,
          kind: 'RECEIPT' as const,
          quantity: D(r.quantity),
          unitCost,
          idempotencyKey: `receipt:${receipt.id}:${line.id}`,
          sourceType: 'RECEIPT' as const,
          sourceId: receipt.id,
          reason: `${stockReceiptNumber(receipt.number)} · ${stockPurchaseNumber(order.number)}`,
        });
      }
      await this.ledger.apply(tx, ctx, `receipt:${receipt.id}`, entries);
      await tx.stockPurchaseOrder.update({
        where: { id },
        data: { status: progressStatus(lines) },
      });
      return { receiptId: receipt.id, replayed: false };
    });
    if (!result.replayed)
      await this.record(ctx, 'stock.receipt_validated', id, { receiptId: result.receiptId });
    return { ...(await this.get(ctx, id)), receiptId: result.receiptId, replayed: result.replayed };
  }

  /**
   * Annulation d'une réception (erreur de saisie, mauvaise livraison) : sorties compensatoires aux mêmes
   * emplacements — refusées si la marchandise n'y est plus, sauf stock négatif autorisé. Rien n'est supprimé.
   */
  async cancelReceipt(ctx: StockContext, receiptId: string, dto: CancelStockReceiptDto) {
    const orderId = await this.db.$transaction(async (tx) => {
      const head = await tx.stockReceipt.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: receiptId } },
        select: { orderId: true },
      });
      if (!head)
        throw new NotFoundException({
          code: 'STOCK_RECEIPT_NOT_FOUND',
          message: 'Réception introuvable.',
        });
      const order = await this.lock(tx, ctx, head.orderId, [
        'ORDERED',
        'PARTIALLY_RECEIVED',
        'RECEIVED',
        'CLOSED',
      ]);
      const receipt = await tx.stockReceipt.findUniqueOrThrow({
        where: { id: receiptId },
        include: { lines: true },
      });
      if (receipt.status !== 'VALIDATED') {
        throw new ConflictException({
          code: 'STOCK_RECEIPT_CANCELLED',
          message: 'Réception déjà annulée.',
        });
      }
      await this.ledger.apply(
        tx,
        ctx,
        `receipt-cancel:${receipt.id}`,
        receipt.lines.map((l) => ({
          variantId: l.variantId,
          locationId: l.locationId,
          kind: 'RECEIPT_CANCEL' as const,
          quantity: l.quantity.negated(),
          idempotencyKey: `receipt-cancel:${receipt.id}:${l.orderLineId}`,
          sourceType: 'RECEIPT' as const,
          sourceId: receipt.id,
          reason: `Annulation ${stockReceiptNumber(receipt.number)} : ${dto.reason}`,
        })),
      );
      const lines = await tx.stockPurchaseLine.findMany({
        where: { organizationId: ctx.organizationId, orderId: order.id },
      });
      for (const l of receipt.lines) {
        const line = lines.find((x) => x.id === l.orderLineId)!;
        line.receivedQuantity = line.receivedQuantity.minus(l.quantity);
        await tx.stockPurchaseLine.update({
          where: { id: line.id },
          data: { receivedQuantity: line.receivedQuantity },
        });
      }
      await tx.stockReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'CANCELLED',
          cancelReason: dto.reason,
          cancelledAt: new Date(),
          cancelledByUserId: ctx.userId,
        },
      });
      // Une commande close le reste ; sinon, son état suit ce qui reste reçu.
      if (order.status !== 'CLOSED') {
        await tx.stockPurchaseOrder.update({
          where: { id: order.id },
          data: { status: progressStatus(lines) },
        });
      }
      return order.id;
    });
    await this.record(ctx, 'stock.receipt_cancelled', orderId, { receiptId });
    return this.get(ctx, orderId);
  }

  // ─── Prix d'achat ───

  /** Historique des coûts reçus d'une variante, par fournisseur (plus récent d'abord). */
  async purchasePrices(ctx: StockContext, variantId: string) {
    const variant = await this.db.stockVariant.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: variantId } },
      select: { id: true },
    });
    if (!variant) {
      throw new NotFoundException({
        code: 'STOCK_VARIANT_NOT_FOUND',
        message: 'Variante introuvable.',
      });
    }
    const rows = await this.db.stockSupplierPrice.findMany({
      where: { organizationId: ctx.organizationId, variantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        unitCost: true,
        createdAt: true,
        receiptId: true,
        supplier: { select: { id: true, name: true } },
      },
    });
    return rows;
  }

  // ─── Bon de commande PDF ───

  async pdf(ctx: StockContext, id: string): Promise<Buffer> {
    this.assertSeeCosts(ctx);
    const o = await this.get(ctx, id);
    const [settings, organization] = await Promise.all([
      this.db.stockSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      this.core.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true, currency: true },
      }),
    ]);
    const money = (v: number) => formatStockMoney(v, organization.currency);
    return renderPdfDocument(
      { title: `Bon de commande ${o.label}`, creator: 'Ocall Stock' },
      (doc) => {
        doc.addPage();
        doc.font('sansBold').fontSize(16).fillColor('#000000').text(`Bon de commande ${o.label}`);
        doc.font('sans').fontSize(9).fillColor('#444444');
        doc.text(`${settings?.storeName ?? organization.name} — livraison : ${o.site.name}`);
        doc.text(
          `Fournisseur : ${o.supplier.name}${o.supplier.phone ? ` · ${o.supplier.phone}` : ''}`,
        );
        doc.text(
          `État : ${STOCK_PURCHASE_STATUS_LABELS[o.status]}${o.expectedAt ? ` · livraison attendue le ${o.expectedAt.toISOString().slice(0, 10)}` : ''}`,
        );
        if (o.note) doc.text(o.note);
        doc.moveDown();
        const cols = [70, 185, 55, 75, 40, 90];
        const row = (cells: string[], bold = false) => {
          if (doc.y > PDF_PAGE.height - PDF_PAGE.margin - 30) doc.addPage();
          const y = doc.y;
          let x = PDF_PAGE.margin;
          doc
            .font(bold ? 'sansBold' : 'sans')
            .fontSize(8)
            .fillColor('#000000');
          cells.forEach((text, i) => {
            doc.text(text, x, y, {
              width: cols[i]! - 4,
              align: i >= 2 ? 'right' : 'left',
              lineBreak: false,
              ellipsis: true,
            });
            x += cols[i]!;
          });
          doc.moveDown(0.6);
          doc.x = PDF_PAGE.margin;
        };
        row(['Référence', 'Désignation', 'Quantité', 'Prix HT', 'TVA', 'Total HT'], true);
        doc
          .moveTo(PDF_PAGE.margin, doc.y)
          .lineTo(PDF_PAGE.margin + PDF_CONTENT_WIDTH, doc.y)
          .stroke('#999999');
        doc.moveDown(0.3);
        for (const l of o.lines) {
          row([
            l.variant.sku,
            l.variant.name
              ? `${l.variant.product.name} — ${l.variant.name}`
              : l.variant.product.name,
            formatStockQuantity(l.quantity),
            money(l.unitCost!),
            `${l.vatRate} %`,
            money(Math.round(l.quantity * l.unitCost!)),
          ]);
        }
        doc.moveDown();
        doc.font('sansBold').fontSize(9);
        doc.text(`Total HT : ${money(o.totals!.ht)}`, { align: 'right' });
        doc.text(`TVA : ${money(o.totals!.vat)}`, { align: 'right' });
        doc.text(`Total TTC : ${money(o.totals!.ttc)}`, { align: 'right' });
      },
    );
  }

  // ─── Outils ───

  /** Commande verrouillée, dans un état admis, sur un site accessible. */
  private async lock(tx: Tx, ctx: StockContext, id: string, allowed: Status[]) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StockPurchaseOrder"
      WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException(NOT_FOUND);
    const order = await tx.stockPurchaseOrder.findUniqueOrThrow({ where: { id } });
    if (!stockSiteAllowed(ctx, order.siteId)) throw new NotFoundException(NOT_FOUND);
    if (!allowed.includes(order.status)) {
      throw new ConflictException({
        code: 'STOCK_PURCHASE_STATUS',
        message: 'Action impossible dans l’état actuel de la commande.',
      });
    }
    return order;
  }

  private async assertSupplier(tx: Tx, ctx: StockContext, supplierId: string) {
    const supplier = await tx.stockSupplier.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: supplierId } },
      select: { isArchived: true },
    });
    if (!supplier || supplier.isArchived) {
      throw new NotFoundException({
        code: 'STOCK_SUPPLIER_NOT_FOUND',
        message: 'Fournisseur introuvable ou archivé.',
      });
    }
  }

  private async assertLines(tx: Tx, ctx: StockContext, lines: StockPurchaseLineDto[]) {
    const ids = lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'STOCK_PURCHASE_DUPLICATE_LINE',
        message: 'Un article figure une seule fois par commande.',
      });
    }
    const found = await tx.stockVariant.count({
      where: {
        organizationId: ctx.organizationId,
        id: { in: ids },
        product: { isStockable: true },
      },
    });
    if (found !== ids.length) {
      throw new NotFoundException({
        code: 'STOCK_VARIANT_NOT_FOUND',
        message: 'Article introuvable ou non stocké.',
      });
    }
  }

  /** Prix d'achat de l'article (variante par défaut) ou de la déclinaison, avec son historique. */
  private async updatePurchasePrice(
    tx: Tx,
    ctx: StockContext,
    variantId: string,
    unitCost: number,
  ) {
    const variant = await tx.stockVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: {
        isDefault: true,
        purchasePrice: true,
        product: { select: { id: true, purchasePrice: true } },
      },
    });
    const old = variant.isDefault ? variant.product.purchasePrice : variant.purchasePrice;
    if (old === unitCost) return;
    if (variant.isDefault) {
      await tx.stockProduct.update({
        where: { id: variant.product.id },
        data: { purchasePrice: unitCost },
      });
    } else {
      await tx.stockVariant.update({ where: { id: variantId }, data: { purchasePrice: unitCost } });
    }
    await tx.stockPriceHistory.create({
      data: {
        organizationId: ctx.organizationId,
        variantId,
        kind: 'PURCHASE',
        oldPrice: old,
        newPrice: unitCost,
        changedByUserId: ctx.userId,
      },
    });
  }

  private assertSeeCosts(ctx: StockContext) {
    if (!stockCan(ctx, 'stock.prices.purchase.read')) {
      throw new ForbiddenException({
        code: 'STOCK_PRICE_FORBIDDEN',
        message: 'Les coûts d’achat sont réservés aux personnes autorisées.',
      });
    }
  }

  private async record(
    ctx: StockContext,
    action: string,
    id: string,
    metadata?: Record<string, string>,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType: 'StockPurchaseOrder',
      targetId: id,
      ...(metadata ? { metadata } : {}),
    });
  }
}

/** Totaux d'une commande : HT, TVA, TTC (arrondis à l'unité de la devise). */
function totals(lines: { quantity: Prisma.Decimal; unitCost: number; vatRate: number }[]) {
  let ht = 0;
  let vat = 0;
  for (const l of lines) {
    const lineHt = Math.round(l.quantity.toNumber() * l.unitCost);
    ht += lineHt;
    vat += Math.round((lineHt * l.vatRate) / 100);
  }
  return { ht, vat, ttc: ht + vat };
}

/** État d'une commande d'après les quantités reçues. */
function progressStatus(
  lines: { quantity: Prisma.Decimal; receivedQuantity: Prisma.Decimal }[],
): Status {
  if (lines.every((l) => l.receivedQuantity.equals(l.quantity))) return 'RECEIVED';
  if (lines.some((l) => l.receivedQuantity.isPositive())) return 'PARTIALLY_RECEIVED';
  return 'ORDERED';
}
