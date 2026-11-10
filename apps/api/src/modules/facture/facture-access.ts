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
  FACTURE_PRODUCT_CODE,
  type FacturePermission,
  type FactureRole,
  type ProductAccess,
  hasFacturePermission,
} from '@ocall/shared';
import { loadAppAccess } from '../../common/app-access';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturePrismaService } from './facture-prisma.service';

const FACTURE_PERMISSION = 'facturePermission';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Contexte d'une requête Ocall Facture : seule source fiable du client, du rôle et du droit. */
export interface FactureContext {
  organizationId: string;
  userId: string;
  access: ProductAccess;
  role: FactureRole;
  /** Ligne Facture du compte ; null pour le propriétaire de l'organisation, gérant d'office. */
  memberId: string | null;
  isOwner: boolean;
}

type FactureRequest = Request & { facture?: FactureContext };

export const RequireFacturePermission = (permission: FacturePermission) =>
  SetMetadata(FACTURE_PERMISSION, permission);

export const CurrentFacture = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<FactureRequest>().facture as FactureContext;
});

/**
 * Garde de toutes les routes Facture, dans cet ordre : application activée, membre d'organisation,
 * abonnement ou essai, lecture seule, rôle Facture, permission. Un rôle Ocall Park ou School ne donne
 * aucun droit Facture, sauf le propriétaire de l'organisation, gérant d'office.
 */
@Injectable()
export class FactureAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly core: PrismaService,
    private readonly db: FacturePrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.facture.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    }
    const req = context.switchToHttp().getRequest<FactureRequest>();
    const auth = req.auth as TenantContext | undefined;
    if (!auth?.membership) throw this.denied();
    const organizationId = auth.membership.organizationId;

    const access = await loadAppAccess(this.core, organizationId, FACTURE_PRODUCT_CODE);
    if (access === 'none') {
      throw new ForbiddenException({
        code: 'PRODUCT_NOT_ENABLED',
        message: 'Ocall Facture n’est pas activé pour votre organisation.',
      });
    }
    // Essai échu, abonnement expiré ou suspendu : consultation uniquement, aucune donnée supprimée.
    if (access === 'read_only' && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_READ_ONLY',
        message: 'Votre abonnement Ocall Facture ne permet plus que la consultation.',
      });
    }

    const isOwner = auth.membership.role === 'OWNER';
    const member = isOwner
      ? null
      : auth.membership.role === 'PRODUCT_USER'
        ? await this.db.factureMember.findFirst({
            where: { organizationId, userId: auth.user.id, isActive: true },
            select: { id: true, role: true },
          })
        : null;
    if (!isOwner && !member) throw this.denied();
    const role: FactureRole = member?.role ?? 'MANAGER';

    const permission = this.reflector.getAllAndOverride<FacturePermission | undefined>(
      FACTURE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (permission && !hasFacturePermission(role, permission)) throw this.denied();

    req.facture = {
      organizationId,
      userId: auth.user.id,
      access,
      role,
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
