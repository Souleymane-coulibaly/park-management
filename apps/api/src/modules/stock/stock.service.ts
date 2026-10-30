import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { hasPermission, isStockLow } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment, lockRow } from '../pos/pos-scope';
import type {
  CreateStockItemDto,
  CreateStockMovementDto,
  MovementsQueryDto,
  PutRecipeDto,
  UpdateStockItemDto,
} from './stock.dto';

const ITEM_NOT_FOUND = { code: 'STOCK_ITEM_NOT_FOUND', message: 'Article de stock introuvable.' };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const ITEM_SELECT = {
  id: true,
  name: true,
  unit: true,
  quantity: true,
  alertThreshold: true,
  unitCost: true,
  isActive: true,
  updatedAt: true,
} as const satisfies Prisma.StockItemSelect;

type ItemRow = Prisma.StockItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** Les quantités sont stockées en décimal exact (3 décimales) et exposées en nombre. */
function toItem(i: ItemRow) {
  const quantity = i.quantity.toNumber();
  const alertThreshold = i.alertThreshold?.toNumber() ?? null;
  return { ...i, quantity, alertThreshold, low: isStockLow(quantity, alertThreshold) };
}

const MOVEMENT_SELECT = {
  id: true,
  kind: true,
  quantity: true,
  quantityAfter: true,
  unitCost: true,
  reason: true,
  saleId: true,
  createdAt: true,
  stockItem: { select: { id: true, name: true, unit: true } },
  sale: { select: { number: true } },
  actor: { select: { user: { select: { firstName: true, lastName: true } } } },
} as const satisfies Prisma.StockMovementSelect;

type MovementRow = Prisma.StockMovementGetPayload<{ select: typeof MOVEMENT_SELECT }>;

const toMovement = ({ actor, sale, ...m }: MovementRow) => ({
  ...m,
  quantity: m.quantity.toNumber(),
  quantityAfter: m.quantityAfter.toNumber(),
  saleNumber: sale?.number ?? null,
  actorName: actor ? `${actor.user.firstName} ${actor.user.lastName}` : null,
});

/**
 * Stocks d'un établissement restaurant : articles et ingrédients, mouvements (entrées, sorties,
 * ajustements d'inventaire, consommations des ventes), recettes simples et alertes de seuil.
 * Un coût d'achat inconnu reste inconnu (null) : il n'est jamais estimé.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: TenantContext, establishmentId: string) {
    await findSellingEstablishment(this.prisma, auth, establishmentId, 'RESTAURANT');
    const items = await this.prisma.stockItem.findMany({
      where: { organizationId: auth.membership.organizationId, establishmentId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: ITEM_SELECT,
    });
    return items.map(toItem);
  }

  async create(auth: TenantContext, dto: CreateStockItemDto) {
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    try {
      const item = await this.prisma.stockItem.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId: dto.establishmentId,
          name: dto.name,
          unit: dto.unit,
          alertThreshold: dto.alertThreshold ?? null,
          unitCost: dto.unitCost ?? null,
        },
        select: ITEM_SELECT,
      });
      await this.record(auth, 'stock.item_created', item.id, { name: dto.name, unit: dto.unit });
      return toItem(item);
    } catch (error) {
      if (isUniqueViolation(error)) throw this.nameTaken();
      throw error;
    }
  }

  async update(auth: TenantContext, id: string, dto: UpdateStockItemDto) {
    await this.findItem(auth, id);
    try {
      const item = await this.prisma.stockItem.update({
        where: { id },
        data: dto,
        select: ITEM_SELECT,
      });
      await this.record(auth, 'stock.item_updated', id, { ...dto });
      return toItem(item);
    } catch (error) {
      if (isUniqueViolation(error)) throw this.nameTaken();
      throw error;
    }
  }

  /**
   * Entrée, sortie ou ajustement d'inventaire, sous verrou de l'article. Une sortie ne peut pas dépasser
   * la quantité disponible ; un ajustement fixe la quantité comptée et enregistre l'écart. Rejouer la
   * même clé renvoie le mouvement déjà enregistré.
   */
  async move(auth: TenantContext, dto: CreateStockMovementDto) {
    const required = dto.kind === 'ADJUSTMENT' ? 'stock.manage' : 'stock.move';
    if (!hasPermission(auth.membership.role, required)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    const item = await this.findItem(auth, dto.stockItemId);
    const key = `req:${dto.clientRequestId}`;
    const replay = await this.findReplay(auth, key, item.id);
    if (replay) return replay;

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await lockRow(tx, 'StockItem', item.id);
        const current = await tx.stockItem.findUniqueOrThrow({
          where: { id: item.id },
          select: { quantity: true, isActive: true, name: true },
        });
        if (!current.isActive) {
          throw new ConflictException({
            code: 'STOCK_ITEM_INACTIVE',
            message: 'Cet article est désactivé.',
          });
        }
        const quantity = new Prisma.Decimal(dto.quantity);
        let delta: Prisma.Decimal;
        if (dto.kind === 'IN') delta = quantity;
        else if (dto.kind === 'OUT') {
          if (quantity.gt(current.quantity)) {
            throw new BadRequestException({
              code: 'INSUFFICIENT_STOCK',
              message: 'La sortie dépasse la quantité disponible.',
            });
          }
          delta = quantity.neg();
        } else delta = quantity.sub(current.quantity);
        if (dto.kind !== 'ADJUSTMENT' && quantity.isZero()) {
          throw new BadRequestException({
            code: 'INVALID_QUANTITY',
            message: 'La quantité doit être positive.',
          });
        }
        const after = current.quantity.add(delta);
        await tx.stockItem.update({
          where: { id: item.id },
          data: {
            quantity: after,
            // Le dernier coût d'achat connu est conservé ; aucun coût n'est inventé.
            ...(dto.kind === 'IN' && dto.unitCost !== undefined ? { unitCost: dto.unitCost } : {}),
          },
        });
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: auth.membership.organizationId,
            establishmentId: item.establishmentId,
            stockItemId: item.id,
            kind: dto.kind,
            quantity: delta,
            quantityAfter: after,
            unitCost: dto.kind === 'IN' ? (dto.unitCost ?? null) : null,
            reason: dto.reason ?? null,
            actorMembershipId: auth.membership.id,
            idempotencyKey: key,
          },
          select: { id: true },
        });
        if (dto.kind === 'ADJUSTMENT') {
          await this.audit.record(
            {
              organizationId: auth.membership.organizationId,
              actorUserId: auth.user.id,
              action: 'stock.adjusted',
              targetType: 'StockItem',
              targetId: item.id,
              metadata: {
                name: current.name,
                before: current.quantity.toNumber(),
                counted: dto.quantity,
                reason: dto.reason ?? null,
              },
            },
            tx,
          );
        }
        return movement.id;
      });
      return this.getMovement(id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findReplay(auth, key, item.id);
        if (again) return again;
      }
      throw error;
    }
  }

  async movements(auth: TenantContext, query: MovementsQueryDto) {
    await findSellingEstablishment(this.prisma, auth, query.establishmentId, 'RESTAURANT');
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: query.establishmentId,
        stockItemId: query.stockItemId,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: MOVEMENT_SELECT,
    });
    return rows.map(toMovement);
  }

  /** Recettes de l'établissement : ingrédients consommés par unité vendue de chaque variante. */
  async recipes(auth: TenantContext, establishmentId: string) {
    await findSellingEstablishment(this.prisma, auth, establishmentId, 'RESTAURANT');
    const rows = await this.prisma.recipeComponent.findMany({
      where: { organizationId: auth.membership.organizationId, stockItem: { establishmentId } },
      orderBy: { stockItem: { name: 'asc' } },
      select: {
        variantId: true,
        quantity: true,
        stockItem: { select: { id: true, name: true, unit: true } },
      },
    });
    const byVariant = new Map<
      string,
      { stockItemId: string; name: string; unit: string; quantity: number }[]
    >();
    for (const r of rows) {
      const list = byVariant.get(r.variantId) ?? [];
      list.push({
        stockItemId: r.stockItem.id,
        name: r.stockItem.name,
        unit: r.stockItem.unit,
        quantity: r.quantity.toNumber(),
      });
      byVariant.set(r.variantId, list);
    }
    return [...byVariant.entries()].map(([variantId, components]) => ({ variantId, components }));
  }

  /** Remplace la recette d'une variante pour un établissement (les autres établissements sont intacts). */
  async putRecipe(auth: TenantContext, variantId: string, dto: PutRecipeDto) {
    const organizationId = auth.membership.organizationId;
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId, 'RESTAURANT');
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, organizationId },
      select: { id: true, name: true, product: { select: { name: true } } },
    });
    if (!variant) {
      throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Article introuvable.' });
    }
    const ids = dto.components.map((c) => c.stockItemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_COMPONENT',
        message: 'Un ingrédient apparaît deux fois dans la recette.',
      });
    }
    const owned = await this.prisma.stockItem.count({
      where: { id: { in: ids }, organizationId, establishmentId: dto.establishmentId },
    });
    if (owned !== ids.length) throw new NotFoundException(ITEM_NOT_FOUND);

    await this.prisma.$transaction(async (tx) => {
      await tx.recipeComponent.deleteMany({
        where: { variantId, stockItem: { establishmentId: dto.establishmentId } },
      });
      if (dto.components.length > 0) {
        await tx.recipeComponent.createMany({
          data: dto.components.map((c) => ({
            organizationId,
            variantId,
            stockItemId: c.stockItemId,
            quantity: c.quantity,
          })),
        });
      }
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'stock.recipe_updated',
          targetType: 'ProductVariant',
          targetId: variantId,
          metadata: {
            establishmentId: dto.establishmentId,
            product: `${variant.product.name} (${variant.name})`,
            components: dto.components.length,
          },
        },
        tx,
      );
    });
    return { variantId, components: dto.components };
  }

  private async findItem(auth: TenantContext, id: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: { id: true, establishmentId: true },
    });
    if (!item) throw new NotFoundException(ITEM_NOT_FOUND);
    return item;
  }

  private async findReplay(auth: TenantContext, key: string, stockItemId: string) {
    const existing = await this.prisma.stockMovement.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: auth.membership.organizationId,
          idempotencyKey: key,
        },
      },
      select: { id: true, stockItemId: true, actorMembershipId: true },
    });
    if (!existing) return null;
    if (existing.stockItemId !== stockItemId || existing.actorMembershipId !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    return this.getMovement(existing.id);
  }

  private async getMovement(id: string) {
    return toMovement(
      await this.prisma.stockMovement.findUniqueOrThrow({ where: { id }, select: MOVEMENT_SELECT }),
    );
  }

  private nameTaken() {
    return new ConflictException({
      code: 'NAME_TAKEN',
      message: 'Un article porte déjà ce nom dans cet établissement.',
    });
  }

  private record(
    auth: TenantContext,
    action: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.audit.record({
      organizationId: auth.membership.organizationId,
      actorUserId: auth.user.id,
      action,
      targetType: 'StockItem',
      targetId,
      metadata,
    });
  }
}
