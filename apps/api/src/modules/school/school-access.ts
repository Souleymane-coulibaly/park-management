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
const ALLOWED_IN_READ_ONLY = 'schoolAllowedInReadOnly';

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
  /**
   * Établissements accessibles POUR CETTE REQUÊTE ; null = tous ceux du client. Une écriture ne voit
   * que les établissements couverts par un contrat actif ; une lecture (ou une action protectrice),
   * ceux couverts par un contrat actif ou en lecture seule.
   */
  schoolIds: string[] | null;
  /** Périmètres du contrat : lecture et écriture (null = tous les établissements du client). */
  contract?: { readSchoolIds: string[] | null; writeSchoolIds: string[] | null };
  /** Requête d'écriture dont le périmètre a été restreint aux établissements sous contrat actif. */
  writeNarrowed?: boolean;
  /** Périmètre de LECTURE de l'utilisateur (rôle ∩ contrats), même pour une écriture ; null = tous. */
  readSchoolIds?: string[] | null;
}

type SchoolRequest = Request & { school?: SchoolContext };

export const RequireSchoolPermission = (permission: SchoolPermission) =>
  SetMetadata(SCHOOL_PERMISSION, permission);

/**
 * Écriture PROTECTRICE permise en lecture seule (contrat suspendu ou expiré) : retirer une photo publiée
 * ou dépublier le site ne fait que réduire ce qui est exposé. Aucune création ni publication.
 */
export const AllowInReadOnly = () => SetMetadata(ALLOWED_IN_READ_ONLY, true);

export const CurrentSchool = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<SchoolRequest>().school as SchoolContext;
});

/** Intersection du périmètre du rôle et de la couverture des contrats (null = tous). */
export function resolveSchoolIds(
  assigned: string[] | null,
  covered: readonly string[] | null,
): string[] | null {
  if (covered === null) return assigned;
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
    const protective = this.reflector.getAllAndOverride<boolean | undefined>(ALLOWED_IN_READ_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const write = !SAFE_METHODS.has(req.method) && !protective;
    if (entitlement.access === 'read_only' && write) {
      throw new ForbiddenException({
        code: 'CONTRACT_READ_ONLY',
        message: 'Votre contrat ne permet plus que la consultation et l’export des données.',
      });
    }

    const member =
      auth.membership.role === 'PRODUCT_USER'
        ? await this.member(organizationId, auth.user.id)
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
    // Périmètre par établissement, sur TOUS les contrats : une écriture ne voit que les établissements
    // couverts par un contrat actif (un établissement seulement sous contrat suspendu ou expiré reste
    // en lecture seule) ; une lecture, tous ceux couverts par un contrat actif ou en lecture seule.
    const contract = {
      readSchoolIds: entitlement.readSchoolIds,
      writeSchoolIds: entitlement.writeSchoolIds,
    };
    req.school = {
      organizationId,
      userId: auth.user.id,
      access: write ? 'full' : entitlement.access,
      modules: entitlement.modules,
      limits: entitlement.limits,
      role,
      memberId: member?.id ?? null,
      schoolIds: resolveSchoolIds(
        assigned,
        write ? entitlement.writeSchoolIds : entitlement.readSchoolIds,
      ),
      contract,
      writeNarrowed: write,
      readSchoolIds: resolveSchoolIds(assigned, entitlement.readSchoolIds),
    };
    return true;
  }

  /**
   * Rôle, activation et établissements lus par une seule instruction SQL : une modification concurrente
   * ne peut pas associer l'ancien rôle au nouveau périmètre, combinaison qui n'a jamais été accordée.
   */
  private async member(organizationId: string, userId: string) {
    const [row] = await this.db.$queryRaw<{ id: string; role: SchoolRole; schoolIds: string[] }[]>`
      SELECT m.id, m.role::text AS role,
        coalesce(array_agg(a."schoolId"::text) FILTER (WHERE a."schoolId" IS NOT NULL), '{}') AS "schoolIds"
      FROM "SchoolMember" m
      LEFT JOIN "SchoolMemberAssignment" a ON a."memberId" = m.id
      WHERE m."organizationId" = ${organizationId}::uuid AND m."userId" = ${userId}::uuid AND m."isActive"
      GROUP BY m.id
      LIMIT 1`;
    return row
      ? { id: row.id, role: row.role, assignments: row.schoolIds.map((schoolId) => ({ schoolId })) }
      : null;
  }

  private denied() {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }
}
