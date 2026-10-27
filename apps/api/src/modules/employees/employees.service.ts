import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  type MemberRole,
  ROLE_LABELS,
  canManageRole,
  hasOrganizationWideScope,
  isRoleAvailableFor,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { membershipScope } from '../../common/tenant-scope';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import type {
  ChangeRoleDto,
  CreateEmployeeDto,
  SetAssignmentsDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { assertKeepsAnActiveOwner } from './owner-protection';

const INCLUDE = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      loginId: true,
      lastLoginAt: true,
      mustChangePassword: true,
    },
  },
  assignments: { select: { establishment: { select: { id: true, name: true } } } },
} as const;

type MembershipWithUser = Prisma.OrganizationMembershipGetPayload<{ include: typeof INCLUDE }>;

function toEmployee(m: MembershipWithUser) {
  return {
    id: m.id,
    userId: m.user.id,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    email: m.user.email,
    loginId: m.user.loginId,
    role: m.role,
    isActive: m.isActive,
    mustChangePassword: m.user.mustChangePassword,
    lastLoginAt: m.user.lastLoginAt,
    establishments: m.assignments.map((a) => a.establishment),
    createdAt: m.createdAt,
  };
}

const NOT_FOUND = { code: 'EMPLOYEE_NOT_FOUND', message: 'Employé introuvable.' };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
  ) {}

  async list(auth: TenantContext) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: membershipScope(auth),
      include: INCLUDE,
      orderBy: [{ isActive: 'desc' }, { user: { lastName: 'asc' } }],
    });
    return rows.map(toEmployee);
  }

  async get(auth: TenantContext, id: string) {
    return toEmployee(await this.find(auth, id));
  }

  /** Crée un compte nominatif avec un mot de passe temporaire à changer à la première connexion. */
  async create(auth: TenantContext, dto: CreateEmployeeDto) {
    const organizationId = auth.membership.organizationId;
    this.assertCanAssign(auth, dto.role);
    this.assertAssignmentsRequired(dto.role, dto.establishmentIds);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const membership = await this.prisma.$transaction(async (tx) => {
      await this.assertEstablishmentsBelong(tx, organizationId, dto.establishmentIds);
      const loginId = await this.provisioning.allocateLoginId(tx, organizationId);
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
      const created = await tx.organizationMembership.create({
        data: {
          organizationId,
          userId: user.id,
          role: dto.role,
          assignments: {
            create: dto.establishmentIds.map((establishmentId) => ({
              establishmentId,
              organizationId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'employee.created',
          targetType: 'Membership',
          targetId: created.id,
          metadata: { loginId, role: dto.role },
        },
        tx,
      );
      return created;
    });
    return { employee: toEmployee(membership), temporaryPassword };
  }

  async update(auth: TenantContext, id: string, dto: UpdateEmployeeDto) {
    const target = await this.findManageable(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.userId },
        data: { firstName: dto.firstName, lastName: dto.lastName, email: dto.email },
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.updated',
          targetType: 'Membership',
          targetId: id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async changeRole(auth: TenantContext, id: string, dto: ChangeRoleDto) {
    const target = await this.findManageable(auth, id);
    this.assertNotSelf(auth, target.id, 'modifier votre propre rôle');
    this.assertCanAssign(auth, dto.role);
    this.assertAssignmentsRequired(
      dto.role,
      target.assignments.map((a) => a.establishment.id),
    );
    await this.prisma.$transaction(async (tx) => {
      if (target.role === 'OWNER' && dto.role !== 'OWNER') {
        await assertKeepsAnActiveOwner(tx, target.organizationId, target.id);
      }
      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { role: dto.role },
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.role_changed',
          targetType: 'Membership',
          targetId: id,
          metadata: { from: target.role, to: dto.role },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async setAssignments(auth: TenantContext, id: string, dto: SetAssignmentsDto) {
    const target = await this.findManageable(auth, id);
    this.assertAssignmentsRequired(target.role, dto.establishmentIds);
    await this.prisma.$transaction(async (tx) => {
      await this.assertEstablishmentsBelong(tx, target.organizationId, dto.establishmentIds);
      await tx.establishmentAssignment.deleteMany({
        where: { membershipId: target.id, organizationId: target.organizationId },
      });
      await tx.establishmentAssignment.createMany({
        data: dto.establishmentIds.map((establishmentId) => ({
          establishmentId,
          membershipId: target.id,
          organizationId: target.organizationId,
        })),
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.assignments_changed',
          targetType: 'Membership',
          targetId: id,
          metadata: { establishmentIds: dto.establishmentIds },
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Désactive le compte dans l'organisation et révoque immédiatement ses sessions. */
  async deactivate(auth: TenantContext, id: string) {
    const target = await this.findManageable(auth, id);
    this.assertNotSelf(auth, target.id, 'désactiver votre propre compte');
    await this.prisma.$transaction(async (tx) => {
      if (target.role === 'OWNER')
        await assertKeepsAnActiveOwner(tx, target.organizationId, target.id);
      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { isActive: false },
      });
      await tx.session.updateMany({
        where: { membershipId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.deactivated',
          targetType: 'Membership',
          targetId: id,
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async reactivate(auth: TenantContext, id: string) {
    const target = await this.findManageable(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { isActive: true },
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.reactivated',
          targetType: 'Membership',
          targetId: id,
        },
        tx,
      );
    });
    return this.get(auth, id);
  }

  /** Réinitialisation par l'administrateur, pour les employés sans e-mail. */
  async resetPassword(auth: TenantContext, id: string) {
    const target = await this.findManageable(auth, id);
    this.assertNotSelf(auth, target.id, 'réinitialiser votre propre mot de passe ici');
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.userId },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: target.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId: target.organizationId,
          actorUserId: auth.user.id,
          action: 'employee.password_reset',
          targetType: 'Membership',
          targetId: id,
        },
        tx,
      );
    });
    return { temporaryPassword };
  }

  /** Lecture bornée au tenant (et au périmètre d'établissements pour un superviseur). */
  private async find(auth: TenantContext, id: string): Promise<MembershipWithUser> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { ...membershipScope(auth), id },
      include: INCLUDE,
    });
    if (!membership) throw new NotFoundException(NOT_FOUND);
    return membership;
  }

  /** Un membre ne gère que les comptes dont il pourrait attribuer le rôle (un ADMIN ne touche pas un OWNER). */
  private async findManageable(auth: TenantContext, id: string): Promise<MembershipWithUser> {
    const target = await this.find(auth, id);
    if (!canManageRole(auth.membership.role, target.role)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_MANAGEABLE',
        message: `Vous ne pouvez pas gérer un compte « ${ROLE_LABELS[target.role]} ».`,
      });
    }
    return target;
  }

  private assertCanAssign(auth: TenantContext, role: MemberRole): void {
    if (!canManageRole(auth.membership.role, role)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_ASSIGNABLE',
        message: `Vous ne pouvez pas attribuer le rôle « ${ROLE_LABELS[role]} ».`,
      });
    }
    if (!isRoleAvailableFor(role, auth.membership.businessType)) {
      throw new BadRequestException({
        code: 'ROLE_NOT_AVAILABLE',
        message: `Le rôle « ${ROLE_LABELS[role]} » n'est pas disponible pour votre métier.`,
      });
    }
  }

  /** Hors OWNER/ADMIN, un employé doit être affecté à au moins un établissement. */
  private assertAssignmentsRequired(role: MemberRole, establishmentIds: string[]): void {
    if (!hasOrganizationWideScope(role) && establishmentIds.length === 0) {
      throw new BadRequestException({
        code: 'ASSIGNMENT_REQUIRED',
        message: 'Affectez cet employé à au moins un établissement.',
      });
    }
  }

  private assertNotSelf(auth: TenantContext, membershipId: string, action: string): void {
    if (auth.membership.id === membershipId) {
      throw new ForbiddenException({
        code: 'SELF_ACTION_FORBIDDEN',
        message: `Vous ne pouvez pas ${action}.`,
      });
    }
  }

  /** Refuse tout identifiant d'établissement étranger à l'organisation (isolation multi-tenant). */
  private async assertEstablishmentsBelong(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const count = await tx.establishment.count({ where: { organizationId, id: { in: ids } } });
    if (count !== ids.length) {
      throw new BadRequestException({
        code: 'INVALID_ESTABLISHMENT',
        message: 'Un ou plusieurs établissements sont introuvables.',
      });
    }
  }
}
