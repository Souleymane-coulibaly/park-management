import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { STOCK_LABEL_MAX_TOTAL, formatStockMoney } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type StockContext, stockSiteAllowed } from './ocall-stock-access';
import { type LabelContent, renderLabelsPdf, symbologyFor } from './ocall-stock-label-pdf';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { stockEffectivePrice, stockSitePrices } from './ocall-stock-site-prices';
import type { StockLabelsDto } from './ocall-stock.dto';

/** Préférence d'impression : code du fabricant d'abord, puis code interne. */
const ORDER = { EAN13: 0, UPCA: 1, EAN8: 2, INTERNAL: 3 } as const;

/**
 * Étiquettes autocollantes (S1) : PDF à la taille de l'étiquette, à l'unité ou en série. Le prix imprimé est
 * le prix de vente TTC du jour ; une étiquette se réimprime après un changement de prix.
 */
@Injectable()
export class OcallStockLabelsService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async render(ctx: StockContext, dto: StockLabelsDto): Promise<Buffer> {
    const total = dto.items.reduce((n, i) => n + i.copies, 0);
    if (total > STOCK_LABEL_MAX_TOTAL) {
      throw new BadRequestException({
        code: 'STOCK_LABELS_LIMIT',
        message: `${STOCK_LABEL_MAX_TOTAL} étiquettes au plus par impression.`,
      });
    }
    const ids = [...new Set(dto.items.map((i) => i.variantId))];
    // Prix imprimé : celui de la boutique demandée, ou de l'unique boutique du membre (S10).
    const siteId = dto.siteId ?? (ctx.siteIds?.length === 1 ? ctx.siteIds[0]! : null);
    if (siteId) {
      const site = await this.db.stockSite.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: siteId } },
        select: { id: true },
      });
      if (!site || !stockSiteAllowed(ctx, site.id)) {
        throw new NotFoundException({ code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' });
      }
    }
    const [variants, settings, organization] = await Promise.all([
      this.db.stockVariant.findMany({
        where: { organizationId: ctx.organizationId, id: { in: ids } },
        select: {
          id: true,
          name: true,
          sku: true,
          salePrice: true,
          barcodes: { select: { type: true, code: true } },
          product: { select: { name: true, salePrice: true } },
        },
      }),
      this.db.stockSettings.findUnique({ where: { organizationId: ctx.organizationId } }),
      this.core.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true, currency: true },
      }),
    ]);
    if (variants.length !== ids.length) {
      throw new NotFoundException({
        code: 'STOCK_VARIANT_NOT_FOUND',
        message: 'Article introuvable.',
      });
    }
    const storeName = settings?.storeName ?? organization.name;
    const sitePrices = siteId
      ? await stockSitePrices(this.db, ctx.organizationId, siteId, ids)
      : new Map<string, number>();
    const labels: LabelContent[] = dto.items.map((item) => {
      const v = variants.find((x) => x.id === item.variantId)!;
      const barcode = [...v.barcodes].sort((a, b) => ORDER[a.type] - ORDER[b.type])[0] ?? null;
      return {
        storeName,
        productName: v.product.name,
        variantName: v.name,
        reference: v.sku,
        code: barcode?.code ?? v.sku,
        symbology: symbologyFor(barcode?.type ?? null),
        price: formatStockMoney(stockEffectivePrice(sitePrices, v), organization.currency),
        copies: item.copies,
      };
    });
    const pdf = await renderLabelsPdf(dto.format, dto.fields, labels);
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'stock.labels_printed',
      targetType: 'StockVariant',
      metadata: { format: dto.format, labels: total, variants: ids.length, siteId },
    });
    return pdf;
  }
}
