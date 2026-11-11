import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  STOCK_PRODUCT_CODE,
  type ProductAccess,
  type StockPermission,
  type StockRole,
  stockEffectivePermissions,
} from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';

const STOCK_PERMISSION = 'ocallStockPermission';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Contexte d'une requête Ocall Stock : seule source fiable de l'organisation, du rôle et des droits. */
export interface StockContext {
  organizationId: string;
  userId: string;
  access: ProductAccess;
  role: StockRole;
  /** Permissions effectives : rôle et ajustements propres au membre. */
  permissions: StockPermission[];
  /** Ligne Stock du compte ; null pour le propriétaire de l'organisation, administrateur d'office. */
  memberId: string | null;
  isOwner: boolean;
}

type StockRequest = Request & { ocallStock?: StockContext };

/** Permission exigée ; plusieurs : l'une d'elles suffit. */
export const RequireStockPermission = (...permissions: StockPermission[]) =>
  SetMetadata(STOCK_PERMISSION, permissions);

export const CurrentStock = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<StockRequest>().ocallStock as StockContext;
});

/** Vrai si le contexte porte la permission (contrôles fins dans les services). */
export const stockCan = (ctx: StockContext, permission: StockPermission) =>
  ctx.permissions.includes(permission);

/**
 * Garde de toutes les routes Ocall Stock, dans cet ordre : application activée, membre d'organisation,
 * abonnement ou essai, lecture seule, rôle Stock, permission. Un rôle Park, School ou Facture ne donne
 * aucun droit Stock, sauf le propriétaire de l'organisation, administrateur d'office.
 */
@Injectable()
export class OcallStockAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly core: PrismaService,
    private readonly db: OcallStockPrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.stock.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    }
    const req = context.switchToHttp().getRequest<StockRequest>();
    const auth = req.auth as TenantContext | undefined;
    if (!auth?.membership) throw this.denied();
    const organizationId = auth.membership.organizationId;

    const access = await loadAppAccess(this.core, organizationId, STOCK_PRODUCT_CODE);
    if (access === 'none') {
      throw new ForbiddenException({
        code: 'PRODUCT_NOT_ENABLED',
        message: 'Ocall Stock n’est pas activé pour votre organisation.',
      });
    }
    // Essai échu, abonnement expiré ou suspendu : consultation uniquement, aucune donnée supprimée.
    if (access === 'read_only' && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_READ_ONLY',
        message: 'Votre abonnement Ocall Stock ne permet plus que la consultation.',
      });
    }

    const isOwner = auth.membership.role === 'OWNER';
    const member =
      !isOwner && auth.membership.role === 'PRODUCT_USER'
        ? await this.db.stockMember.findFirst({
            where: { organizationId, userId: auth.user.id, isActive: true },
            select: {
              id: true,
              role: true,
              permissions: { select: { permission: true, granted: true } },
            },
          })
        : null;
    if (!isOwner && !member) throw this.denied();
    const role: StockRole = member?.role ?? 'ADMIN';
    const permissions = stockEffectivePermissions(role, member?.permissions ?? []);

    const required = this.reflector.getAllAndOverride<StockPermission[] | undefined>(
      STOCK_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (required && !required.some((p) => permissions.includes(p))) throw this.denied();

    req.ocallStock = {
      organizationId,
      userId: auth.user.id,
      access,
      role,
      permissions,
      memberId: member?.id ?? null,
      isOwner,
    };
    return true;
  }

  private denied() {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }
}
