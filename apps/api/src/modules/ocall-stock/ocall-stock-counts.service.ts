import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import { STOCK_COUNT_SCOPE_LABELS, formatStockQuantity, stockCountNumber } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { toCsv } from '../../common/csv';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import { type StockContext, stockSiteAllowed, stockSiteWhere } from './ocall-stock-access';
import { OcallStockLedgerService } from './ocall-stock-ledger.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockSitesService } from './ocall-stock-sites.service';
import type {
  CreateStockCountDto,
  StockCountLineDto,
  StockOperationsQueryDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const NOT_FOUND = { code: 'STOCK_COUNT_NOT_FOUND', message: 'Inventaire introuvable.' };

interface CountRow {
  variantId: string;
  locationId: string;
  counted: number | null;
  onHand: number;
  difference: number;
}

/**
 * Inventaires (S2). Le comptage n'écrit rien dans le stock ; la validation, par une personne habilitée,
 * applique les écarts. Écart = quantité comptée − stock au moment de la validation (calculé sous le verrou
 * de chaque ligne de stock) : un mouvement fait pendant le comptage n'est pas perdu. Inventaire complet :
 * tout article en stock dans le périmètre et non compté est ramené à 0 ; partiel : seules les lignes
 * comptées sont ajustées.
 */
@Injectable()
export class OcallStockCountsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly ledger: OcallStockLedgerService,
    private readonly sites: OcallStockSitesService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: StockContext, query: StockOperationsQueryDto) {
    return this.db.stockCount
      .findMany({
        where: {
          organizationId: ctx.organizationId,
          ...stockSiteWhere(ctx),
          ...(query.siteId ? { siteId: query.siteId } : {}),
          ...(query.open ? { status: 'OPEN' as const } : {}),
        },
        orderBy: { number: 'desc' },
        take: 200,
        select: {
          id: true,
          number: true,
          name: true,
          scope: true,
          status: true,
          createdAt: true,
          validatedAt: true,
          site: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      })
      .then((rows) => rows.map((c) => ({ ...c, label: stockCountNumber(c.number) })));
  }

  async get(ctx: StockContext, id: string) {
    const count = await this.count(ctx, id);
    const rows =
      count.status === 'OPEN' ? await this.preview(this.db, ctx, count) : this.frozen(count);
    const [variants, locations] = await Promise.all([
      this.db.stockVariant.findMany({
        where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.variantId) } },
        select: {
          id: true,
          name: true,
          sku: true,
          product: { select: { id: true, name: true, unit: true } },
        },
      }),
      this.db.stockLocation.findMany({
        where: { organizationId: ctx.organizationId, siteId: count.siteId },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      id: count.id,
      label: stockCountNumber(count.number),
      name: count.name,
      scope: count.scope,
      status: count.status,
      site: count.site,
      locationIds: count.locationIds,
      createdAt: count.createdAt,
      validatedAt: count.validatedAt,
      lines: rows.map((r) => ({
        ...r,
        lineId:
          count.lines.find((l) => l.variantId === r.variantId && l.locationId === r.locationId)
            ?.id ?? null,
        variant: variants.find((v) => v.id === r.variantId)!,
        location: locations.find((l) => l.id === r.locationId)!,
      })),
    };
  }

  async create(ctx: StockContext, dto: CreateStockCountDto) {
    const locationIds = [...new Set(dto.locationIds ?? [])];
    const created = await this.db.$transaction(async (tx) => {
      await this.sites.activeSite(ctx, dto.siteId, tx);
      // Inventaires du site sérialisés : deux inventaires ouverts ne couvrent jamais le même emplacement.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`count:${dto.siteId}`}, 0))`;
      if (locationIds.length) {
        const found = await tx.stockLocation.count({
          where: {
            organizationId: ctx.organizationId,
            siteId: dto.siteId,
            id: { in: locationIds },
            isArchived: false,
          },
        });
        if (found !== locationIds.length) {
          throw new NotFoundException({
            code: 'STOCK_LOCATION_NOT_FOUND',
            message: 'Emplacement introuvable dans ce site.',
          });
        }
      }
      const open = await tx.stockCount.findMany({
        where: { organizationId: ctx.organizationId, siteId: dto.siteId, status: 'OPEN' },
        select: { locationIds: true },
      });
      if (
        open.some(
          (o) =>
            !o.locationIds.length ||
            !locationIds.length ||
            o.locationIds.some((l) => locationIds.includes(l)),
        )
      ) {
        throw new ConflictException({
          code: 'STOCK_COUNT_OVERLAP',
          message: 'Un inventaire en cours couvre déjà ces emplacements : terminez-le d’abord.',
        });
      }
      const counter = await tx.stockNumberCounter.upsert({
        where: { organizationId_kind: { organizationId: ctx.organizationId, kind: 'COUNT' } },
        create: { organizationId: ctx.organizationId, kind: 'COUNT', value: 1 },
        update: { value: { increment: 1 } },
      });
      return tx.stockCount.create({
        data: {
          organizationId: ctx.organizationId,
          number: counter.value,
          siteId: dto.siteId,
          scope: dto.scope,
          name: dto.name,
          locationIds,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
    });
    await this.record(ctx, 'stock.count_opened', created.id);
    return this.get(ctx, created.id);
  }

  /** Comptage : quantité saisie (SET) ou ajoutée (ADD, un scan = +1). Rien n'est écrit dans le stock. */
  async setLine(ctx: StockContext, id: string, dto: StockCountLineDto) {
    await this.db.$transaction(async (tx) => {
      const count = await this.lock(tx, ctx, id);
      const location = await this.sites.location(ctx, dto.locationId, {}, tx);
      if (
        location.siteId !== count.siteId ||
        (count.locationIds.length && !count.locationIds.includes(location.id))
      ) {
        throw new BadRequestException({
          code: 'STOCK_COUNT_OUT_OF_SCOPE',
          message: 'Cet emplacement n’est pas dans le périmètre de l’inventaire.',
        });
      }
      const variant = await tx.stockVariant.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.variantId } },
        select: { product: { select: { isStockable: true } } },
      });
      if (!variant?.product.isStockable) {
        throw new NotFoundException({
          code: 'STOCK_VARIANT_NOT_FOUND',
          message: 'Article introuvable ou non stocké.',
        });
      }
      const key = {
        countId_locationId_variantId: {
          countId: id,
          locationId: dto.locationId,
          variantId: dto.variantId,
        },
      };
      const current = await tx.stockCountLine.findUnique({
        where: key,
        select: { countedQuantity: true },
      });
      const counted =
        dto.mode === 'ADD'
          ? (current?.countedQuantity ?? D(0)).plus(dto.quantity)
          : D(dto.quantity);
      await tx.stockCountLine.upsert({
        where: key,
        create: {
          organizationId: ctx.organizationId,
          countId: id,
          variantId: dto.variantId,
          locationId: dto.locationId,
          countedQuantity: counted,
          countedByUserId: ctx.userId,
        },
        update: { countedQuantity: counted, countedByUserId: ctx.userId },
      });
    });
    return this.get(ctx, id);
  }

  async removeLine(ctx: StockContext, id: string, lineId: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id);
      const removed = await tx.stockCountLine.deleteMany({
        where: { organizationId: ctx.organizationId, countId: id, id: lineId },
      });
      if (removed.count === 0)
        throw new NotFoundException({
          code: 'STOCK_COUNT_LINE_NOT_FOUND',
          message: 'Ligne introuvable.',
        });
    });
    return this.get(ctx, id);
  }

  /** Validation : écarts appliqués (mouvements « Inventaire »), stock et écart figés sur chaque ligne. */
  async validate(ctx: StockContext, id: string) {
    const applied = await this.db.$transaction(async (tx) => {
      const count = await this.lock(tx, ctx, id);
      const rows = await this.preview(tx, ctx, count);
      const result = await this.ledger.apply(
        tx,
        ctx,
        `count:${id}`,
        rows.map((r) => ({
          variantId: r.variantId,
          locationId: r.locationId,
          kind: 'COUNT' as const,
          quantity: D(0),
          setTo: D(r.counted ?? 0),
          idempotencyKey: `count:${id}:${r.locationId}:${r.variantId}`,
          sourceType: 'COUNT' as const,
          sourceId: id,
          reason: stockCountNumber(count.number),
        })),
      );
      // Lignes figées avec le stock lu sous verrou (non compté d'un inventaire complet : ligne à 0).
      for (const r of rows) {
        const expected = result.before.get(`${r.locationId}:${r.variantId}`) ?? D(r.onHand);
        const counted = D(r.counted ?? 0);
        await tx.stockCountLine.upsert({
          where: {
            countId_locationId_variantId: {
              countId: id,
              locationId: r.locationId,
              variantId: r.variantId,
            },
          },
          create: {
            organizationId: ctx.organizationId,
            countId: id,
            variantId: r.variantId,
            locationId: r.locationId,
            countedQuantity: counted,
            countedByUserId: ctx.userId,
            expectedQuantity: expected,
            differenceQuantity: counted.minus(expected),
          },
          update: { expectedQuantity: expected, differenceQuantity: counted.minus(expected) },
        });
      }
      await tx.stockCount.update({
        where: { id },
        data: { status: 'VALIDATED', validatedAt: new Date(), validatedByUserId: ctx.userId },
      });
      return result.movements.length;
    });
    await this.record(ctx, 'stock.count_validated', id, { adjustments: applied });
    return this.get(ctx, id);
  }

  async cancel(ctx: StockContext, id: string) {
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, ctx, id);
      await tx.stockCount.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
    await this.record(ctx, 'stock.count_cancelled', id);
    return this.get(ctx, id);
  }

  /** Rapport CSV (tableur) : emplacement, article, stock, compté, écart. */
  async reportCsv(ctx: StockContext, id: string): Promise<Buffer> {
    const c = await this.get(ctx, id);
    return Buffer.from(
      toCsv([
        ['Inventaire', 'Site', 'Emplacement', 'Référence', 'Article', 'Stock', 'Compté', 'Écart'],
        ...c.lines.map((l) => [
          c.label,
          c.site.name,
          l.location.code,
          l.variant.sku,
          l.variant.name ? `${l.variant.product.name} — ${l.variant.name}` : l.variant.product.name,
          l.onHand,
          l.counted,
          l.difference,
        ]),
      ]),
      'utf8',
    );
  }

  /** Rapport PDF : en-tête, lignes et totaux des écarts. */
  async reportPdf(ctx: StockContext, id: string): Promise<Buffer> {
    const c = await this.get(ctx, id);
    const statusLabel =
      c.status === 'VALIDATED' ? 'validé' : c.status === 'OPEN' ? 'en cours (aperçu)' : 'annulé';
    return renderPdfDocument({ title: `Inventaire ${c.label}`, creator: 'Ocall Stock' }, (doc) => {
      doc.addPage();
      doc.font('sansBold').fontSize(15).text(`Inventaire ${c.label} — ${c.name}`);
      doc.font('sans').fontSize(9).fillColor('#444444');
      doc.text(`${c.site.name} · ${STOCK_COUNT_SCOPE_LABELS[c.scope]} · ${statusLabel}`);
      if (c.validatedAt)
        doc.text(
          `Validé le ${c.validatedAt.toLocaleString('fr-FR', { timeZone: 'Africa/Bamako' })}`,
        );
      doc.moveDown();
      const cols = [70, 205, 60, 60, 60];
      const head = ['Emplacement', 'Article', 'Stock', 'Compté', 'Écart'];
      const row = (cells: string[], bold = false) => {
        if (doc.y > PDF_PAGE.height - PDF_PAGE.margin - 20) doc.addPage();
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
      row(head, true);
      doc
        .moveTo(PDF_PAGE.margin, doc.y)
        .lineTo(PDF_PAGE.margin + PDF_CONTENT_WIDTH, doc.y)
        .stroke('#999999');
      doc.moveDown(0.3);
      for (const l of c.lines) {
        row([
          l.location.code,
          `${l.variant.sku} ${l.variant.name ? `${l.variant.product.name} — ${l.variant.name}` : l.variant.product.name}`,
          formatStockQuantity(l.onHand),
          l.counted === null ? '—' : formatStockQuantity(l.counted),
          formatStockQuantity(l.difference),
        ]);
      }
      const gaps = c.lines.filter((l) => l.difference !== 0).length;
      doc.moveDown();
      doc.font('sansBold').fontSize(9).text(`${c.lines.length} ligne(s), ${gaps} écart(s).`);
    });
  }

  // ─── Outils ───

  private async count(ctx: StockContext, id: string) {
    const count = await this.db.stockCount.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: { site: { select: { id: true, code: true, name: true } }, lines: true },
    });
    if (!count || !stockSiteAllowed(ctx, count.siteId)) throw new NotFoundException(NOT_FOUND);
    return count;
  }

  /** Inventaire ouvert, verrouillé ; le membre doit avoir accès à son site. */
  private async lock(tx: Tx, ctx: StockContext, id: string) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StockCount" WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException(NOT_FOUND);
    const count = await tx.stockCount.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });
    if (!stockSiteAllowed(ctx, count.siteId)) throw new NotFoundException(NOT_FOUND);
    if (count.status !== 'OPEN') {
      throw new ConflictException({
        code: 'STOCK_COUNT_CLOSED',
        message: 'Inventaire déjà validé ou annulé.',
      });
    }
    return count;
  }

  /**
   * Lignes de l'inventaire ouvert : quantités comptées, plus, pour un inventaire complet, chaque article en
   * stock dans le périmètre et non compté (compté = 0). Stock lu maintenant (aperçu).
   */
  private async preview(
    tx: Tx | OcallStockPrismaService,
    ctx: StockContext,
    count: {
      id: string;
      siteId: string;
      scope: 'FULL' | 'PARTIAL';
      locationIds: string[];
      lines: { variantId: string; locationId: string; countedQuantity: Prisma.Decimal }[];
    },
  ): Promise<CountRow[]> {
    const levels = await tx.stockLevel.findMany({
      where: {
        organizationId: ctx.organizationId,
        siteId: count.siteId,
        ...(count.locationIds.length ? { locationId: { in: count.locationIds } } : {}),
      },
      select: { variantId: true, locationId: true, onHand: true },
    });
    const onHand = new Map(levels.map((l) => [`${l.locationId}:${l.variantId}`, l.onHand]));
    const rows: CountRow[] = count.lines.map((l) => {
      const current = onHand.get(`${l.locationId}:${l.variantId}`) ?? D(0);
      return {
        variantId: l.variantId,
        locationId: l.locationId,
        counted: l.countedQuantity.toNumber(),
        onHand: current.toNumber(),
        difference: l.countedQuantity.minus(current).toNumber(),
      };
    });
    if (count.scope === 'FULL') {
      for (const l of levels) {
        if (l.onHand.isZero()) continue;
        if (count.lines.some((x) => x.locationId === l.locationId && x.variantId === l.variantId))
          continue;
        rows.push({
          variantId: l.variantId,
          locationId: l.locationId,
          counted: null,
          onHand: l.onHand.toNumber(),
          difference: l.onHand.negated().toNumber(),
        });
      }
    }
    return rows;
  }

  /** Lignes d'un inventaire clos : valeurs figées à la validation. */
  private frozen(count: {
    lines: {
      variantId: string;
      locationId: string;
      countedQuantity: Prisma.Decimal;
      expectedQuantity: Prisma.Decimal | null;
      differenceQuantity: Prisma.Decimal | null;
    }[];
  }): CountRow[] {
    return count.lines.map((l) => ({
      variantId: l.variantId,
      locationId: l.locationId,
      counted: l.countedQuantity.toNumber(),
      onHand: l.expectedQuantity?.toNumber() ?? 0,
      difference: l.differenceQuantity?.toNumber() ?? 0,
    }));
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
      targetType: 'StockCount',
      targetId: id,
      ...(metadata ? { metadata } : {}),
    });
  }
}
