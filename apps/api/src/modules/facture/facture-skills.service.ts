import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import { AuditService } from '../../common/audit/audit.service';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  FactureSkillDto,
  FactureUnavailabilityDto,
  FactureUnavailabilityQueryDto,
  UpdateFactureSkillDto,
} from './facture-skills.dto';

const SKILL_NOT_FOUND = { code: 'FACTURE_SKILL_NOT_FOUND', message: 'Compétence introuvable.' };
const MEMBER_NOT_FOUND = { code: 'FACTURE_MEMBER_NOT_FOUND', message: 'Membre introuvable.' };
const MAX_UNAVAILABILITY_MS = 366 * 86_400_000;

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Compétences des techniciens (liste libre définie par chaque entreprise) et indisponibilités (congés,
 * absences) : données de la planification intelligente (F6B). Une compétence n'est jamais supprimée :
 * archivée, elle n'est plus proposée.
 */
@Injectable()
export class FactureSkillsService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
  ) {}

  skills(ctx: FactureContext) {
    return this.db.factureSkill.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isArchived: true },
    });
  }

  async createSkill(ctx: FactureContext, dto: FactureSkillDto) {
    const skill = await this.unique(() =>
      this.db.factureSkill.create({
        data: { organizationId: ctx.organizationId, name: dto.name },
        select: { id: true, name: true, isArchived: true },
      }),
    );
    await this.record(ctx, 'facture.skill_created', 'FactureSkill', skill.id);
    return skill;
  }

  async updateSkill(ctx: FactureContext, id: string, dto: UpdateFactureSkillDto) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    if (!(await this.db.factureSkill.findUnique({ where, select: { id: true } }))) {
      throw new NotFoundException(SKILL_NOT_FOUND);
    }
    const skill = await this.unique(() =>
      this.db.factureSkill.update({
        where,
        data: dto,
        select: { id: true, name: true, isArchived: true },
      }),
    );
    await this.record(ctx, 'facture.skill_updated', 'FactureSkill', id);
    return skill;
  }

  /** Compétences de chaque membre actif. */
  async memberSkills(ctx: FactureContext) {
    const rows = await this.db.factureMemberSkill.findMany({
      where: { organizationId: ctx.organizationId },
      select: { memberId: true, skillId: true },
    });
    const map: Record<string, string[]> = {};
    for (const r of rows) (map[r.memberId] ??= []).push(r.skillId);
    return map;
  }

  /** Remplace les compétences d'un membre (compétences actives de l'organisation seulement). */
  async setMemberSkills(ctx: FactureContext, memberId: string, skillIds: string[]) {
    await this.db.$transaction(async (tx) => {
      const member = await tx.factureMember.findUnique({
        where: { organizationId_id: { organizationId: ctx.organizationId, id: memberId } },
        select: { id: true },
      });
      if (!member) throw new NotFoundException(MEMBER_NOT_FOUND);
      await this.assertSkills(tx, ctx.organizationId, skillIds);
      await tx.factureMemberSkill.deleteMany({
        where: { organizationId: ctx.organizationId, memberId },
      });
      if (skillIds.length > 0) {
        await tx.factureMemberSkill.createMany({
          data: skillIds.map((skillId) => ({
            organizationId: ctx.organizationId,
            memberId,
            skillId,
          })),
        });
      }
    });
    await this.record(ctx, 'facture.member_skills_updated', 'FactureMember', memberId);
    return { memberId, skillIds };
  }

  unavailabilities(ctx: FactureContext, query: FactureUnavailabilityQueryDto, now = new Date()) {
    return this.db.factureUnavailability.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        endsAt: { gte: now },
      },
      include: { member: { select: { firstName: true, lastName: true } } },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
  }

  async addUnavailability(ctx: FactureContext, dto: FactureUnavailabilityDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (
      !(endsAt.getTime() > startsAt.getTime()) ||
      endsAt.getTime() - startsAt.getTime() > MAX_UNAVAILABILITY_MS
    ) {
      throw new BadRequestException({
        code: 'FACTURE_UNAVAILABILITY_PERIOD',
        message: 'Période invalide : la fin suit le début, un an au plus.',
      });
    }
    const member = await this.db.factureMember.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: dto.memberId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException(MEMBER_NOT_FOUND);
    const row = await this.db.factureUnavailability.create({
      data: {
        organizationId: ctx.organizationId,
        memberId: dto.memberId,
        startsAt,
        endsAt,
        reason: dto.reason ?? null,
        createdByUserId: ctx.userId,
      },
    });
    await this.record(ctx, 'facture.unavailability_added', 'FactureUnavailability', row.id);
    return row;
  }

  async removeUnavailability(ctx: FactureContext, id: string) {
    const { count } = await this.db.factureUnavailability.deleteMany({
      where: { organizationId: ctx.organizationId, id },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'FACTURE_UNAVAILABILITY_NOT_FOUND',
        message: 'Indisponibilité introuvable.',
      });
    }
    await this.record(ctx, 'facture.unavailability_removed', 'FactureUnavailability', id);
  }

  /** Compétences actives de l'organisation (sinon refus) : utilisé aussi par les interventions. */
  async assertSkills(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
    if (ids.length === 0) return;
    const found = await tx.factureSkill.count({
      where: { organizationId, id: { in: ids }, isArchived: false },
    });
    if (found !== new Set(ids).size) {
      throw new BadRequestException({
        code: 'FACTURE_SKILL_INVALID',
        message: 'Choisissez des compétences actives de votre entreprise.',
      });
    }
  }

  private async unique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'FACTURE_SKILL_TAKEN',
          message: 'Cette compétence existe déjà.',
        });
      }
      throw e;
    }
  }

  private record(ctx: FactureContext, action: string, targetType: string, targetId: string) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
    });
  }
}
