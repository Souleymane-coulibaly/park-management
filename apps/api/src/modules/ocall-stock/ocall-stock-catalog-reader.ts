import { Inject, Injectable } from '@nestjs/common';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import type {
  StockCatalogEntry,
  StockCatalogReader,
} from '../../common/integration/catalog-integration';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const ORDER = { EAN13: 0, UPCA: 1, EAN8: 2, INTERNAL: 3 } as const;
const MAX = 50;

/** Implémentation Stock du contrat de lecture du catalogue (voir `common/integration`). */
@Injectable()
export class OcallStockCatalogReader implements StockCatalogReader {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly core: PrismaService,
    private readonly catalog: OcallStockCatalogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async isAvailable(organizationId: string): Promise<boolean> {
    if (!this.config.stock.enabled) return false;
    return (await loadAppAccess(this.core, organizationId, STOCK_PRODUCT_CODE)) !== 'none';
  }

  async search(organizationId: string, q: string, limit: number): Promise<StockCatalogEntry[]> {
    if (!(await this.isAvailable(organizationId)) || !q.trim()) return [];
    const productIds = await this.catalog.searchProductIds(
      organizationId,
      q.trim(),
      Math.min(limit, MAX),
    );
    if (productIds.length === 0) return [];
    const entries = await this.load(organizationId, {
      productId: { in: productIds },
      isArchived: false,
    });
    const rank = new Map(productIds.map((id, i) => [id, i]));
    return entries
      .filter((e) => !e.isArchived)
      .sort((a, b) => (rank.get(a.productId) ?? 0) - (rank.get(b.productId) ?? 0))
      .slice(0, Math.min(limit, MAX));
  }

  async variants(
    organizationId: string,
    variantIds: readonly string[],
  ): Promise<StockCatalogEntry[]> {
    if (variantIds.length === 0 || !(await this.isAvailable(organizationId))) return [];
    return this.load(organizationId, { id: { in: [...variantIds].slice(0, 200) } });
  }

  private async load(
    organizationId: string,
    where: { productId?: { in: string[] }; id?: { in: string[] }; isArchived?: boolean },
  ): Promise<StockCatalogEntry[]> {
    const rows = await this.db.stockVariant.findMany({
      where: { organizationId, ...where },
      select: {
        id: true,
        name: true,
        sku: true,
        salePrice: true,
        isArchived: true,
        barcodes: { select: { type: true, code: true } },
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            unit: true,
            salePrice: true,
            vatRate: true,
            isStockable: true,
            isArchived: true,
          },
        },
      },
    });
    return rows.map((v) => ({
      variantId: v.id,
      productId: v.product.id,
      sku: v.sku,
      label: v.name ? `${v.product.name} — ${v.name}` : v.product.name,
      description: v.product.description,
      unit: v.product.unit,
      salePrice: v.salePrice ?? v.product.salePrice,
      vatRate: v.product.vatRate,
      barcode: [...v.barcodes].sort((a, b) => ORDER[a.type] - ORDER[b.type])[0]?.code ?? null,
      isStockable: v.product.isStockable,
      isArchived: v.isArchived || v.product.isArchived,
    }));
  }
}
