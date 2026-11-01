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
  SCHOOL_PRODUCT_CODE,
  type ProductAccess,
  type SchoolPermission,
  type SchoolRole,
  hasAllSchoolsScope,
  hasSchoolPermission,
} from '@ocall/shared';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';
import { SchoolPrismaService } from './school-prisma.service';

const SCHOOL_PERMISSION = 'schoolPermission';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Contexte d'une requête School : seule source fiable du client, du rôle et des établissements. */
export interface SchoolContext {
  organizationId: string;
  userId: string;
  access: ProductAccess;
  modules: string[];
  limits: { maxSchools?: number };
  role: SchoolRole;
  /** Ligne School du compte ; null pour le propriétaire, direction du groupe d'office. */
  memberId: string | null;
  /** Établissements accessibles ; null = tous ceux du client. */
  schoolIds: string[] | null;
}

type SchoolRequest = Request & { school?: SchoolContext };

export const RequireSchoolPermission = (permission: SchoolPermission) =>
  SetMetadata(SCHOOL_PERMISSION, permission);

export const CurrentSchool = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<SchoolRequest>().school as SchoolContext;
});

/** Intersection du périmètre du rôle et de la couverture du contrat. */
export function resolveSchoolIds(
  assigned: string[] | null,
  covered: readonly string[],
): string[] | null {
  if (covered.length === 0) return assigned;
  return assigned ? assigned.filter((id) => covered.includes(id)) : [...covered];
}

/**
 * Garde de toutes les routes School, dans cet ordre : produit activé, membre d'organisation, contrat,
 * lecture seule, rôle School, permission. Un rôle Ocall Park ne donne aucun droit School, sauf le
 * propriétaire de l'organisation, qui signe le contrat et assure la direction du groupe.
 */
@Injectable()
export class SchoolAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contracts: SuiteContractsService,
    private readonly db: SchoolPrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.school.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    }
    const req = context.switchToHttp().getRequest<SchoolRequest>();
    const auth = req.auth as TenantContext | undefined;
    if (!auth?.membership) throw this.denied();
    const organizationId = auth.membership.organizationId;

    const entitlement = await this.contracts.entitlement(organizationId, SCHOOL_PRODUCT_CODE);
    if (entitlement.access === 'none') {
      throw new ForbiddenException({
        code: 'PRODUCT_NOT_ENABLED',
        message: 'Ocall School n’est pas activé par votre contrat.',
      });
    }
    // Contrat suspendu ou expiré : consultation et export uniquement, aucune donnée n'est supprimée.
    if (entitlement.access === 'read_only' && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException({
        code: 'CONTRACT_READ_ONLY',
        message: 'Votre contrat ne permet plus que la consultation et l’export des données.',
      });
    }

    const member =
      auth.membership.role === 'PRODUCT_USER'
        ? await this.db.schoolMember.findFirst({
            where: { organizationId, userId: auth.user.id, isActive: true },
            select: { id: true, role: true, assignments: { select: { schoolId: true } } },
          })
        : null;
    if (auth.membership.role !== 'OWNER' && !member) throw this.denied();
    const role: SchoolRole = member?.role ?? 'GROUP_DIRECTOR';

    const permission = this.reflector.getAllAndOverride<SchoolPermission | undefined>(
      SCHOOL_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (permission && !hasSchoolPermission(role, permission)) throw this.denied();

    const assigned = hasAllSchoolsScope(role)
      ? null
      : (member?.assignments ?? []).map((a) => a.schoolId);
    req.school = {
      organizationId,
      userId: auth.user.id,
      access: entitlement.access,
      modules: entitlement.modules,
      limits: entitlement.limits,
      role,
      memberId: member?.id ?? null,
      schoolIds: resolveSchoolIds(assigned, entitlement.coveredSchoolIds),
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
