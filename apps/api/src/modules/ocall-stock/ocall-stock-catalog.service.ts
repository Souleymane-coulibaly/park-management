import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/stock-database';
import {
  STOCK_DEFAULT_VAT_RATE,
  barcodeProblem,
  detectBarcodeType,
  gtinEquivalents,
  normalizeScannedCode,
  stockGeneratedSku,
  stockInternalCode,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type StockContext, stockCan, stockSiteAllowed } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import type {
  StockBarcodeDto,
  StockBrandDto,
  StockCategoryDto,
  StockListQueryDto,
  StockProductDto,
  StockProductQueryDto,
  StockVariantDto,
  UpdateStockBrandDto,
  UpdateStockCategoryDto,
  UpdateStockProductDto,
  UpdateStockVariantDto,
} from './ocall-stock.dto';

type Tx = Prisma.TransactionClient;

const PRODUCT_NOT_FOUND = { code: 'STOCK_PRODUCT_NOT_FOUND', message: 'Article introuvable.' };
const VARIANT_NOT_FOUND = { code: 'STOCK_VARIANT_NOT_FOUND', message: 'Variante introuvable.' };
const CATEGORY_NOT_FOUND = { code: 'STOCK_CATEGORY_NOT_FOUND', message: 'Catégorie introuvable.' };
const BRAND_NOT_FOUND = { code: 'STOCK_BRAND_NOT_FOUND', message: 'Marque introuvable.' };
const SITE_NOT_FOUND = { code: 'STOCK_SITE_NOT_FOUND', message: 'Site introuvable.' };
const LIST_LIMIT = 500;
/**
 * Tolérance aux fautes : proximité de trigrammes d'un mot cherché avec une partie du nom (0 à 1). Le seuil
 * par défaut de pg_trgm (0,6) manque « acrilique » pour « acrylique » ; 0,45 l'admet sans bruit notable.
 */
export const FUZZY_THRESHOLD = 0.45;
/** Champs d'un article suivis dans son historique. */
const TRACKED = [
  'sku',
  'name',
  'description',
  'categoryId',
  'brandId',
  'unit',
  'salePrice',
  'purchasePrice',
  'vatRate',
  'minStock',
  'isStockable',
  'isArchived',
] as const;

const uniqueTarget = (e: unknown): string | null =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? String(e.meta?.target ?? 'unique')
    : null;

const pgMessage = (e: unknown): string =>
  e instanceof Prisma.PrismaClientKnownRequestError ||
  e instanceof Prisma.PrismaClientUnknownRequestError
    ? e.message
    : '';

const barcodeTaken = (productName: string | null) =>
  new ConflictException({
    code: 'STOCK_BARCODE_TAKEN',
    message: productName
      ? `Ce code est déjà attribué à « ${productName} ».`
      : 'Ce code est déjà attribué.',
  });

const decimal = (v: number | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Prisma.Decimal(v);

const plain = (v: unknown): unknown =>
  v instanceof Prisma.Decimal ? Number(v) : v instanceof Date ? v.toISOString() : v;

/**
 * Catalogue Ocall Stock (S1) : catégories, marques, articles, variantes, codes-barres, historiques,
 * lecture des codes. Rien n'est supprimé : un élément sort des listes par archivage. Les prix d'achat ne
 * sont montrés qu'avec le droit de les voir ; un prix ne change qu'avec le droit de modifier les prix.
 */
@Injectable()
export class OcallStockCatalogService {
  constructor(
    private readonly db: OcallStockPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Catégories ───

  listCategories(ctx: StockContext, query: StockListQueryDto) {
    return this.db.stockCategory.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, name: true, isArchived: true },
      take: LIST_LIMIT,
    });
  }

  async createCategory(ctx: StockContext, dto: StockCategoryDto) {
    if (dto.parentId) await this.activeCategory(this.db, ctx, dto.parentId);
    const category = await this.categoryErrors(() =>
      this.db.stockCategory.create({
        data: {
          organizationId: ctx.organizationId,
          name: dto.name,
          parentId: dto.parentId ?? null,
        },
        select: { id: true, parentId: true, name: true, isArchived: true },
      }),
    );
    await this.record(ctx, 'stock.category_created', 'StockCategory', category.id);
    return category;
  }

  async updateCategory(ctx: StockContext, id: string, dto: UpdateStockCategoryDto) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    if (!(await this.db.stockCategory.findUnique({ where, select: { id: true } }))) {
      throw new NotFoundException(CATEGORY_NOT_FOUND);
    }
    if (dto.parentId) await this.activeCategory(this.db, ctx, dto.parentId);
    const category = await this.categoryErrors(() =>
      this.db.stockCategory.update({
        where,
        data: { name: dto.name, parentId: dto.parentId, isArchived: dto.isArchived },
        select: { id: true, parentId: true, name: true, isArchived: true },
      }),
    );
    await this.record(ctx, 'stock.category_updated', 'StockCategory', id, Object.keys(dto));
    return category;
  }

  // ─── Marques ───

  listBrands(ctx: StockContext, query: StockListQueryDto) {
    return this.db.stockBrand.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isArchived: true },
      take: LIST_LIMIT,
    });
  }

  async createBrand(ctx: StockContext, dto: StockBrandDto) {
    const brand = await this.nameUnique(
      'STOCK_BRAND_NAME_TAKEN',
      'Une marque porte déjà ce nom.',
      () =>
        this.db.stockBrand.create({
          data: { organizationId: ctx.organizationId, name: dto.name },
          select: { id: true, name: true, isArchived: true },
        }),
    );
    await this.record(ctx, 'stock.brand_created', 'StockBrand', brand.id);
    return brand;
  }

  async updateBrand(ctx: StockContext, id: string, dto: UpdateStockBrandDto) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    if (!(await this.db.stockBrand.findUnique({ where, select: { id: true } }))) {
      throw new NotFoundException(BRAND_NOT_FOUND);
    }
    const brand = await this.nameUnique(
      'STOCK_BRAND_NAME_TAKEN',
      'Une marque porte déjà ce nom.',
      () =>
        this.db.stockBrand.update({
          where,
          data: { name: dto.name, isArchived: dto.isArchived },
          select: { id: true, name: true, isArchived: true },
        }),
    );
    await this.record(ctx, 'stock.brand_updated', 'StockBrand', id, Object.keys(dto));
    return brand;
  }

  // ─── Articles ───

  /** Liste paginée ; la recherche tolère fautes et accents (trigrammes) et lit références et codes. */
  async listProducts(ctx: StockContext, query: StockProductQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const q = query.q?.trim();
    const base: Prisma.StockProductWhereInput = {
      organizationId: ctx.organizationId,
      ...(query.archived ? {} : { isArchived: false }),
      ...(query.categoryId
        ? { OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }] }
        : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
    };
    let ids: string[] | null = null;
    if (q) {
      const matches = await this.searchProductIds(ctx.organizationId, q, 1000);
      ids = matches;
    }
    const where: Prisma.StockProductWhereInput = ids ? { AND: [base, { id: { in: ids } }] } : base;
    const [total, rows] = await Promise.all([
      this.db.stockProduct.count({ where }),
      this.db.stockProduct.findMany({
        where,
        orderBy: ids ? undefined : [{ isArchived: 'asc' }, { name: 'asc' }],
        ...(ids ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        select: this.productListSelect(),
      }),
    ]);
    // Recherche : ordre de pertinence (ordre des identifiants), pagination appliquée ensuite.
    const ordered = ids
      ? ids
          .map((id) => rows.find((r) => r.id === id))
          .filter((r): r is (typeof rows)[number] => Boolean(r))
          .slice((page - 1) * pageSize, page * pageSize)
      : rows;
    return {
      items: ordered.map((r) => this.listView(ctx, r)),
      total,
      page,
      pageSize,
    };
  }

  async product(ctx: StockContext, id: string) {
    const product = await this.db.stockProduct.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      include: {
        category: { select: { id: true, name: true, parentId: true } },
        brand: { select: { id: true, name: true } },
        variants: {
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
          include: {
            barcodes: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, type: true, code: true, createdAt: true },
            },
            sitePrices: { select: { siteId: true, salePrice: true } },
          },
        },
        images: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true, aiGenerated: true, showcaseApproved: true },
        },
      },
    });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    const seePurchase = stockCan(ctx, 'stock.prices.purchase.read');
    return {
      ...product,
      minStock: product.minStock === null ? null : Number(product.minStock),
      purchasePrice: seePurchase ? product.purchasePrice : undefined,
      variants: product.variants.map((v) => ({
        id: v.id,
        name: v.name,
        isDefault: v.isDefault,
        sku: v.sku,
        salePrice: v.salePrice,
        effectiveSalePrice: v.salePrice ?? product.salePrice,
        purchasePrice: seePurchase ? v.purchasePrice : undefined,
        isArchived: v.isArchived,
        barcodes: v.barcodes,
        // Exceptions de prix des boutiques du membre seulement (S10).
        sitePrices: v.sitePrices.filter((p) => stockSiteAllowed(ctx, p.siteId)),
      })),
    };
  }

  async createProduct(ctx: StockContext, dto: StockProductDto) {
    // Fixer un prix exige le droit de gérer les prix (comme pour une variante) : sans lui, l'article est créé
    // au prix de vente 0, sans prix d'achat, et un responsable fixe ensuite les prix.
    if (dto.salePrice > 0 || (dto.purchasePrice !== undefined && dto.purchasePrice !== null)) {
      this.assertCan(
        ctx,
        'stock.prices.manage',
        'Vous ne pouvez pas fixer de prix : laissez le prix de vente à 0, un responsable le fixera.',
      );
    }
    if (dto.purchasePrice !== undefined && dto.purchasePrice !== null) {
      this.assertCan(
        ctx,
        'stock.prices.purchase.read',
        'Vous ne pouvez pas saisir un prix d’achat.',
      );
    }
    const created = await this.db
      .$transaction(async (tx) => {
        const settings = await tx.stockSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        await this.assertLinks(tx, ctx, dto.categoryId, dto.brandId);
        const sku =
          dto.sku ??
          (await this.freeSku(tx, ctx.organizationId, settings?.internalCodePrefix ?? 'OC'));
        const product = await tx.stockProduct.create({
          data: {
            organizationId: ctx.organizationId,
            sku,
            name: dto.name,
            description: dto.description ?? null,
            categoryId: dto.categoryId ?? null,
            brandId: dto.brandId ?? null,
            unit: dto.unit ?? 'unité',
            salePrice: dto.salePrice,
            purchasePrice: dto.purchasePrice ?? null,
            vatRate: dto.vatRate ?? settings?.defaultVatRate ?? STOCK_DEFAULT_VAT_RATE,
            minStock: decimal(dto.minStock) ?? null,
            isStockable: dto.isStockable ?? true,
          },
        });
        const variant = await tx.stockVariant.create({
          data: { organizationId: ctx.organizationId, productId: product.id, isDefault: true, sku },
        });
        await tx.stockPriceHistory.createMany({
          data: [
            { kind: 'SALE' as const, newPrice: product.salePrice },
            ...(product.purchasePrice !== null
              ? [{ kind: 'PURCHASE' as const, newPrice: product.purchasePrice }]
              : []),
          ].map((p) => ({
            organizationId: ctx.organizationId,
            variantId: variant.id,
            kind: p.kind,
            oldPrice: null,
            newPrice: p.newPrice,
            changedByUserId: ctx.userId,
          })),
        });
        await tx.stockProductHistory.create({
          data: {
            organizationId: ctx.organizationId,
            productId: product.id,
            actorUserId: ctx.userId,
            action: 'created',
            changes: {},
          },
        });
        return product;
      })
      .catch((e) => this.skuErrors(e));
    await this.record(ctx, 'stock.product_created', 'StockProduct', created.id);
    return this.product(ctx, created.id);
  }

  /**
   * Modification par la route : un champ autre qu'un prix exige le droit de gérer le catalogue (un membre
   * qui ne gère que les prix ne change que les prix) ; un prix exige le droit de modifier les prix.
   */
  updateProductChecked(ctx: StockContext, id: string, dto: UpdateStockProductDto) {
    this.assertCatalogFields(ctx, dto, ['salePrice', 'purchasePrice']);
    return this.updateProduct(ctx, id, dto);
  }

  updateVariantChecked(ctx: StockContext, id: string, dto: UpdateStockVariantDto) {
    this.assertCatalogFields(ctx, dto, ['salePrice', 'purchasePrice']);
    return this.updateVariant(ctx, id, dto);
  }

  private assertCatalogFields(ctx: StockContext, dto: object, priceFields: readonly string[]) {
    const other = Object.entries(dto).some(([k, v]) => v !== undefined && !priceFields.includes(k));
    if (other && !stockCan(ctx, 'stock.catalog.manage')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
  }

  async updateProduct(ctx: StockContext, id: string, dto: UpdateStockProductDto) {
    const changed = await this.db
      .$transaction(async (tx) => {
        // Droit vérifié dès que le champ est envoyé, avant toute comparaison : sinon la réponse (200 si la
        // valeur est la valeur actuelle, 403 sinon) révélerait le prix d'achat.
        if (dto.purchasePrice !== undefined) {
          this.assertCan(
            ctx,
            'stock.prices.purchase.read',
            'Vous ne pouvez pas voir ni modifier les prix d’achat.',
          );
        }
        const current = await this.lockProduct(tx, ctx, id);
        const next: Record<string, unknown> = {};
        for (const key of TRACKED) {
          const value = key === 'minStock' ? decimal(dto.minStock) : dto[key];
          if (value === undefined) continue;
          if (String(plain(current[key])) !== String(plain(value))) next[key] = value;
        }
        if ('salePrice' in next || 'purchasePrice' in next) {
          this.assertCan(ctx, 'stock.prices.manage', 'Vous ne pouvez pas modifier les prix.');
        }
        if ('purchasePrice' in next) {
          this.assertCan(
            ctx,
            'stock.prices.purchase.read',
            'Vous ne pouvez pas voir ni modifier les prix d’achat.',
          );
        }
        if (Object.keys(next).length === 0) return [];
        // Un article qui a du stock (ou une réservation) reste stocké : sinon son stock deviendrait intouchable.
        if (next.isStockable === false) {
          const stocked = await tx.stockLevel.count({
            where: {
              organizationId: ctx.organizationId,
              variant: { productId: id },
              OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }],
            },
          });
          if (stocked > 0) {
            throw new ConflictException({
              code: 'STOCK_PRODUCT_HAS_STOCK',
              message: 'Cet article a du stock : videz-le avant de le déclarer non stocké.',
            });
          }
        }
        if ('categoryId' in next || 'brandId' in next) {
          await this.assertLinks(
            tx,
            ctx,
            next.categoryId as string | null | undefined,
            next.brandId as string | null | undefined,
          );
        }
        await tx.stockProduct.update({
          where: { organizationId_id: { organizationId: ctx.organizationId, id } },
          data: next,
        });
        const defaultVariant = await tx.stockVariant.findFirstOrThrow({
          where: { organizationId: ctx.organizationId, productId: id, isDefault: true },
          select: { id: true },
        });
        // La variante par défaut porte la référence de l'article.
        if ('sku' in next) {
          await tx.stockVariant.update({
            where: { id: defaultVariant.id },
            data: { sku: next.sku as string },
          });
        }
        for (const [field, kind] of [
          ['salePrice', 'SALE'],
          ['purchasePrice', 'PURCHASE'],
        ] as const) {
          if (!(field in next)) continue;
          await tx.stockPriceHistory.create({
            data: {
              organizationId: ctx.organizationId,
              variantId: defaultVariant.id,
              kind,
              oldPrice: current[field],
              newPrice: next[field] as number | null,
              changedByUserId: ctx.userId,
            },
          });
        }
        const changes = Object.fromEntries(
          Object.keys(next).map((k) => [
            k,
            [plain(current[k as keyof typeof current]), plain(next[k])],
          ]),
        );
        await tx.stockProductHistory.create({
          data: {
            organizationId: ctx.organizationId,
            productId: id,
            actorUserId: ctx.userId,
            action: 'isArchived' in next ? (next.isArchived ? 'archived' : 'restored') : 'updated',
            changes: changes as Prisma.InputJsonValue,
          },
        });
        return Object.keys(next);
      })
      .catch((e) => this.skuErrors(e));
    if (changed.length > 0)
      await this.record(ctx, 'stock.product_updated', 'StockProduct', id, changed);
    return this.product(ctx, id);
  }

  /** Historique : modifications de l'article et prix de ses variantes (prix d'achat selon le droit). */
  async history(ctx: StockContext, id: string) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    if (!(await this.db.stockProduct.findUnique({ where, select: { id: true } }))) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    const seePurchase = stockCan(ctx, 'stock.prices.purchase.read');
    const [changes, prices] = await Promise.all([
      this.db.stockProductHistory.findMany({
        where: { organizationId: ctx.organizationId, productId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, action: true, changes: true, actorUserId: true, createdAt: true },
      }),
      this.db.stockPriceHistory.findMany({
        where: {
          organizationId: ctx.organizationId,
          variant: { productId: id },
          ...(seePurchase ? {} : { kind: 'SALE' }),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          kind: true,
          oldPrice: true,
          newPrice: true,
          changedByUserId: true,
          createdAt: true,
          siteId: true,
          variant: { select: { id: true, name: true, isDefault: true } },
        },
      }),
    ]);
    const hide = (c: unknown) => {
      if (seePurchase || !c || typeof c !== 'object') return c;
      const { purchasePrice: _p, ...rest } = c as Record<string, unknown>;
      return rest;
    };
    return {
      changes: changes.map((c) => ({ ...c, changes: hide(c.changes) })),
      // Prix d'une boutique : visibles des membres de cette boutique seulement (S10).
      prices: prices.filter((p) => p.siteId === null || stockSiteAllowed(ctx, p.siteId)),
    };
  }

  // ─── Variantes ───

  async createVariant(ctx: StockContext, productId: string, dto: StockVariantDto) {
    if (dto.salePrice != null || dto.purchasePrice != null) {
      this.assertCan(ctx, 'stock.prices.manage', 'Vous ne pouvez pas fixer de prix.');
    }
    if (dto.purchasePrice != null) {
      this.assertCan(
        ctx,
        'stock.prices.purchase.read',
        'Vous ne pouvez pas saisir un prix d’achat.',
      );
    }
    const variant = await this.db
      .$transaction(async (tx) => {
        const product = await this.lockProduct(tx, ctx, productId);
        if (product.isArchived) {
          throw new ConflictException({
            code: 'STOCK_PRODUCT_ARCHIVED',
            message: 'Article archivé : réactivez-le d’abord.',
          });
        }
        await this.assertVariantNameFree(tx, ctx, productId, dto.name, null);
        const settings = await tx.stockSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        const sku =
          dto.sku ??
          (await this.freeSku(tx, ctx.organizationId, settings?.internalCodePrefix ?? 'OC'));
        const created = await tx.stockVariant.create({
          data: {
            organizationId: ctx.organizationId,
            productId,
            name: dto.name,
            sku,
            salePrice: dto.salePrice ?? null,
            purchasePrice: dto.purchasePrice ?? null,
          },
        });
        for (const [field, kind] of [
          ['salePrice', 'SALE'],
          ['purchasePrice', 'PURCHASE'],
        ] as const) {
          if (created[field] === null) continue;
          await tx.stockPriceHistory.create({
            data: {
              organizationId: ctx.organizationId,
              variantId: created.id,
              kind,
              oldPrice: null,
              newPrice: created[field],
              changedByUserId: ctx.userId,
            },
          });
        }
        await tx.stockProductHistory.create({
          data: {
            organizationId: ctx.organizationId,
            productId,
            actorUserId: ctx.userId,
            action: 'variant_created',
            changes: { variant: [null, dto.name], sku: [null, sku] },
          },
        });
        return created;
      })
      .catch((e) => this.skuErrors(e));
    await this.record(ctx, 'stock.variant_created', 'StockVariant', variant.id);
    return this.product(ctx, productId);
  }

  async updateVariant(ctx: StockContext, id: string, dto: UpdateStockVariantDto) {
    const productId = await this.db
      .$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ productId: string }[]>`
        SELECT "productId" FROM "StockVariant"
        WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
        if (!locked) throw new NotFoundException(VARIANT_NOT_FOUND);
        const current = await tx.stockVariant.findUniqueOrThrow({ where: { id } });
        if (
          current.isDefault &&
          (dto.name !== undefined || dto.sku !== undefined || dto.isArchived !== undefined)
        ) {
          throw new BadRequestException({
            code: 'STOCK_DEFAULT_VARIANT',
            message: 'La variante par défaut suit l’article : modifiez ou archivez l’article.',
          });
        }
        if (dto.purchasePrice !== undefined) {
          this.assertCan(
            ctx,
            'stock.prices.purchase.read',
            'Vous ne pouvez pas voir ni modifier les prix d’achat.',
          );
        }
        const next: Record<string, unknown> = {};
        for (const key of ['name', 'sku', 'salePrice', 'purchasePrice', 'isArchived'] as const) {
          if (dto[key] !== undefined && dto[key] !== current[key]) next[key] = dto[key];
        }
        if ('salePrice' in next || 'purchasePrice' in next) {
          this.assertCan(ctx, 'stock.prices.manage', 'Vous ne pouvez pas modifier les prix.');
        }
        if ('purchasePrice' in next) {
          this.assertCan(
            ctx,
            'stock.prices.purchase.read',
            'Vous ne pouvez pas voir ni modifier les prix d’achat.',
          );
        }
        if (Object.keys(next).length === 0) return current.productId;
        if (typeof next.name === 'string') {
          await this.assertVariantNameFree(tx, ctx, current.productId, next.name, id);
        }
        await tx.stockVariant.update({ where: { id }, data: next });
        for (const [field, kind] of [
          ['salePrice', 'SALE'],
          ['purchasePrice', 'PURCHASE'],
        ] as const) {
          if (!(field in next)) continue;
          await tx.stockPriceHistory.create({
            data: {
              organizationId: ctx.organizationId,
              variantId: id,
              kind,
              oldPrice: current[field],
              newPrice: next[field] as number | null,
              changedByUserId: ctx.userId,
            },
          });
        }
        await tx.stockProductHistory.create({
          data: {
            organizationId: ctx.organizationId,
            productId: current.productId,
            actorUserId: ctx.userId,
            action: 'variant_updated',
            changes: {
              variant: [current.name, current.name],
              ...Object.fromEntries(
                Object.keys(next)
                  .filter((k) => k !== 'purchasePrice')
                  .map((k) => [k, [current[k as keyof typeof current], next[k]]]),
              ),
            } as Prisma.InputJsonValue,
          },
        });
        return current.productId;
      })
      .catch((e) => this.skuErrors(e));
    await this.record(ctx, 'stock.variant_updated', 'StockVariant', id, Object.keys(dto));
    return this.product(ctx, productId);
  }

  // ─── Prix par boutique (S10) ───

  /**
   * Fixe le prix de vente TTC d'une variante dans une boutique (exception au prix commun), tracé dans
   * l'historique des prix avec la boutique. Boutique de l'organisation, accessible au membre et active.
   */
  async setSitePrice(ctx: StockContext, variantId: string, siteId: string, salePrice: number) {
    this.assertCan(ctx, 'stock.prices.manage', 'Vous ne pouvez pas modifier les prix.');
    const productId = await this.db.$transaction(async (tx) => {
      const productId = await this.lockVariant(tx, ctx, variantId);
      const site = await this.allowedSite(tx, ctx, siteId);
      if (site.isArchived) {
        throw new ConflictException({ code: 'STOCK_SITE_ARCHIVED', message: 'Site archivé.' });
      }
      const key = { organizationId: ctx.organizationId, variantId, siteId };
      const current = await tx.stockSitePrice.findUnique({
        where: { organizationId_variantId_siteId: key },
      });
      if (current?.salePrice === salePrice) return productId;
      await tx.stockSitePrice.upsert({
        where: { organizationId_variantId_siteId: key },
        create: { ...key, salePrice, updatedByUserId: ctx.userId },
        update: { salePrice, updatedByUserId: ctx.userId },
      });
      await this.sitePriceHistory(
        tx,
        ctx,
        productId,
        variantId,
        site,
        current?.salePrice ?? null,
        salePrice,
      );
      return productId;
    });
    await this.record(ctx, 'stock.site_price_set', 'StockVariant', variantId, [siteId]);
    return this.product(ctx, productId);
  }

  /** Retire l'exception : la boutique revient au prix commun. */
  async removeSitePrice(ctx: StockContext, variantId: string, siteId: string) {
    this.assertCan(ctx, 'stock.prices.manage', 'Vous ne pouvez pas modifier les prix.');
    const productId = await this.db.$transaction(async (tx) => {
      const productId = await this.lockVariant(tx, ctx, variantId);
      const site = await this.allowedSite(tx, ctx, siteId);
      const key = { organizationId: ctx.organizationId, variantId, siteId };
      const current = await tx.stockSitePrice.findUnique({
        where: { organizationId_variantId_siteId: key },
      });
      if (!current) return productId;
      await tx.stockSitePrice.delete({ where: { id: current.id } });
      await this.sitePriceHistory(tx, ctx, productId, variantId, site, current.salePrice, null);
      return productId;
    });
    await this.record(ctx, 'stock.site_price_removed', 'StockVariant', variantId, [siteId]);
    return this.product(ctx, productId);
  }

  private async lockVariant(tx: Tx, ctx: StockContext, variantId: string) {
    const [locked] = await tx.$queryRaw<{ productId: string }[]>`
      SELECT "productId" FROM "StockVariant"
      WHERE id = ${variantId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!locked) throw new NotFoundException(VARIANT_NOT_FOUND);
    return locked.productId;
  }

  private async allowedSite(tx: Tx, ctx: StockContext, siteId: string) {
    const site = await tx.stockSite.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: siteId } },
      select: { id: true, name: true, isArchived: true },
    });
    if (!site || !stockSiteAllowed(ctx, site.id)) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private async sitePriceHistory(
    tx: Tx,
    ctx: StockContext,
    productId: string,
    variantId: string,
    site: { id: string; name: string },
    oldPrice: number | null,
    newPrice: number | null,
  ) {
    const variant = await tx.stockVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { name: true },
    });
    await tx.stockPriceHistory.create({
      data: {
        organizationId: ctx.organizationId,
        variantId,
        kind: 'SALE',
        siteId: site.id,
        oldPrice,
        newPrice,
        changedByUserId: ctx.userId,
      },
    });
    await tx.stockProductHistory.create({
      data: {
        organizationId: ctx.organizationId,
        productId,
        actorUserId: ctx.userId,
        action: newPrice === null ? 'site_price_removed' : 'site_price_set',
        changes: {
          ...(variant.name ? { variant: [variant.name, variant.name] } : {}),
          site: [site.name, site.name],
          salePrice: [oldPrice, newPrice],
        },
      },
    });
  }

  // ─── Codes-barres ───

  async addBarcode(ctx: StockContext, variantId: string, dto: StockBarcodeDto) {
    const problem = barcodeProblem(dto.type, dto.code);
    if (problem) throw new BadRequestException({ code: 'STOCK_BARCODE_INVALID', message: problem });
    return this.insertBarcode(ctx, variantId, dto.type, dto.code);
  }

  /** Code interne pour un article sans code fabricant : un seul par variante. */
  async generateInternalCode(ctx: StockContext, variantId: string) {
    return this.db
      .$transaction(async (tx) => {
        const variant = await this.variantOf(tx, ctx, variantId);
        const existing = await tx.stockBarcode.findFirst({
          where: { organizationId: ctx.organizationId, variantId, type: 'INTERNAL' },
          select: { code: true },
        });
        if (existing) {
          throw new ConflictException({
            code: 'STOCK_INTERNAL_CODE_EXISTS',
            message: `Cette variante a déjà un code interne (${existing.code}).`,
          });
        }
        const settings = await tx.stockSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        });
        const prefix = settings?.internalCodePrefix ?? 'OC';
        // Numéro suivant libre (un code saisi à la main ne peut pas avoir ce format, mais un changement de
        // préfixe peut retomber sur un numéro déjà pris).
        for (let attempt = 0; attempt < 20; attempt++) {
          const code = stockInternalCode(
            prefix,
            await this.nextCounter(tx, ctx.organizationId, 'INTERNAL_CODE'),
          );
          const taken = await tx.stockBarcode.findUnique({
            where: { organizationId_code: { organizationId: ctx.organizationId, code } },
            select: { id: true },
          });
          if (taken) continue;
          const barcode = await tx.stockBarcode.create({
            data: {
              organizationId: ctx.organizationId,
              variantId,
              type: 'INTERNAL',
              code,
              createdByUserId: ctx.userId,
            },
            select: { id: true, type: true, code: true, createdAt: true },
          });
          await this.barcodeHistory(tx, ctx, variant.productId, 'barcode_added', code);
          return { barcode, productId: variant.productId };
        }
        throw new ConflictException({ code: 'STOCK_COUNTER_EXHAUSTED', message: 'Réessayez.' });
      })
      .then(async (r) => {
        await this.record(ctx, 'stock.barcode_added', 'StockBarcode', r.barcode.id);
        return r.barcode;
      });
  }

  async removeBarcode(ctx: StockContext, id: string) {
    const removed = await this.db.$transaction(async (tx) => {
      const barcode = await tx.stockBarcode.findFirst({
        where: { organizationId: ctx.organizationId, id },
        select: { id: true, code: true, variant: { select: { productId: true } } },
      });
      if (!barcode)
        throw new NotFoundException({
          code: 'STOCK_BARCODE_NOT_FOUND',
          message: 'Code introuvable.',
        });
      await tx.stockBarcode.delete({ where: { id } });
      await this.barcodeHistory(
        tx,
        ctx,
        barcode.variant.productId,
        'barcode_removed',
        barcode.code,
      );
      return barcode;
    });
    await this.record(ctx, 'stock.barcode_removed', 'StockBarcode', removed.id);
  }

  /**
   * Lecture d'un scanner ou saisie : code-barres exact, sinon référence de variante (sans tenir compte de
   * la casse). Un code inconnu renvoie son type probable (proposition de création).
   */
  async lookup(ctx: StockContext, raw: string) {
    const code = normalizeScannedCode(raw);
    if (!code) return { found: false as const, code, detectedType: null };
    // Un UPC-A peut être lu sous sa forme EAN-13 (« 0 » + code) : les deux écritures sont cherchées.
    const barcode = await this.db.stockBarcode.findFirst({
      where: { organizationId: ctx.organizationId, code: { in: gtinEquivalents(code) } },
      select: { variantId: true },
    });
    const variant = await this.db.stockVariant.findFirst({
      where: barcode
        ? { organizationId: ctx.organizationId, id: barcode.variantId }
        : { organizationId: ctx.organizationId, sku: { equals: code, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        sku: true,
        isArchived: true,
        product: { select: { id: true, name: true, isArchived: true } },
      },
    });
    if (!variant) return { found: false as const, code, detectedType: detectBarcodeType(code) };
    return {
      found: true as const,
      code,
      matchedBy: barcode ? ('barcode' as const) : ('sku' as const),
      product: variant.product,
      variant: {
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        isArchived: variant.isArchived,
      },
    };
  }

  // ─── Recherche (partagée avec la recherche globale) ───

  /**
   * Identifiants d'articles par pertinence : code-barres exact, référence (début), nom (contient, ou
   * trigrammes tolérant les fautes), sans tenir compte des accents ni de la casse. Requête paramétrée.
   */
  async searchProductIds(organizationId: string, q: string, limit: number): Promise<string[]> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      WITH q AS (SELECT "stock_search_text"(${q}) AS t, lower(${q}) AS raw)
      SELECT p.id FROM "StockProduct" p, q
      WHERE p."organizationId" = ${organizationId}::uuid
        AND (
          EXISTS (
            SELECT 1 FROM "StockBarcode" b JOIN "StockVariant" v ON v.id = b."variantId"
            WHERE b."organizationId" = p."organizationId" AND v."productId" = p.id
              AND b.code = ANY(${gtinEquivalents(q)}::text[])
          )
          OR EXISTS (
            SELECT 1 FROM "StockVariant" v
            WHERE v."organizationId" = p."organizationId" AND v."productId" = p.id
              AND lower(v.sku) LIKE q.raw || '%'
          )
          OR "stock_search_text"(p.name) LIKE '%' || q.t || '%'
          OR word_similarity(q.t, "stock_search_text"(p.name)) >= ${FUZZY_THRESHOLD}
        )
      ORDER BY
        (lower(p.sku) = q.raw) DESC,
        ("stock_search_text"(p.name) LIKE q.t || '%') DESC,
        word_similarity(q.t, "stock_search_text"(p.name)) DESC,
        p.name ASC
      LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  // ─── Outils ───

  private productListSelect() {
    return {
      id: true,
      sku: true,
      name: true,
      unit: true,
      salePrice: true,
      purchasePrice: true,
      vatRate: true,
      isStockable: true,
      isArchived: true,
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      _count: { select: { variants: { where: { isDefault: false, isArchived: false } } } },
      variants: {
        where: { isDefault: true },
        select: {
          id: true,
          barcodes: {
            take: 1,
            orderBy: { createdAt: 'asc' as const },
            select: { code: true, type: true },
          },
        },
      },
      images: { where: { position: 0 }, select: { id: true } },
    } satisfies Prisma.StockProductSelect;
  }

  private listView(
    ctx: StockContext,
    r: Prisma.StockProductGetPayload<{
      select: ReturnType<OcallStockCatalogService['productListSelect']>;
    }>,
  ) {
    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      salePrice: r.salePrice,
      purchasePrice: stockCan(ctx, 'stock.prices.purchase.read') ? r.purchasePrice : undefined,
      vatRate: r.vatRate,
      isStockable: r.isStockable,
      isArchived: r.isArchived,
      category: r.category,
      brand: r.brand,
      variantCount: r._count.variants,
      defaultVariantId: r.variants[0]?.id ?? null,
      barcode: r.variants[0]?.barcodes[0] ?? null,
      imageId: r.images[0]?.id ?? null,
    };
  }

  private async insertBarcode(
    ctx: StockContext,
    variantId: string,
    type: 'EAN13' | 'EAN8' | 'UPCA',
    code: string,
  ) {
    try {
      const barcode = await this.db.$transaction(async (tx) => {
        const variant = await this.variantOf(tx, ctx, variantId);
        // Même code sous une autre écriture (UPC-A ↔ EAN-13 « 0 » + code) : déjà attribué.
        const twin = await tx.stockBarcode.findFirst({
          where: { organizationId: ctx.organizationId, code: { in: gtinEquivalents(code) } },
          select: { variant: { select: { product: { select: { name: true } } } } },
        });
        if (twin) throw barcodeTaken(twin.variant.product.name);
        const created = await tx.stockBarcode.create({
          data: {
            organizationId: ctx.organizationId,
            variantId,
            type,
            code,
            createdByUserId: ctx.userId,
          },
          select: { id: true, type: true, code: true, createdAt: true },
        });
        await this.barcodeHistory(tx, ctx, variant.productId, 'barcode_added', code);
        return created;
      });
      await this.record(ctx, 'stock.barcode_added', 'StockBarcode', barcode.id);
      return barcode;
    } catch (e) {
      if (uniqueTarget(e)) {
        const owner = await this.db.stockBarcode.findFirst({
          where: { organizationId: ctx.organizationId, code: { in: gtinEquivalents(code) } },
          select: { variant: { select: { product: { select: { name: true } } } } },
        });
        throw barcodeTaken(owner?.variant.product.name ?? null);
      }
      throw e;
    }
  }

  private async barcodeHistory(
    tx: Tx,
    ctx: StockContext,
    productId: string,
    action: string,
    code: string,
  ) {
    await tx.stockProductHistory.create({
      data: {
        organizationId: ctx.organizationId,
        productId,
        actorUserId: ctx.userId,
        action,
        changes: { barcode: action === 'barcode_added' ? [null, code] : [code, null] },
      },
    });
  }

  private async variantOf(tx: Tx, ctx: StockContext, variantId: string) {
    const variant = await tx.stockVariant.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: variantId } },
      select: { id: true, productId: true },
    });
    if (!variant) throw new NotFoundException(VARIANT_NOT_FOUND);
    return variant;
  }

  private async lockProduct(tx: Tx, ctx: StockContext, id: string) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StockProduct"
      WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
    if (!locked) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return tx.stockProduct.findUniqueOrThrow({ where: { id } });
  }

  private async assertVariantNameFree(
    tx: Tx,
    ctx: StockContext,
    productId: string,
    name: string,
    exceptId: string | null,
  ) {
    const same = await tx.stockVariant.findFirst({
      where: {
        organizationId: ctx.organizationId,
        productId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (same) {
      throw new ConflictException({
        code: 'STOCK_VARIANT_NAME_TAKEN',
        message: 'Cet article a déjà une variante de ce nom.',
      });
    }
  }

  /** Catégorie et marque de l'organisation, non archivées (null = aucune). */
  private async assertLinks(
    tx: Tx,
    ctx: StockContext,
    categoryId?: string | null,
    brandId?: string | null,
  ) {
    if (categoryId) await this.activeCategory(tx, ctx, categoryId);
    if (brandId) {
      const brand = await tx.stockBrand.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: brandId } },
        select: { isArchived: true },
      });
      if (!brand || brand.isArchived) throw new BadRequestException(BRAND_NOT_FOUND);
    }
  }

  private async activeCategory(tx: Tx | OcallStockPrismaService, ctx: StockContext, id: string) {
    const category = await tx.stockCategory.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
      select: { isArchived: true },
    });
    if (!category || category.isArchived) throw new BadRequestException(CATEGORY_NOT_FOUND);
  }

  /** Référence générée libre : compteur continu, en sautant une référence déjà saisie à la main. */
  private async freeSku(tx: Tx, organizationId: string, prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const sku = stockGeneratedSku(prefix, await this.nextCounter(tx, organizationId, 'SKU'));
      const same = { organizationId, sku: { equals: sku, mode: 'insensitive' as const } };
      const [product, variant] = await Promise.all([
        tx.stockProduct.findFirst({ where: same, select: { id: true } }),
        tx.stockVariant.findFirst({ where: same, select: { id: true } }),
      ]);
      if (!product && !variant) return sku;
    }
    throw new ConflictException({ code: 'STOCK_COUNTER_EXHAUSTED', message: 'Réessayez.' });
  }

  /** Compteur continu (ligne verrouillée par l'incrément atomique). */
  private async nextCounter(
    tx: Tx,
    organizationId: string,
    kind: 'SKU' | 'INTERNAL_CODE',
  ): Promise<number> {
    const counter = await tx.stockNumberCounter.upsert({
      where: { organizationId_kind: { organizationId, kind } },
      create: { organizationId, kind, value: 1 },
      update: { value: { increment: 1 } },
      select: { value: true },
    });
    return counter.value;
  }

  private assertCan(
    ctx: StockContext,
    permission: Parameters<typeof stockCan>[1],
    message: string,
  ) {
    if (!stockCan(ctx, permission)) {
      throw new ForbiddenException({ code: 'STOCK_PRICE_FORBIDDEN', message });
    }
  }

  private skuErrors(e: unknown): never {
    const target = uniqueTarget(e);
    if (target && target.includes('sku')) {
      throw new ConflictException({
        code: 'STOCK_SKU_TAKEN',
        message: 'Cette référence est déjà utilisée.',
      });
    }
    throw e;
  }

  private async categoryErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (uniqueTarget(e)) {
        throw new ConflictException({
          code: 'STOCK_CATEGORY_NAME_TAKEN',
          message: 'Une catégorie de ce niveau porte déjà ce nom.',
        });
      }
      if (pgMessage(e).includes('STOCK_CATEGORY_DEPTH')) {
        throw new ConflictException({
          code: 'STOCK_CATEGORY_DEPTH',
          message: 'Deux niveaux au plus : une sous-catégorie ne peut pas en contenir d’autres.',
        });
      }
      throw e;
    }
  }

  private async nameUnique<T>(code: string, message: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (uniqueTarget(e)) throw new ConflictException({ code, message });
      throw e;
    }
  }

  private async record(
    ctx: StockContext,
    action: string,
    targetType: string,
    targetId: string,
    fields?: string[],
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      ...(fields ? { metadata: { fields } } : {}),
    });
  }
}
