import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { coversActivity } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import type {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
  VariantDto,
} from './catalog.dto';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: {
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      isActive: true,
      prices: { select: { establishmentId: true, price: true, isAvailable: true } },
    },
  },
} satisfies Prisma.ProductInclude;

const PRODUCT_NOT_FOUND = { code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' };
const CATEGORY_NOT_FOUND = { code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable.' };

/**
 * Catalogue de l'organisation : catégories, produits, variantes et tarifs par établissement.
 * Rien n'est jamais supprimé physiquement (désactivation), car les ventes passées y font référence.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listCategories(auth: TenantContext) {
    return this.prisma.productCategory.findMany({
      where: { organizationId: auth.membership.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        _count: { select: { products: true } },
      },
    });
  }

  async createCategory(auth: TenantContext, dto: CreateCategoryDto) {
    const organizationId = auth.membership.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.productCategory.create({
        data: { organizationId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'catalog.category_created',
          targetType: 'ProductCategory',
          targetId: category.id,
          metadata: { name: dto.name },
        },
        tx,
      );
      return category;
    });
  }

  async updateCategory(auth: TenantContext, id: string, dto: UpdateCategoryDto) {
    const organizationId = auth.membership.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.productCategory.updateMany({
        where: { id, organizationId },
        data: dto,
      });
      if (result.count !== 1) throw new NotFoundException(CATEGORY_NOT_FOUND);
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'catalog.category_updated',
          targetType: 'ProductCategory',
          targetId: id,
          metadata: { ...dto },
        },
        tx,
      );
      return tx.productCategory.findUniqueOrThrow({ where: { id } });
    });
  }

  listProducts(auth: TenantContext) {
    return this.prisma.product.findMany({
      where: { organizationId: auth.membership.organizationId },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: PRODUCT_INCLUDE,
    });
  }

  async getProduct(auth: TenantContext, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return product;
  }

  async createProduct(auth: TenantContext, dto: CreateProductDto) {
    const organizationId = auth.membership.organizationId;
    this.assertUniqueVariantNames(dto.variants);
    const productId = await this.prisma.$transaction(async (tx) => {
      await this.assertCategory(tx, organizationId, dto.categoryId);
      await this.assertPriceEstablishments(tx, organizationId, dto.variants);
      const product = await tx.product.create({
        data: {
          organizationId,
          categoryId: dto.categoryId,
          name: dto.name,
          description: dto.description,
        },
      });
      await this.syncVariants(tx, organizationId, product.id, dto.variants);
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'catalog.product_created',
          targetType: 'Product',
          targetId: product.id,
          metadata: { name: dto.name },
        },
        tx,
      );
      return product.id;
    });
    return this.getProduct(auth, productId);
  }

  async updateProduct(auth: TenantContext, id: string, dto: UpdateProductDto) {
    const organizationId = auth.membership.organizationId;
    if (dto.variants) this.assertUniqueVariantNames(dto.variants);
    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, organizationId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
      if (dto.categoryId) await this.assertCategory(tx, organizationId, dto.categoryId);
      const { variants, ...fields } = dto;
      await tx.product.update({ where: { id }, data: fields });
      if (variants) {
        await this.assertPriceEstablishments(tx, organizationId, variants);
        await this.syncVariants(tx, organizationId, id, variants);
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'catalog.product_updated',
          targetType: 'Product',
          targetId: id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.getProduct(auth, id);
  }

  /**
   * Aligne les variantes d'un produit sur la liste reçue : création, mise à jour, désactivation
   * des variantes absentes ; tarifs créés ou mis à jour par établissement, et rendus indisponibles
   * dans les établissements qui ne figurent plus dans la liste.
   */
  private async syncVariants(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
    variants: VariantDto[],
  ): Promise<void> {
    const existing = await tx.productVariant.findMany({
      where: { productId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((v) => v.id));
    for (const v of variants) {
      if (v.id && !existingIds.has(v.id)) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Variante inconnue pour ce produit.',
        });
      }
    }
    const keptIds = new Set(variants.map((v) => v.id).filter((id): id is string => !!id));
    await tx.productVariant.updateMany({
      where: { productId, id: { notIn: [...keptIds] } },
      data: { isActive: false },
    });

    for (const [index, v] of variants.entries()) {
      const variant = v.id
        ? await tx.productVariant.update({
            where: { id: v.id },
            data: { name: v.name, sortOrder: index, isActive: v.isActive ?? true },
          })
        : await tx.productVariant.create({
            data: {
              organizationId,
              productId,
              name: v.name,
              sortOrder: index,
              isActive: v.isActive ?? true,
            },
          });
      const listed = v.prices.map((p) => p.establishmentId);
      await tx.variantPrice.updateMany({
        where: { variantId: variant.id, establishmentId: { notIn: listed } },
        data: { isAvailable: false },
      });
      for (const p of v.prices) {
        await tx.variantPrice.upsert({
          where: {
            variantId_establishmentId: {
              variantId: variant.id,
              establishmentId: p.establishmentId,
            },
          },
          create: {
            organizationId,
            variantId: variant.id,
            establishmentId: p.establishmentId,
            price: p.price,
            isAvailable: p.isAvailable ?? true,
          },
          update: { price: p.price, isAvailable: p.isAvailable ?? true },
        });
      }
    }
  }

  private assertUniqueVariantNames(variants: VariantDto[]): void {
    const names = variants.map((v) => v.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_VARIANT',
        message: 'Deux variantes portent le même nom.',
      });
    }
    for (const v of variants) {
      const ids = v.prices.map((p) => p.establishmentId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException({
          code: 'DUPLICATE_PRICE',
          message: 'Un établissement a plusieurs tarifs pour la même variante.',
        });
      }
    }
  }

  private async assertCategory(
    tx: Prisma.TransactionClient,
    organizationId: string,
    categoryId: string,
  ) {
    const category = await tx.productCategory.findFirst({
      where: { id: categoryId, organizationId },
      select: { id: true },
    });
    if (!category) throw new BadRequestException(CATEGORY_NOT_FOUND);
  }

  /** Les tarifs ne visent que des établissements restaurant de l'organisation (isolation multi-tenant). */
  private async assertPriceEstablishments(
    tx: Prisma.TransactionClient,
    organizationId: string,
    variants: VariantDto[],
  ) {
    const ids = [...new Set(variants.flatMap((v) => v.prices.map((p) => p.establishmentId)))];
    if (ids.length === 0) return;
    const establishments = await tx.establishment.findMany({
      where: { organizationId, id: { in: ids } },
      select: { businessType: true },
    });
    if (
      establishments.length !== ids.length ||
      establishments.some((e) => !coversActivity(e.businessType, 'RESTAURANT'))
    ) {
      throw new BadRequestException({
        code: 'INVALID_ESTABLISHMENT',
        message: 'Les tarifs doivent viser des établissements restaurant de votre organisation.',
      });
    }
  }
}
