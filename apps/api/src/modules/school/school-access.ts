import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type ContractLimits,
  type ContractTier,
  SCHOOL_PRODUCT_CODE,
  type ProductAccess,
  type SchoolPermission,
  type SchoolRole,
  hasAllSchoolsScope,
  hasSchoolPermission,
} from '@ocall/shared';
import {
  appDenied,
  appTenant,
  assertAppEnabled,
  isOrganizationOwner,
  isSafeMethod,
} from '../../common/app-guard';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';
import { SchoolPrismaService } from './school-prisma.service';

const SCHOOL_PERMISSION = 'schoolPermission';
const ALLOWED_IN_READ_ONLY = 'schoolAllowedInReadOnly';

/** Contexte d'une requête School : seule source fiable du client, du rôle et des établissements. */
export interface SchoolContext {
  organizationId: string;
  userId: string;
  access: ProductAccess;
  modules: string[];
  /** Limites du contrat (socle S1 : élèves, IA et SMS de l'offre gratuite). */
  limits: Omit<ContractLimits, 'tier'>;
  /** Nature du droit (payant, essai, gratuit) ; null sans contrat actif. */
  tier?: ContractTier | null;
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
    assertAppEnabled(this.config.school.enabled);
    const req = context.switchToHttp().getRequest<SchoolRequest>();
    const protective = this.reflector.getAllAndOverride<boolean | undefined>(ALLOWED_IN_READ_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permission = this.reflector.getAllAndOverride<SchoolPermission | undefined>(
      SCHOOL_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    req.school = await resolveSchoolContext(
      { contracts: this.contracts, db: this.db, config: this.config },
      appTenant(req.auth),
      { method: req.method, protective: Boolean(protective), permission },
    );
    return true;
  }
}

/**
 * Contexte Ocall School d'un membre, dans l'ordre de la garde : produit activé, contrat, lecture seule,
 * rôle School (le propriétaire est directeur de groupe d'office), permission, périmètre des
 * établissements (rôle ∩ contrats). Lève le même refus que la garde. Seule source de ce calcul : garde des
 * routes et lectures demandées par une autre partie de l'API (tableau de bord de l'organisation).
 */
export async function resolveSchoolContext(
  deps: { contracts: SuiteContractsService; db: SchoolPrismaService; config: AppConfig },
  auth: TenantContext,
  request: { method: string; protective?: boolean; permission?: SchoolPermission },
): Promise<SchoolContext> {
  assertAppEnabled(deps.config.school.enabled);
  const organizationId = auth.membership.organizationId;

  const entitlement = await deps.contracts.entitlement(organizationId, SCHOOL_PRODUCT_CODE);
  if (entitlement.access === 'none') {
    throw new ForbiddenException({
      code: 'PRODUCT_NOT_ENABLED',
      message: 'Ocall School n’est pas activé par votre contrat.',
    });
  }
  // Contrat suspendu ou expiré : consultation et export uniquement, aucune donnée n'est supprimée.
  const write = !isSafeMethod(request.method) && !request.protective;
  if (entitlement.access === 'read_only' && write) {
    throw new ForbiddenException({
      code: 'CONTRACT_READ_ONLY',
      message: 'Votre contrat ne permet plus que la consultation et l’export des données.',
    });
  }

  // Sprint Suite 2A : rôle School pour tout membre de l'organisation (employé Park compris) ; le
  // propriétaire reste directeur de groupe d'office.
  const isOwner = isOrganizationOwner(auth);
  const member = isOwner ? null : await schoolMember(deps.db, organizationId, auth.user.id);
  if (!isOwner && !member) throw appDenied();
  const role: SchoolRole = member?.role ?? 'GROUP_DIRECTOR';

  if (request.permission && !hasSchoolPermission(role, request.permission)) throw appDenied();

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
  return {
    organizationId,
    userId: auth.user.id,
    access: write ? 'full' : entitlement.access,
    modules: entitlement.modules,
    limits: entitlement.limits,
    tier: entitlement.tier,
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
}

/**
 * Rôle, activation et établissements lus par une seule instruction SQL : une modification concurrente
 * ne peut pas associer l'ancien rôle au nouveau périmètre, combinaison qui n'a jamais été accordée.
 */
async function schoolMember(db: SchoolPrismaService, organizationId: string, userId: string) {
  const [row] = await db.$queryRaw<{ id: string; role: SchoolRole; schoolIds: string[] }[]>`
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
