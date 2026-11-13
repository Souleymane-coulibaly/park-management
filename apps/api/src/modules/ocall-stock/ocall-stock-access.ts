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
  /**
   * Sites accessibles : null = tous (administrateur, ou membre rattaché à aucun site) ; sinon les sites
   * auxquels le membre est rattaché.
   */
  siteIds: string[] | null;
}

type StockRequest = Request & { ocallStock?: StockContext };

/** Permission exigée ; plusieurs : l'une d'elles suffit. */
export const RequireStockPermission = (...permissions: StockPermission[]) =>
  SetMetadata(STOCK_PERMISSION, permissions);

export const CurrentStock = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<StockRequest>().ocallStock as StockContext;
});

/** Vrai si le membre peut agir sur ce site. */
export const stockSiteAllowed = (ctx: StockContext, siteId: string) =>
  ctx.siteIds === null || ctx.siteIds.includes(siteId);

/** Filtre Prisma des sites accessibles (objet vide si tous). */
export const stockSiteWhere = (ctx: StockContext, field = 'siteId') =>
  ctx.siteIds === null ? {} : { [field]: { in: ctx.siteIds } };

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

    const member = await stockMemberRights(
      this.db,
      organizationId,
      auth.user.id,
      auth.membership.role,
    );
    if (!member) throw this.denied();
    const { permissions } = member;

    const required = this.reflector.getAllAndOverride<StockPermission[] | undefined>(
      STOCK_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (required && !required.some((p) => permissions.includes(p))) throw this.denied();

    req.ocallStock = {
      organizationId,
      userId: auth.user.id,
      access,
      ...member,
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

/**
 * Droits Stock d'un compte de l'organisation : le propriétaire est administrateur d'office ; sinon, membre
 * Stock actif (rôle et ajustements). Null si le compte n'a aucun droit Stock. Seule source de ce calcul
 * (garde des routes, lectures demandées par une autre application).
 */
export async function stockMemberRights(
  db: OcallStockPrismaService,
  organizationId: string,
  userId: string,
  membershipRole: string,
): Promise<Pick<StockContext, 'role' | 'permissions' | 'memberId' | 'isOwner' | 'siteIds'> | null> {
  const isOwner = membershipRole === 'OWNER';
  const member =
    !isOwner && membershipRole === 'PRODUCT_USER'
      ? await db.stockMember.findFirst({
          where: { organizationId, userId, isActive: true },
          select: {
            id: true,
            role: true,
            permissions: { select: { permission: true, granted: true } },
            sites: { select: { siteId: true } },
          },
        })
      : null;
  if (!isOwner && !member) return null;
  const role: StockRole = member?.role ?? 'ADMIN';
  return {
    role,
    permissions: stockEffectivePermissions(role, member?.permissions ?? []),
    memberId: member?.id ?? null,
    isOwner,
    siteIds: role === 'ADMIN' || !member?.sites.length ? null : member.sites.map((s) => s.siteId),
  };
}
