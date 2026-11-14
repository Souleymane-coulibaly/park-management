import { Inject, Injectable } from '@nestjs/common';
import { STOCK_PRODUCT_CODE, type StockPermission, stockSaleNumber } from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import type {
  StockCatalogEntry,
  StockCatalogReader,
  StockSaleForInvoice,
} from '../../common/integration/catalog-integration';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { stockMemberRights } from './ocall-stock-access';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const ORDER = { EAN13: 0, UPCA: 1, EAN8: 2, INTERNAL: 3 } as const;
const MAX = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  async availability(
    organizationId: string,
    userId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, number> | null> {
    if (!(await this.isAvailable(organizationId))) return null;
    const settings = await this.db.stockSettings.findUnique({
      where: { organizationId },
      select: { factureLocation: { select: { id: true, siteId: true } } },
    });
    const location = settings?.factureLocation;
    if (!location) return null;
    const rights = await this.rights(organizationId, userId, 'stock.levels.read');
    if (!rights || (rights.siteIds !== null && !rights.siteIds.includes(location.siteId))) {
      return null;
    }
    // Articles stockés seulement : un service n'a pas de disponibilité (absent du résultat).
    const ids = (
      await this.db.stockVariant.findMany({
        where: {
          organizationId,
          id: { in: [...new Set(variantIds)].slice(0, 200) },
          product: { isStockable: true },
        },
        select: { id: true },
      })
    ).map((v) => v.id);
    const levels = await this.db.stockLevel.findMany({
      where: { organizationId, locationId: location.id, variantId: { in: ids } },
      select: { variantId: true, onHand: true, reserved: true },
    });
    const out = new Map(ids.map((id) => [id, 0]));
    for (const l of levels) out.set(l.variantId, l.onHand.minus(l.reserved).toNumber());
    return out;
  }

  async sale(
    organizationId: string,
    userId: string,
    ref: string,
  ): Promise<StockSaleForInvoice | null> {
    if (!(await this.isAvailable(organizationId))) return null;
    const rights = await this.rights(organizationId, userId, 'stock.sales.read');
    if (!rights) return null;
    const value = ref.trim().toUpperCase();
    const number = /^(VTE-)?0*(\d{1,9})$/.exec(value);
    const where = UUID.test(value)
      ? { organizationId, id: value.toLowerCase() }
      : number
        ? { organizationId, number: Number(number[2]) }
        : null;
    if (!where) return null;
    const sale = await this.db.stockSale.findFirst({
      where,
      include: {
        customer: { select: { name: true, phone: true, email: true } },
        lines: { orderBy: { id: 'asc' } },
      },
    });
    if (!sale || (rights.siteIds !== null && !rights.siteIds.includes(sale.siteId))) return null;
    const products = new Map(
      (
        await this.db.stockVariant.findMany({
          where: { organizationId, id: { in: sale.lines.map((l) => l.variantId) } },
          select: { id: true, product: { select: { id: true, unit: true } } },
        })
      ).map((v) => [v.id, v.product]),
    );
    return {
      id: sale.id,
      number: stockSaleNumber(sale.number),
      createdAt: sale.createdAt,
      customer: sale.customer,
      total: sale.total,
      lines: sale.lines
        .map((l) => ({
          variantId: l.variantId,
          productId: products.get(l.variantId)?.id ?? '',
          sku: l.sku,
          label: l.label,
          unit: products.get(l.variantId)?.unit ?? 'unité',
          quantity: l.quantity.minus(l.returnedQuantity).toNumber(),
          total: l.total - l.refundedAmount,
          vatRate: l.vatRate,
          isStockable: l.isStockable,
        }))
        .filter((l) => l.quantity > 0),
    };
  }

  /** Droits Stock du compte, s'il porte la permission demandée (vérifiés ici, jamais par l'appelant). */
  private async rights(organizationId: string, userId: string, permission: StockPermission) {
    const membership = await this.core.organizationMembership.findFirst({
      where: { organizationId, userId, isActive: true },
      select: { role: true },
    });
    if (!membership) return null;
    // Sites limités à ceux où le rôle du membre porte la permission (rôle par site).
    const rights = await stockMemberRights(this.db, organizationId, userId, membership.role, [
      permission,
    ]);
    return rights?.permissions.includes(permission) ? rights : null;
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
