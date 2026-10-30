import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  DEFAULT_STAFF_POSITIONS,
  MAX_PLANNING_RANGE_DAYS,
  MAX_SHIFT_HOURS,
  hasOrganizationWideScope,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { lockRow } from '../pos/pos-scope';
import type {
  CreateAssignmentDto,
  CreatePositionDto,
  PlanningRangeDto,
  UpdateAssignmentDto,
  UpdatePositionDto,
} from './planning.dto';

const NOT_FOUND = { code: 'ASSIGNMENT_NOT_FOUND', message: 'Créneau introuvable.' };

const ASSIGNMENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  notes: true,
  establishment: { select: { id: true, name: true } },
  position: { select: { id: true, name: true, kind: true } },
  membership: {
    select: { id: true, role: true, user: { select: { firstName: true, lastName: true } } },
  },
} as const satisfies Prisma.StaffAssignmentSelect;

type AssignmentRow = Prisma.StaffAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

const toAssignment = ({ membership, ...a }: AssignmentRow) => ({
  ...a,
  employee: {
    membershipId: membership.id,
    role: membership.role,
    name: `${membership.user.firstName} ${membership.user.lastName}`,
  },
});

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Planning du personnel, volontairement simple : postes configurables et créneaux (employé, poste,
 * établissement, début, fin). Pas de pointage, d'absences, de congés ni de paie.
 *
 * Un employé ne peut pas avoir deux créneaux qui se chevauchent, tous établissements confondus : le
 * contrôle se fait sous verrou de l'adhésion de l'employé, dans la transaction d'écriture.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Postes de l'organisation ; les postes par défaut sont créés au premier accès. */
  async positions(auth: TenantContext) {
    const organizationId = auth.membership.organizationId;
    const count = await this.prisma.staffPosition.count({ where: { organizationId } });
    if (count === 0) {
      await this.prisma.staffPosition.createMany({
        data: DEFAULT_STAFF_POSITIONS.map((p) => ({ organizationId, ...p })),
        skipDuplicates: true,
      });
    }
    return this.prisma.staffPosition.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, kind: true, isActive: true },
    });
  }

  async createPosition(auth: TenantContext, dto: CreatePositionDto) {
    try {
      const position = await this.prisma.staffPosition.create({
        data: { organizationId: auth.membership.organizationId, name: dto.name, kind: dto.kind },
        select: { id: true, name: true, kind: true, isActive: true },
      });
      await this.record(auth, 'planning.position_created', 'StaffPosition', position.id, {
        ...dto,
      });
      return position;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: 'NAME_TAKEN', message: 'Ce poste existe déjà.' });
      }
      throw error;
    }
  }

  async updatePosition(auth: TenantContext, id: string, dto: UpdatePositionDto) {
    const found = await this.prisma.staffPosition.count({
      where: { id, organizationId: auth.membership.organizationId },
    });
    if (!found)
      throw new NotFoundException({ code: 'POSITION_NOT_FOUND', message: 'Poste introuvable.' });
    try {
      const position = await this.prisma.staffPosition.update({
        where: { id },
        data: dto,
        select: { id: true, name: true, kind: true, isActive: true },
      });
      await this.record(auth, 'planning.position_updated', 'StaffPosition', id, { ...dto });
      return position;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: 'NAME_TAKEN', message: 'Ce poste existe déjà.' });
      }
      throw error;
    }
  }

  /** Employés planifiables dans un établissement : actifs, et affectés (ou vision globale). */
  async staff(auth: TenantContext, establishmentId: string) {
    await this.assertEstablishment(auth, establishmentId);
    const rows = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        isActive: true,
        OR: [{ role: { in: ['OWNER', 'ADMIN'] } }, { assignments: { some: { establishmentId } } }],
      },
      orderBy: { user: { firstName: 'asc' } },
      select: { id: true, role: true, user: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      role: m.role,
      name: `${m.user.firstName} ${m.user.lastName}`,
    }));
  }

  async list(auth: TenantContext, establishmentId: string, range: PlanningRangeDto) {
    await this.assertEstablishment(auth, establishmentId);
    const { from, to } = this.range(range);
    const rows = await this.prisma.staffAssignment.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: [{ startsAt: 'asc' }],
      take: 2000,
      select: ASSIGNMENT_SELECT,
    });
    return rows.map(toAssignment);
  }

  /** Planning personnel : les créneaux du membre connecté, tous établissements confondus. */
  async mine(auth: TenantContext, range: PlanningRangeDto) {
    const { from, to } = this.range(range);
    const rows = await this.prisma.staffAssignment.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        membershipId: auth.membership.id,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: { startsAt: 'asc' },
      select: ASSIGNMENT_SELECT,
    });
    return rows.map(toAssignment);
  }

  async create(auth: TenantContext, dto: CreateAssignmentDto) {
    await this.assertEstablishment(auth, dto.establishmentId);
    const { startsAt, endsAt } = this.slot(dto.startsAt, dto.endsAt);
    await this.assertMember(auth, dto.membershipId, dto.establishmentId);
    await this.assertPosition(auth, dto.positionId);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, dto.membershipId, startsAt, endsAt, null);
      const created = await tx.staffAssignment.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId: dto.establishmentId,
          membershipId: dto.membershipId,
          positionId: dto.positionId,
          startsAt,
          endsAt,
          notes: dto.notes ?? null,
          createdById: auth.membership.id,
        },
        select: { id: true },
      });
      await this.record(
        auth,
        'planning.assignment_created',
        'StaffAssignment',
        created.id,
        {
          membershipId: dto.membershipId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        tx,
      );
      return created.id;
    });
    return this.get(auth, id);
  }

  async update(auth: TenantContext, id: string, dto: UpdateAssignmentDto) {
    const current = await this.find(auth, id);
    const { startsAt, endsAt } = this.slot(
      dto.startsAt ?? current.startsAt.toISOString(),
      dto.endsAt ?? current.endsAt.toISOString(),
    );
    const membershipId = dto.membershipId ?? current.membershipId;
    if (dto.membershipId) await this.assertMember(auth, membershipId, current.establishmentId);
    if (dto.positionId) await this.assertPosition(auth, dto.positionId);
    await this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, membershipId, startsAt, endsAt, id);
      await tx.staffAssignment.update({
        where: { id },
        data: { membershipId, positionId: dto.positionId, startsAt, endsAt, notes: dto.notes },
      });
      await this.record(
        auth,
        'planning.assignment_updated',
        'StaffAssignment',
        id,
        { membershipId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        tx,
      );
    });
    return this.get(auth, id);
  }

  async remove(auth: TenantContext, id: string) {
    const current = await this.find(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffAssignment.delete({ where: { id } });
      await this.record(
        auth,
        'planning.assignment_deleted',
        'StaffAssignment',
        id,
        { membershipId: current.membershipId, startsAt: current.startsAt.toISOString() },
        tx,
      );
    });
  }

  private async get(auth: TenantContext, id: string) {
    const row = await this.prisma.staffAssignment.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: ASSIGNMENT_SELECT,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return toAssignment(row);
  }

  /** Créneau visible : de l'organisation et d'un établissement du périmètre du membre. */
  private async find(auth: TenantContext, id: string) {
    const row = await this.prisma.staffAssignment.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: { id: true, establishmentId: true, membershipId: true, startsAt: true, endsAt: true },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async assertEstablishment(auth: TenantContext, establishmentId: string) {
    const found = await this.prisma.establishment.count({
      where: { ...establishmentScope(auth), id: establishmentId, isActive: true },
    });
    if (!found) {
      throw new NotFoundException({
        code: 'ESTABLISHMENT_NOT_FOUND',
        message: 'Établissement introuvable.',
      });
    }
  }

  /** L'employé doit être actif, de l'organisation, et affecté à l'établissement (ou vision globale). */
  private async assertMember(auth: TenantContext, membershipId: string, establishmentId: string) {
    const member = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId: auth.membership.organizationId, isActive: true },
      select: { role: true, assignments: { where: { establishmentId }, select: { id: true } } },
    });
    if (!member)
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: 'Employé introuvable.' });
    if (!hasOrganizationWideScope(member.role) && member.assignments.length === 0) {
      throw new BadRequestException({
        code: 'EMPLOYEE_NOT_ASSIGNED',
        message: 'Cet employé n’est pas affecté à cet établissement.',
      });
    }
  }

  private async assertPosition(auth: TenantContext, positionId: string) {
    const found = await this.prisma.staffPosition.count({
      where: { id: positionId, organizationId: auth.membership.organizationId, isActive: true },
    });
    if (!found)
      throw new NotFoundException({ code: 'POSITION_NOT_FOUND', message: 'Poste introuvable.' });
  }

  /** Verrouille l'employé puis cherche un créneau qui chevauche [début, fin[ (tous établissements). */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    membershipId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId: string | null,
  ) {
    await lockRow(tx, 'OrganizationMembership', membershipId);
    const conflict = await tx.staffAssignment.findFirst({
      where: {
        membershipId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { startsAt: true, endsAt: true, establishment: { select: { name: true } } },
    });
    if (conflict) {
      throw new ConflictException({
        code: 'STAFF_OVERLAP',
        message: 'Cet employé a déjà un créneau qui chevauche cet horaire.',
        details: {
          startsAt: conflict.startsAt,
          endsAt: conflict.endsAt,
          establishment: conflict.establishment.name,
        },
      });
    }
  }

  private slot(startsAtIso: string, endsAtIso: string) {
    const startsAt = new Date(startsAtIso);
    const endsAt = new Date(endsAtIso);
    const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
    if (!(hours > 0) || hours > MAX_SHIFT_HOURS) {
      throw new BadRequestException({
        code: 'INVALID_SLOT',
        message: `Un créneau dure entre quelques minutes et ${MAX_SHIFT_HOURS} heures, et finit après son début.`,
      });
    }
    return { startsAt, endsAt };
  }

  private range(range: PlanningRangeDto) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (!(days > 0) || days > MAX_PLANNING_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: `La période consultée doit durer au plus ${MAX_PLANNING_RANGE_DAYS} jours.`,
      });
    }
    return { from, to };
  }

  private record(
    auth: TenantContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
    tx?: Prisma.TransactionClient,
  ) {
    return this.audit.record(
      {
        organizationId: auth.membership.organizationId,
        actorUserId: auth.user.id,
        action,
        targetType,
        targetId,
        metadata,
      },
      tx,
    );
  }
}
