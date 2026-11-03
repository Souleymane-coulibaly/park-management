import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import type { Prisma as SchoolPrisma } from '@ocall/school-database';
import { assignableSchoolRoles, hasAllSchoolsScope, type SchoolRole } from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';
import type { CreateMemberDto, UpdateMemberDto } from './school.dto';

const NOT_FOUND = { code: 'SCHOOL_MEMBER_NOT_FOUND', message: 'Utilisateur introuvable.' };

/**
 * Équipe d'un établissement. L'identité (compte, mot de passe, sessions) reste dans la base Ocall Suite,
 * avec le rôle PRODUCT_USER, sans aucun droit Ocall Park ; le rôle scolaire est dans la base School.
 */
@Injectable()
export class SchoolMembersService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly school: SchoolService,
  ) {}

  async list(ctx: SchoolContext) {
    await this.school.publishDecisions(ctx.organizationId);
    const rows = await this.db.schoolMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { assignments: { some: { schoolId: { in: ctx.schoolIds } } } } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
      include: { assignments: { select: { schoolId: true } } },
    });
    return rows.map(({ assignments, ...m }) => ({
      ...m,
      schoolIds: assignments
        .map((a) => a.schoolId)
        .filter((schoolId) => !ctx.schoolIds || ctx.schoolIds.includes(schoolId)),
    }));
  }

  async create(ctx: SchoolContext, dto: CreateMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    await this.assertSchools(this.db, ctx, dto.role, dto.schoolIds);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const account = await this.emailConflict(() =>
      this.core.$transaction(async (tx) => {
        const loginId = await this.provisioning.allocateLoginId(tx, ctx.organizationId);
        const user = await tx.user.create({
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email ?? null,
            loginId,
            passwordHash,
            mustChangePassword: true,
          },
        });
        const membership = await tx.organizationMembership.create({
          data: { organizationId: ctx.organizationId, userId: user.id, role: 'PRODUCT_USER' },
        });
        await this.audit.record(
          {
            organizationId: ctx.organizationId,
            actorUserId: ctx.userId,
            action: 'school.member_created',
            targetType: 'User',
            targetId: user.id,
            metadata: { loginId, role: dto.role },
          },
          tx,
        );
        return { userId: user.id, membershipId: membership.id, loginId };
      }),
    );

    // Deux bases, donc pas de transaction commune : en cas d'échec, le compte Suite est désactivé.
    try {
      const member = await this.db.$transaction(async (tx) => {
        const created = await tx.schoolMember.create({
          data: {
            organizationId: ctx.organizationId,
            userId: account.userId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            loginId: account.loginId,
            role: dto.role,
          },
        });
        await tx.schoolMemberAssignment.createMany({
          data: [...new Set(dto.schoolIds)].map((schoolId) => ({
            memberId: created.id,
            schoolId,
            organizationId: ctx.organizationId,
          })),
        });
        return created;
      });
      return {
        member: {
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          loginId: member.loginId,
          role: member.role,
          isActive: member.isActive,
          schoolIds: [...new Set(dto.schoolIds)],
        },
        temporaryPassword,
      };
    } catch (error) {
      await this.core.organizationMembership.update({
        where: { id: account.membershipId },
        data: { isActive: false },
      });
      throw error;
    }
  }

  async update(ctx: SchoolContext, id: string, dto: UpdateMemberDto) {
    if (dto.role) this.assertCanAssign(ctx, dto.role);
    const { target, role } = await this.db.$transaction(async (tx) => {
      // Rôle et affectations relus sous verrou : ce sont eux qui fondent le droit de gérer ce membre.
      await tx.$queryRaw`SELECT id FROM "SchoolMember" WHERE id = ${id}::uuid FOR UPDATE`;
      const target = await this.findManageable(tx, ctx, id);
      if (target.userId === ctx.userId) {
        throw new ForbiddenException({
          code: 'SELF_CHANGE_REFUSED',
          message: 'Vous ne pouvez pas modifier votre propre accès.',
        });
      }
      const role = dto.role ?? target.role;
      if (dto.schoolIds) await this.assertSchools(tx, ctx, role, dto.schoolIds);
      // Le rôle et l'activation valent pour tous ses établissements : décision de qui les couvre tous.
      const sharedElsewhere =
        ctx.schoolIds && target.assignments.some((a) => !ctx.schoolIds!.includes(a.schoolId));
      // Même à valeur égale : après une panne, School peut différer de Suite, et cette demande rouvrirait
      // le compte dans tous ses établissements.
      const global = role !== target.role || dto.isActive !== undefined;
      if (sharedElsewhere && global) {
        throw new ForbiddenException({
          code: 'SCHOOL_MEMBER_SHARED',
          message:
            'Ce compte relève aussi d’un autre périmètre : adressez-vous à la direction du groupe.',
        });
      }
      await tx.schoolMember.update({
        where: { id },
        data: { role: dto.role, isActive: dto.isActive },
      });
      if (dto.schoolIds) {
        // Seules les affectations du périmètre de l'utilisateur changent.
        await tx.schoolMemberAssignment.deleteMany({
          where: { memberId: id, ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}) },
        });
        await tx.schoolMemberAssignment.createMany({
          data: [...new Set(dto.schoolIds)].map((schoolId) => ({
            memberId: id,
            schoolId,
            organizationId: ctx.organizationId,
          })),
        });
      }
      await this.school.recordDecision(tx, ctx, 'school.member_updated', 'SchoolMember', id, {
        fields: Object.keys(dto),
        role,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.schoolIds ? { schoolIds: dto.schoolIds } : {}),
      });
      return { target, role };
    });
    await this.school.publishDecisions(ctx.organizationId);
    // Après la validation School : droits restreints et fermeture valent avant toute réouverture de Suite.
    if (dto.isActive !== undefined) await this.syncAccount(ctx, id, target.userId);
    return { id, role, isActive: dto.isActive ?? target.isActive };
  }

  /**
   * Compte réservé à School : l'accès exige School et Suite ouverts. Suite recopie l'état validé dans School,
   * jamais la décision de la requête : une panne laisse le compte fermé, l'administrateur rejoue la décision,
   * et une synchronisation tardive ne peut pas écraser une décision plus récente.
   */
  private async syncAccount(ctx: SchoolContext, memberId: string, userId: string) {
    await this.core.$transaction(async (tx) => {
      const memberships = await tx.organizationMembership.findMany({
        where: { organizationId: ctx.organizationId, userId, role: 'PRODUCT_USER' },
        select: { id: true },
      });
      const ids = memberships.map((m) => m.id);
      await tx.$queryRaw`
        SELECT id FROM "OrganizationMembership" WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
      const { isActive } = await this.db.schoolMember.findUniqueOrThrow({
        where: { id: memberId },
        select: { isActive: true },
      });
      await tx.organizationMembership.updateMany({
        where: { id: { in: ids } },
        data: { isActive },
      });
      if (!isActive) {
        await tx.session.updateMany({
          where: { membershipId: { in: ids }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
  }

  private async findManageable(tx: SchoolPrisma.TransactionClient, ctx: SchoolContext, id: string) {
    const target = await tx.schoolMember.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { assignments: { select: { schoolId: true } } },
    });
    if (!target) throw new NotFoundException(NOT_FOUND);
    if (ctx.schoolIds) {
      const shared = target.assignments.some((a) => ctx.schoolIds!.includes(a.schoolId));
      if (!shared) throw new NotFoundException(NOT_FOUND);
    }
    this.assertCanAssign(ctx, target.role);
    return target;
  }

  private assertCanAssign(ctx: SchoolContext, role: SchoolRole) {
    if (!assignableSchoolRoles(ctx.role).includes(role)) {
      throw new ForbiddenException({
        code: 'SCHOOL_ROLE_NOT_ASSIGNABLE',
        message: 'Vous ne pouvez pas gérer ce rôle.',
      });
    }
  }

  private async assertSchools(
    db: SchoolPrisma.TransactionClient | SchoolPrismaService,
    ctx: SchoolContext,
    role: SchoolRole,
    schoolIds: string[],
  ) {
    if (!hasAllSchoolsScope(role) && schoolIds.length === 0) {
      throw new ConflictException({
        code: 'SCHOOL_REQUIRED',
        message: 'Choisissez au moins un établissement.',
      });
    }
    const unique = [...new Set(schoolIds)];
    const found = await db.school.count({
      where: {
        id: { in: unique },
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { AND: [{ id: { in: ctx.schoolIds } }] } : {}),
      },
    });
    if (found !== unique.length) throw new NotFoundException(NOT_FOUND);
  }

  private async emailConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String(error.meta?.target ?? '').includes('email')
      ) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Cet e-mail est déjà utilisé.',
        });
      }
      throw error;
    }
  }
}
