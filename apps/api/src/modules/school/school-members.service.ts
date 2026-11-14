import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { Prisma as SchoolPrisma } from '@ocall/school-database';
import {
  SCHOOL_PRODUCT_CODE,
  assignableSchoolRoles,
  hasAllSchoolsScope,
  type SchoolRole,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import { ProductUserAccountsService } from '../organizations/product-user-accounts.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';
import type { AttachMemberDto, CreateMemberDto, UpdateMemberDto } from './school.dto';

const NOT_FOUND = { code: 'SCHOOL_MEMBER_NOT_FOUND', message: 'Utilisateur introuvable.' };

/**
 * Équipe d'un établissement. L'identité (compte, mot de passe, sessions) reste dans la base Ocall Suite,
 * avec le rôle PRODUCT_USER, sans aucun droit Ocall Park ; le rôle scolaire est dans la base School.
 */
@Injectable()
export class SchoolMembersService implements OnModuleInit {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly school: SchoolService,
    private readonly accounts: ProductUserAccountsService,
  ) {}

  /** Suite garde un compte PRODUCT_USER ouvert tant qu'une application lui donne un rôle actif. */
  onModuleInit() {
    this.accounts.registerProbe({
      product: SCHOOL_PRODUCT_CODE,
      isActiveMember: async (organizationId, userId) =>
        (await this.db.schoolMember.count({
          where: { organizationId, userId, isActive: true },
        })) > 0,
    });
  }

  /** Membres de l'organisation (Park, autres applications) qui ne sont pas encore dans l'équipe School. */
  async candidates(ctx: SchoolContext) {
    const members = await this.db.schoolMember.findMany({
      where: { organizationId: ctx.organizationId },
      select: { userId: true },
    });
    return this.accounts.candidates(
      ctx.organizationId,
      members.map((m) => m.userId),
    );
  }

  /**
   * Ajoute un membre existant de l'organisation avec un rôle School et ses établissements, sans nouveau
   * compte (Sprint Suite 2A) : son rôle Park ou dans une autre application reste inchangé.
   */
  async attach(ctx: SchoolContext, dto: AttachMemberDto) {
    this.assertCanAssign(ctx, dto.role);
    await this.assertSchools(this.db, ctx, dto.role, dto.schoolIds);
    const user = await this.accounts.existingMember(ctx.organizationId, dto.userId);
    const schoolIds = [...new Set(dto.schoolIds)];
    try {
      const member = await this.db.$transaction(async (tx) => {
        const created = await tx.schoolMember.create({
          data: {
            organizationId: ctx.organizationId,
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            loginId: user.loginId,
            role: dto.role,
          },
        });
        await tx.schoolMemberAssignment.createMany({
          data: schoolIds.map((schoolId) => ({
            memberId: created.id,
            schoolId,
            organizationId: ctx.organizationId,
          })),
        });
        return created;
      });
      await this.audit.record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'school.member_attached',
        targetType: 'SchoolMember',
        targetId: member.id,
        metadata: { userId: user.userId, role: dto.role, suiteRole: user.suiteRole, schoolIds },
      });
      return {
        member: {
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          loginId: member.loginId,
          role: member.role,
          isActive: member.isActive,
          schoolIds,
        },
      };
    } catch (error) {
      if (error instanceof SchoolPrisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'SCHOOL_MEMBER_EXISTS',
          message: 'Cette personne fait déjà partie de l’équipe School.',
        });
      }
      throw error;
    }
  }

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
    // Refus avant tout verrou : un identifiant étranger ne doit jamais faire attendre la requête.
    await this.findManageable(this.db, ctx, id);
    const { target, role } = await this.db.$transaction(async (tx) => {
      // Rôle et affectations relus sous verrou : ce sont eux qui fondent le droit de gérer ce membre.
      // Sorti du périmètre depuis le contrôle : rien n'est verrouillé, la relecture n'aurait plus de garantie.
      if (!(await this.school.lockMemberInScope(tx, ctx, id))) {
        throw new NotFoundException(NOT_FOUND);
      }
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
        data: {
          role: dto.role,
          isActive: dto.isActive,
          firstNameAr: dto.firstNameAr,
          lastNameAr: dto.lastNameAr,
        },
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
      const endedTeaching = await this.endTeaching(tx, ctx, target, role, dto);
      await this.school.recordDecision(tx, ctx, 'school.member_updated', 'SchoolMember', id, {
        fields: Object.keys(dto),
        role,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.schoolIds ? { schoolIds: dto.schoolIds } : {}),
        ...(endedTeaching ? { endedTeaching } : {}),
      });
      return { target, role };
    });
    await this.school.publishDecisions(ctx.organizationId);
    // Après la validation School : droits restreints et fermeture valent avant toute réouverture de Suite.
    if (dto.isActive !== undefined) await this.syncAccount(ctx, id, target.userId);
    return { id, role, isActive: dto.isActive ?? target.isActive };
  }

  /**
   * Un enseignant désactivé, qui change de rôle ou quitte un établissement n'y enseigne plus : ses
   * affectations actives s'y terminent et ses accès aux classes y sont retirés, dans la transaction de la
   * modification (le membre est déjà verrouillé). Une réactivation ou un retour ne rétablit rien d'office.
   * Renvoie le nombre d'affectations terminées.
   */
  private async endTeaching(
    tx: SchoolPrisma.TransactionClient,
    ctx: SchoolContext,
    target: { id: string; role: SchoolRole; assignments: { schoolId: string }[] },
    role: SchoolRole,
    dto: UpdateMemberDto,
  ): Promise<number> {
    const previous = target.assignments.map((a) => a.schoolId);
    let schools: string[] = [];
    let reason = '';
    if (dto.isActive === false) {
      schools = previous;
      reason = 'Compte désactivé';
    } else if (target.role === 'TEACHER' && role !== 'TEACHER') {
      schools = previous;
      reason = 'Changement de rôle';
    } else if (dto.schoolIds) {
      const kept = new Set(dto.schoolIds);
      schools = previous.filter(
        (schoolId) => !kept.has(schoolId) && (!ctx.schoolIds || ctx.schoolIds.includes(schoolId)),
      );
      reason = 'Retrait de l’établissement';
    }
    if (schools.length === 0) return 0;
    const inSchools = { class: { year: { schoolId: { in: schools } } } };
    const { count } = await tx.schoolTeachingAssignment.updateMany({
      where: {
        organizationId: ctx.organizationId,
        memberId: target.id,
        endedAt: null,
        ...inSchools,
      },
      data: { endedAt: new Date(), endedByUserId: ctx.userId, endReason: reason },
    });
    await tx.schoolClassTeacher.deleteMany({
      where: { organizationId: ctx.organizationId, memberId: target.id, ...inSchools },
    });
    return count;
  }

  /**
   * Compte Suite : l'accès exige School (ou une autre application) et Suite ouverts. Suite recopie l'état
   * validé, relu sous verrou dans chaque application (Sprint Suite 2A : un compte réservé aux applications
   * reste ouvert tant qu'une application lui donne un rôle actif), jamais la décision de la requête : une
   * panne laisse le compte fermé, l'administrateur rejoue la décision, et une synchronisation tardive ne
   * peut pas écraser une décision plus récente. `memberId` : point d'interception des tests de reprise.
   */
  private async syncAccount(ctx: SchoolContext, _memberId: string, userId: string) {
    await this.accounts.syncActive(ctx.organizationId, userId);
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
