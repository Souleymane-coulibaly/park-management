import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
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
import {
  appDenied,
  appTenant,
  assertAppActivated,
  assertAppEnabled,
  assertSubscriptionWritable,
  isOrganizationOwner,
} from '../../common/app-guard';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { FacturePrismaService } from './facture-prisma.service';

const FACTURE_PERMISSION = 'facturePermission';

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

/** Permission exigée ; plusieurs : l'une d'elles suffit (ex. planifier ou réaliser une intervention). */
export const RequireFacturePermission = (...permissions: FacturePermission[]) =>
  SetMetadata(FACTURE_PERMISSION, permissions);

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
    assertAppEnabled(this.config.facture.enabled);
    const req = context.switchToHttp().getRequest<FactureRequest>();
    const permissions = this.reflector.getAllAndOverride<FacturePermission[] | undefined>(
      FACTURE_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    req.facture = await resolveFactureContext(
      { core: this.core, db: this.db, config: this.config },
      appTenant(req.auth),
      req.method,
      permissions,
    );
    return true;
  }
}

/**
 * Contexte Ocall Facture d'un membre, dans l'ordre de la garde : application activée, droit commercial,
 * lecture seule, rôle Facture (le propriétaire est gérant d'office), permission (l'une suffit). Lève le
 * même refus que la garde. Seule source de ce calcul : garde des routes et lectures demandées par une
 * autre partie de l'API (tableau de bord de l'organisation).
 */
export async function resolveFactureContext(
  deps: { core: PrismaService; db: FacturePrismaService; config: AppConfig },
  auth: TenantContext,
  method: string,
  permissions?: readonly FacturePermission[],
): Promise<FactureContext> {
  assertAppEnabled(deps.config.facture.enabled);
  const organizationId = auth.membership.organizationId;

  const access = await loadAppAccess(deps.core, organizationId, FACTURE_PRODUCT_CODE);
  assertAppActivated(access, 'Ocall Facture');
  assertSubscriptionWritable(access, method, 'Ocall Facture');

  const isOwner = isOrganizationOwner(auth);
  // Sprint Suite 2A : rôle Facture pour tout membre de l'organisation (employé Park compris) ; le
  // propriétaire reste responsable d'office.
  const member = isOwner
    ? null
    : await deps.db.factureMember.findFirst({
        where: { organizationId, userId: auth.user.id, isActive: true },
        select: { id: true, role: true },
      });
  if (!isOwner && !member) throw appDenied();
  const role: FactureRole = member?.role ?? 'MANAGER';

  if (permissions && !permissions.some((p) => hasFacturePermission(role, p))) {
    throw appDenied();
  }

  return {
    organizationId,
    userId: auth.user.id,
    access,
    role,
    memberId: member?.id ?? null,
    isOwner,
  };
}
