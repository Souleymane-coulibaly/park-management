import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  type PaperWidth,
  STOCK_DEFAULT_MAX_DISCOUNT_PERCENT,
  encodeReceiptLines,
  formatStockQuantity,
  layoutStockReceipt,
  previewLines,
  stockCheckPayments,
  stockDiscountError,
  stockLineAmounts,
  stockRefundAmount,
  stockSaleNumber,
  stockSaleReturnNumber,
  toBase64,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { stockEffectivePrice, stockSitePrices } from './ocall-stock-site-prices';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type StockContext,
  stockCanAt,
  stockSiteAllowed,
  stockSiteWhere,
} from './ocall-stock-access';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { renderStockReceiptPdf } from './ocall-stock-receipt-pdf';
import { OcallStockRegistersService } from './ocall-stock-registers.service';
import type {
  CreateStockSaleDto,
  CreateStockSaleReturnDto,
  StockSaleQueryDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const NOT_FOUND = { code: 'STOCK_SALE_NOT_FOUND', message: 'Vente introuvable.' };

/** Article proposé en caisse : prix TTC, TVA et quantité disponible à l'emplacement de la caisse. */
export interface StockPosItem {
  variantId: string;
  productId: string;
  label: string;
  sku: string;
  unit: string;
  unitPrice: number;
  vatRate: number;
  isStockable: boolean;
  /** Disponible (en stock − réservé) à l'emplacement de la caisse ; null pour un article non stocké. */
  available: number | null;
}

/**
 * Ventes en caisse (S4). L'encaissement est une seule transaction : session ouverte de la caisse (verrou
 * partagé : la clôture attend), prix relus dans le catalogue (jamais fournis par la caisse), remises selon
 * les droits et le plafond, paiements contrôlés (somme = total, monnaie en espèces seulement), sorties de
 * stock par le moteur (clé `stock-sale:<vente>:<ligne>`). Rejouée avec la même clé, une vente n'est
 * enregistrée qu'une fois. Mobile money et carte sont saisis à la main : aucune confirmation simulée.
 */
@Injectable()
export class OcallStockSalesService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly registers: OcallStockRegistersService,
    private readonly catalog: OcallStockCatalogService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: StockContext, dto: CreateStockSaleDto) {
    const settings = await this.db.stockSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { maxDiscountPercent: true },
    });
    const maxPercent = settings?.maxDiscountPercent ?? STOCK_DEFAULT_MAX_DISCOUNT_PERCENT;
    const cashier = await this.core.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true },
    });
    const result = await this.db.$transaction(async (tx) => {
      // Deux envois simultanés de la même vente s'attendent ; le second la retrouve.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:sale:${dto.idempotencyKey}`}, 0))`;
      const existing = await tx.stockSale.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ctx.organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, replayed: true };

      const register = await this.registers.register(ctx, dto.registerId, tx);
      // Remises selon le rôle du membre sur le site de la caisse (rôle par site, Sprint Suite 2A).
      const rules = {
        canDiscount: stockCanAt(ctx, 'stock.sales.discount', register.siteId),
        unlimited: stockCanAt(ctx, 'stock.sales.discount.unlimited', register.siteId),
        maxPercent,
      };
      const session = await this.registers.openSession(tx, ctx, register.id, 'share');
      if (!session) {
        throw new ConflictException({
          code: 'STOCK_CASH_SESSION_REQUIRED',
          message: 'Ouvrez la caisse avant d’encaisser.',
        });
      }
      if (dto.customerId) await this.assertCustomer(tx, ctx, dto.customerId);

      const variants = await tx.stockVariant.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: [...new Set(dto.lines.map((l) => l.variantId))] },
        },
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              salePrice: true,
              vatRate: true,
              isStockable: true,
              isArchived: true,
            },
          },
        },
      });
      // Prix de la boutique de la caisse (S10) : exception de la boutique, sinon prix commun.
      const sitePrices = await stockSitePrices(
        tx,
        ctx.organizationId,
        register.siteId,
        variants.map((v) => v.id),
      );
      const lines = dto.lines.map((l) => {
        const v = variants.find((x) => x.id === l.variantId);
        if (!v) {
          throw new NotFoundException({
            code: 'STOCK_VARIANT_NOT_FOUND',
            message: 'Article introuvable.',
          });
        }
        if (v.isArchived || v.product.isArchived) {
          throw new ConflictException({
            code: 'STOCK_VARIANT_ARCHIVED',
            message: `${v.product.name} est archivé : il ne se vend plus.`,
          });
        }
        const unitPrice = stockEffectivePrice(sitePrices, v);
        const discount = l.discount ?? 0;
        const amounts = stockLineAmounts(l.quantity, unitPrice, v.product.vatRate, discount);
        const refused = stockDiscountError(discount, amounts.gross, rules);
        if (refused) {
          throw rules.canDiscount
            ? new BadRequestException({ code: 'STOCK_DISCOUNT_REFUSED', message: refused })
            : new ForbiddenException({ code: 'STOCK_DISCOUNT_FORBIDDEN', message: refused });
        }
        return {
          id: randomUUID(),
          variantId: v.id,
          sku: v.sku,
          label: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
          isStockable: v.product.isStockable,
          quantity: D(l.quantity),
          unitPrice,
          vatRate: v.product.vatRate,
          discount,
          total: amounts.total,
          vatAmount: amounts.vat,
          gross: amounts.gross,
        };
      });
      const gross = lines.reduce((n, l) => n + l.gross, 0);
      const discountTotal = lines.reduce((n, l) => n + l.discount, 0);
      const total = gross - discountTotal;
      const vatTotal = lines.reduce((n, l) => n + l.vatAmount, 0);
      const paid = stockCheckPayments(total, dto.payments);
      if (paid.error !== null) {
        throw new BadRequestException({ code: 'STOCK_PAYMENT_INVALID', message: paid.error });
      }

      const counter = await tx.stockNumberCounter.upsert({
        where: { organizationId_kind: { organizationId: ctx.organizationId, kind: 'SALE' } },
        create: { organizationId: ctx.organizationId, kind: 'SALE', value: 1 },
        update: { value: { increment: 1 } },
      });
      const sale = await tx.stockSale.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          registerId: register.id,
          sessionId: session.id,
          siteId: register.siteId,
          locationId: register.locationId,
          customerId: dto.customerId ?? null,
          cashierUserId: ctx.userId,
          cashierName: `${cashier.firstName} ${cashier.lastName}`.trim(),
          grossTotal: gross,
          discountTotal,
          total,
          vatTotal,
          changeGiven: paid.change,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      await tx.stockSaleLine.createMany({
        data: lines.map(({ gross: _gross, ...l }) => ({
          ...l,
          organizationId: ctx.organizationId,
          saleId: sale.id,
        })),
      });
      await tx.stockPayment.createMany({
        data: dto.payments.map((p) => ({
          organizationId: ctx.organizationId,
          saleId: sale.id,
          sessionId: session.id,
          method: p.method,
          amount: p.amount,
          tendered: p.method === 'CASH' ? (p.tendered ?? null) : null,
          reference: p.reference ?? null,
        })),
      });
      const label = stockSaleNumber(sale.number);
      await this.ledger.apply(
        tx,
        ctx,
        `stock-sale:${sale.id}`,
        lines
          .filter((l) => l.isStockable)
          .map((l) => ({
            variantId: l.variantId,
            locationId: register.locationId,
            kind: 'SALE' as const,
            quantity: l.quantity.negated(),
            idempotencyKey: `stock-sale:${sale.id}:${l.id}`,
            sourceType: 'SALE' as const,
            sourceId: sale.id,
            reason: label,
          })),
      );
      return { id: sale.id, replayed: false, total, discountTotal };
    });
    if (!result.replayed) {
      await this.record(ctx, 'stock.sale_created', 'StockSale', result.id, {
        total: String(result.total),
        discountTotal: String(result.discountTotal),
      });
    }
    return { ...(await this.get(ctx, result.id)), replayed: result.replayed };
  }

  // ─── Articles en caisse ───

  /** Recherche en caisse (nom, référence, code-barres ; tolère les fautes) : articles vendables. */
  async posSearch(ctx: StockContext, registerId: string, q: string): Promise<StockPosItem[]> {
    const register = await this.registers.register(ctx, registerId);
    const ids = q.trim()
      ? await this.catalog.searchProductIds(ctx.organizationId, q.trim(), 24)
      : [];
    const items = await this.posItems(ctx, register, { productId: { in: ids } });
    return items.sort((x, y) => ids.indexOf(x.productId) - ids.indexOf(y.productId));
  }

  /** Lecture d'un code en caisse : la variante exacte du code-barres ou de la référence. */
  async posScan(ctx: StockContext, registerId: string, code: string) {
    const register = await this.registers.register(ctx, registerId);
    const found = await this.catalog.lookup(ctx, code);
    if (!found.found) return { found: false as const, code: found.code };
    if (found.variant.isArchived || found.product.isArchived) {
      return { found: false as const, code: found.code, archived: true };
    }
    const [item] = await this.posItems(ctx, register, { id: found.variant.id }, true);
    return item
      ? { found: true as const, code: found.code, item }
      : { found: false as const, code };
  }

  /** Articles d'un panier repris : prix et disponibilités relus au moment de la reprise. */
  async posItemsFor(ctx: StockContext, registerId: string, variantIds: string[]) {
    const register = await this.registers.register(ctx, registerId);
    return this.posItems(ctx, register, { id: { in: variantIds } }, true);
  }

  private async posItems(
    ctx: StockContext,
    register: { siteId: string; locationId: string },
    where: Prisma.StockVariantWhereInput,
    exact = false,
  ): Promise<StockPosItem[]> {
    const variants = await this.db.stockVariant.findMany({
      where: {
        organizationId: ctx.organizationId,
        isArchived: false,
        product: { isArchived: false },
        ...where,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
            salePrice: true,
            vatRate: true,
            isStockable: true,
            _count: { select: { variants: { where: { isDefault: false, isArchived: false } } } },
          },
        },
      },
      take: 100,
    });
    // Un article à déclinaisons se vend par déclinaison (sa variante par défaut n'est pas proposée).
    const sellable = exact
      ? variants
      : variants.filter((v) => !(v.isDefault && v.product._count.variants > 0));
    const levels = await this.db.stockLevel.findMany({
      where: {
        organizationId: ctx.organizationId,
        locationId: register.locationId,
        variantId: { in: sellable.map((v) => v.id) },
      },
      select: { variantId: true, onHand: true, reserved: true },
    });
    const sitePrices = await stockSitePrices(
      this.db,
      ctx.organizationId,
      register.siteId,
      sellable.map((v) => v.id),
    );
    return sellable.map((v) => {
      const level = levels.find((l) => l.variantId === v.id);
      return {
        variantId: v.id,
        productId: v.product.id,
        label: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
        sku: v.sku,
        unit: v.product.unit,
        unitPrice: stockEffectivePrice(sitePrices, v),
        vatRate: v.product.vatRate,
        isStockable: v.product.isStockable,
        available: v.product.isStockable
          ? level
            ? level.onHand.minus(level.reserved).toNumber()
            : 0
          : null,
      };
    });
  }

  // ─── Historique ───

  async list(ctx: StockContext, query: StockSaleQueryDto) {
    const number = query.q ? Number(query.q.replace(/^VTE-?/i, '')) : null;
    if (query.q && (!Number.isInteger(number) || number! <= 0)) return [];
    const rows = await this.db.stockSale.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...stockSiteWhere(ctx),
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(number ? { number } : {}),
      },
      orderBy: { number: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        total: true,
        discountTotal: true,
        createdAt: true,
        cashierName: true,
        register: { select: { code: true, name: true } },
        customer: { select: { id: true, name: true } },
        payments: { where: { returnId: null }, select: { method: true } },
        _count: { select: { returns: true } },
      },
    });
    return rows.map(({ payments, _count, ...s }) => ({
      ...s,
      label: stockSaleNumber(s.number),
      methods: [...new Set(payments.map((p) => p.method))],
      returnsCount: _count.returns,
    }));
  }

  async get(ctx: StockContext, id: string) {
    const sale = await this.db.stockSale.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        register: {
          select: {
            id: true,
            code: true,
            name: true,
            paperWidth: true,
            printerConnection: true,
            printerAddress: true,
          },
        },
        customer: { select: { id: true, name: true, phone: true } },
        lines: { orderBy: { id: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        returns: { orderBy: { number: 'asc' }, include: { lines: true } },
      },
    });
    if (!sale || !stockSiteAllowed(ctx, sale.siteId)) throw new NotFoundException(NOT_FOUND);
    return {
      ...sale,
      label: stockSaleNumber(sale.number),
      lines: sale.lines.map((l) => ({
        ...l,
        quantity: l.quantity.toNumber(),
        returnedQuantity: l.returnedQuantity.toNumber(),
      })),
      returns: sale.returns.map((r) => ({
        ...r,
        label: stockSaleReturnNumber(r.number),
        lines: r.lines.map((l) => ({ ...l, quantity: l.quantity.toNumber() })),
      })),
    };
  }

  // ─── Ticket ───

  /**
   * Ticket : lignes d'aperçu, flux ESC/POS en base64 pour l'imprimante de la caisse, largeur de papier.
   * `duplicate` : réimpression comptée et tracée, avec la mention DUPLICATA.
   */
  async receipt(
    ctx: StockContext,
    id: string,
    opts: { width?: 58 | 80; duplicate?: boolean } = {},
  ) {
    const sale = await this.get(ctx, id);
    if (opts.duplicate) {
      await this.db.stockSale.update({
        where: { id },
        data: { reprintCount: { increment: 1 } },
      });
      await this.record(ctx, 'stock.sale_reprinted', 'StockSale', id);
    }
    const width = (opts.width ?? sale.register.paperWidth) as PaperWidth;
    const lines = layoutStockReceipt(
      await this.receiptData(ctx, sale, Boolean(opts.duplicate)),
      width,
    );
    return {
      paperWidth: width,
      printer: {
        connection: sale.register.printerConnection,
        address: sale.register.printerAddress,
      },
      preview: previewLines(lines, width),
      data: toBase64(encodeReceiptLines(lines)),
    };
  }

  async receiptPdf(ctx: StockContext, id: string, width?: 58 | 80) {
    const sale = await this.get(ctx, id);
    const paper = (width ?? sale.register.paperWidth) as PaperWidth;
    const lines = layoutStockReceipt(await this.receiptData(ctx, sale, false), paper);
    return {
      fileName: `ticket-${sale.label}.pdf`,
      body: await renderStockReceiptPdf(lines, paper, `Ticket ${sale.label}`),
    };
  }

  private async receiptData(
    ctx: StockContext,
    sale: Awaited<ReturnType<OcallStockSalesService['get']>>,
    duplicate: boolean,
  ) {
    const [settings, organization] = await Promise.all([
      this.db.stockSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      this.core.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true, currency: true, timezone: true },
      }),
    ]);
    return {
      storeName: settings?.storeName ?? organization.name,
      address: settings?.receiptAddress ?? null,
      phone: settings?.receiptPhone ?? null,
      footer: settings?.receiptFooter ?? null,
      currency: organization.currency,
      timezone: organization.timezone,
      saleLabel: sale.label,
      date: sale.createdAt.toISOString(),
      registerName: sale.register.name,
      cashierName: sale.cashierName,
      customerName: sale.customer?.name ?? null,
      lines: sale.lines.map((l) => ({
        label: l.label,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        total: l.total,
        vatRate: l.vatRate,
        vatAmount: l.vatAmount,
      })),
      grossTotal: sale.grossTotal,
      discountTotal: sale.discountTotal,
      total: sale.total,
      payments: sale.payments
        .filter((p) => !p.returnId)
        .map((p) => ({
          method: p.method,
          amount: p.amount,
          tendered: p.tendered,
          reference: p.reference,
        })),
      changeGiven: sale.changeGiven,
      duplicate,
    };
  }

  // ─── Retours ───

  /**
   * Retour client : quantités rendues (jamais plus que vendu, retours précédents déduits), remboursement au
   * prorata du montant payé dans la session ouverte d'une caisse du même site ; marchandise remise en stock
   * à l'emplacement de la vente, sauf si elle est défectueuse. Rejoué (même clé), il n'est fait qu'une fois.
   */
  async createReturn(ctx: StockContext, saleId: string, dto: CreateStockSaleReturnDto) {
    if (new Set(dto.lines.map((l) => l.saleLineId)).size !== dto.lines.length) {
      throw new BadRequestException({
        code: 'STOCK_RETURN_DUPLICATE_LINE',
        message: 'Une ligne de vente figure une seule fois.',
      });
    }
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ctx.organizationId}:sale-return:${dto.idempotencyKey}`}, 0))`;
      const existing = await tx.stockSaleReturn.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ctx.organizationId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        select: { id: true, saleId: true },
      });
      if (existing) {
        if (existing.saleId !== saleId) {
          throw new ConflictException({
            code: 'STOCK_IDEMPOTENCY_CONFLICT',
            message: 'Clé déjà utilisée pour une autre vente.',
          });
        }
        return { id: existing.id, replayed: true, refund: 0 };
      }
      const sale = await tx.stockSale.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: saleId } },
        select: { id: true, number: true, siteId: true, locationId: true },
      });
      if (!sale || !stockSiteAllowed(ctx, sale.siteId)) throw new NotFoundException(NOT_FOUND);
      const register = await this.registers.register(ctx, dto.registerId, tx);
      if (register.siteId !== sale.siteId) {
        throw new BadRequestException({
          code: 'STOCK_RETURN_SITE',
          message: 'Le retour se fait dans une caisse du magasin de la vente.',
        });
      }
      const session = await this.registers.openSession(tx, ctx, register.id, 'share');
      if (!session) {
        throw new ConflictException({
          code: 'STOCK_CASH_SESSION_REQUIRED',
          message: 'Ouvrez la caisse avant de rembourser.',
        });
      }
      // Lignes verrouillées : deux retours simultanés de la même vente ne rendent pas plus que vendu.
      const saleLines = await tx.$queryRaw<
        {
          id: string;
          variantId: string;
          isStockable: boolean;
          quantity: Prisma.Decimal;
          total: number;
          returnedQuantity: Prisma.Decimal;
          refundedAmount: number;
        }[]
      >`SELECT "id", "variantId", "isStockable", "quantity", "total", "returnedQuantity", "refundedAmount"
        FROM "StockSaleLine"
        WHERE "organizationId" = ${ctx.organizationId}::uuid AND "saleId" = ${saleId}::uuid
        ORDER BY "id" FOR UPDATE`;
      const planned = dto.lines.map((r) => {
        const line = saleLines.find((l) => l.id === r.saleLineId);
        if (!line) {
          throw new NotFoundException({
            code: 'STOCK_SALE_LINE_NOT_FOUND',
            message: 'Ligne de vente introuvable.',
          });
        }
        const remaining = D(line.quantity).minus(line.returnedQuantity);
        if (D(r.quantity).greaterThan(remaining)) {
          throw new ConflictException({
            code: 'STOCK_RETURN_OVER_SALE',
            message: `Quantité retournée supérieure à la quantité vendue restante (${formatStockQuantity(remaining.toString())}).`,
          });
        }
        const amount = stockRefundAmount(
          {
            quantity: D(line.quantity).toNumber(),
            total: line.total,
            returnedQuantity: D(line.returnedQuantity).toNumber(),
            refundedAmount: line.refundedAmount,
          },
          r.quantity,
        );
        return { line, quantity: D(r.quantity), amount };
      });
      const refund = planned.reduce((n, p) => n + p.amount, 0);
      const counter = await tx.stockNumberCounter.upsert({
        where: {
          organizationId_kind: { organizationId: ctx.organizationId, kind: 'SALE_RETURN' },
        },
        create: { organizationId: ctx.organizationId, kind: 'SALE_RETURN', value: 1 },
        update: { value: { increment: 1 } },
      });
      const saleReturn = await tx.stockSaleReturn.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          saleId,
          sessionId: session.id,
          reason: dto.reason,
          restock: dto.restock,
          refundMethod: dto.refundMethod,
          refundAmount: refund,
          idempotencyKey: dto.idempotencyKey,
          createdByUserId: ctx.userId,
        },
      });
      for (const p of planned) {
        await tx.stockSaleReturnLine.create({
          data: {
            organizationId: ctx.organizationId,
            returnId: saleReturn.id,
            saleLineId: p.line.id,
            variantId: p.line.variantId,
            quantity: p.quantity,
            amount: p.amount,
          },
        });
        await tx.stockSaleLine.update({
          where: { id: p.line.id },
          data: {
            returnedQuantity: D(p.line.returnedQuantity).plus(p.quantity),
            refundedAmount: p.line.refundedAmount + p.amount,
          },
        });
      }
      if (refund > 0) {
        await tx.stockPayment.create({
          data: {
            organizationId: ctx.organizationId,
            saleId,
            sessionId: session.id,
            returnId: saleReturn.id,
            method: dto.refundMethod,
            amount: -refund,
          },
        });
      }
      if (dto.restock) {
        await this.ledger.apply(
          tx,
          ctx,
          `stock-return:${saleReturn.id}`,
          planned
            .filter((p) => p.line.isStockable)
            .map((p) => ({
              variantId: p.line.variantId,
              locationId: sale.locationId,
              kind: 'SALE_RETURN' as const,
              quantity: p.quantity,
              idempotencyKey: `stock-return:${saleReturn.id}:${p.line.id}`,
              sourceType: 'SALE_RETURN' as const,
              sourceId: saleReturn.id,
              reason: `${stockSaleReturnNumber(saleReturn.number)} · ${stockSaleNumber(sale.number)} : ${dto.reason}`,
            })),
        );
      }
      return { id: saleReturn.id, replayed: false, refund };
    });
    if (!result.replayed) {
      await this.record(ctx, 'stock.sale_returned', 'StockSale', saleId, {
        returnId: result.id,
        refund: String(result.refund),
      });
    }
    return { ...(await this.get(ctx, saleId)), returnId: result.id, replayed: result.replayed };
  }

  private async assertCustomer(tx: Tx, ctx: StockContext, id: string) {
    const customer = await tx.stockCustomer.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: { isArchived: true },
    });
    if (!customer || customer.isArchived) {
      throw new NotFoundException({
        code: 'STOCK_CUSTOMER_NOT_FOUND',
        message: 'Client introuvable.',
      });
    }
  }

  private async record(
    ctx: StockContext,
    action: string,
    targetType: string,
    id: string,
    metadata?: Record<string, string>,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId: id,
      ...(metadata ? { metadata } : {}),
    });
  }
}
