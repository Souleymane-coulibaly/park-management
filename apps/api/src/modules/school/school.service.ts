import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  canTransitionSchoolYear,
  isValidDateRange,
  periodsOverlap,
  validateGradingRules,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import type {
  CreateClassDto,
  CreateCycleDto,
  CreateGradingPolicyDto,
  CreateLevelDto,
  CreatePeriodDto,
  CreateSchoolDto,
  CreateSubjectDto,
  CreateTrackDto,
  CreateYearDto,
  UpdateSchoolDto,
  YearStatusDto,
} from './school.dto';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** Tout accès passe par le client et le périmètre du contexte ; aucune suppression n'est proposée. */
@Injectable()
export class SchoolService {
  private readonly logger = new Logger(SchoolService.name);

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Contexte et tableau de bord ───

  async context(ctx: SchoolContext) {
    const schools = await this.db.school.findMany({
      where: this.schoolWhere(ctx),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameAr: true,
        type: true,
        defaultLocale: true,
        isActive: true,
      },
    });
    return {
      role: ctx.role,
      access: ctx.access,
      modules: ctx.modules,
      limits: ctx.limits,
      schools,
    };
  }

  /** Indicateurs réels de la structure ; aucun chiffre sur les élèves avant leur module. */
  async dashboard(ctx: SchoolContext) {
    const schools = await this.db.school.findMany({
      where: this.schoolWhere(ctx),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameAr: true,
        type: true,
        isActive: true,
        _count: { select: { subjects: true, tracks: true, cycles: true } },
        years: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { id: true, label: true, _count: { select: { classes: true, periods: true } } },
        },
      },
    });
    return {
      access: ctx.access,
      schools: schools.map(({ years, _count, ...school }) => ({
        ...school,
        subjects: _count.subjects,
        tracks: _count.tracks,
        cycles: _count.cycles,
        activeYear: years[0]
          ? {
              id: years[0].id,
              label: years[0].label,
              classes: years[0]._count.classes,
              periods: years[0]._count.periods,
            }
          : null,
      })),
    };
  }

  // ─── Établissements ───

  async createSchool(ctx: SchoolContext, dto: CreateSchoolDto) {
    const org = await this.core.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true, timezone: true },
    });
    const school = await this.unique(
      () =>
        this.db.$transaction(async (tx) => {
          // Verrou sur le groupe : deux créations simultanées ne dépassent pas la limite du contrat.
          const group = await tx.schoolGroup.upsert({
            where: { organizationId: ctx.organizationId },
            update: { legalName: org.name },
            create: { organizationId: ctx.organizationId, legalName: org.name },
            select: { id: true },
          });
          if (ctx.limits.maxSchools !== undefined) {
            const count = await tx.school.count({ where: { organizationId: ctx.organizationId } });
            if (count >= ctx.limits.maxSchools) {
              throw new ConflictException({
                code: 'CONTRACT_SCHOOL_LIMIT',
                message: 'La limite d’établissements de votre contrat est atteinte.',
              });
            }
          }
          return tx.school.create({
            data: {
              organizationId: ctx.organizationId,
              groupId: group.id,
              name: dto.name,
              nameAr: dto.nameAr ?? null,
              type: dto.type,
              countryCode: dto.countryCode,
              timezone: org.timezone,
              defaultLocale: dto.defaultLocale ?? 'FR',
              address: dto.address ?? null,
              phone: dto.phone ?? null,
              email: dto.email ?? null,
            },
          });
        }),
      'SCHOOL_NAME_USED',
      'Un établissement porte déjà ce nom.',
    );
    await this.log(ctx, 'school.created', 'School', school.id, { type: school.type });
    return school;
  }

  async listSchools(ctx: SchoolContext) {
    return this.db.school.findMany({ where: this.schoolWhere(ctx), orderBy: { name: 'asc' } });
  }

  async updateSchool(ctx: SchoolContext, id: string, dto: UpdateSchoolDto) {
    await this.assertSchool(ctx, id);
    const school = await this.unique(
      () => this.db.school.update({ where: { id }, data: dto }),
      'SCHOOL_NAME_USED',
      'Un établissement porte déjà ce nom.',
    );
    await this.log(ctx, 'school.updated', 'School', id, { fields: Object.keys(dto) });
    return school;
  }

  // ─── Années et périodes ───

  async listYears(ctx: SchoolContext, schoolId: string) {
    await this.assertSchool(ctx, schoolId);
    return this.db.schoolYear.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { startsOn: 'desc' },
      include: { periods: { orderBy: { position: 'asc' } } },
    });
  }

  async createYear(ctx: SchoolContext, dto: CreateYearDto) {
    await this.assertSchool(ctx, dto.schoolId);
    this.assertRange(dto.startsOn, dto.endsOn);
    const year = await this.unique(
      () =>
        this.db.schoolYear.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: dto.schoolId,
            label: dto.label,
            startsOn: toDate(dto.startsOn),
            endsOn: toDate(dto.endsOn),
          },
        }),
      'SCHOOL_YEAR_USED',
      'Cette année scolaire existe déjà.',
    );
    await this.log(ctx, 'school.year_created', 'SchoolYear', year.id, { label: year.label });
    return year;
  }

  /** Une seule année en cours par établissement, contrôlée sous verrou ; une clôture est définitive. */
  async setYearStatus(ctx: SchoolContext, id: string, dto: YearStatusDto) {
    const year = await this.findYear(ctx, id);
    if (!canTransitionSchoolYear(year.status, dto.status)) {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_TRANSITION_REFUSED',
        message: 'Ce changement de statut n’est pas autorisé.',
      });
    }
    const updated = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${year.schoolId}::uuid FOR UPDATE`;
      if (dto.status === 'ACTIVE') {
        const active = await tx.schoolYear.count({
          where: { schoolId: year.schoolId, status: 'ACTIVE' },
        });
        if (active > 0) {
          throw new ConflictException({
            code: 'SCHOOL_YEAR_ALREADY_ACTIVE',
            message: 'Clôturez d’abord l’année en cours.',
          });
        }
      }
      const { count } = await tx.schoolYear.updateMany({
        where: { id, status: year.status },
        data: { status: dto.status },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'SCHOOL_YEAR_CHANGED',
          message: 'Cette année vient de changer : rechargez la page.',
        });
      }
      if (dto.status === 'CLOSED') {
        await tx.schoolClassAssignment.updateMany({
          where: { organizationId: ctx.organizationId, schoolYearId: id, endedAt: null },
          data: { endedAt: new Date() },
        });
        await tx.schoolStudent.updateMany({
          where: {
            organizationId: ctx.organizationId,
            schoolId: year.schoolId,
            status: 'ENROLLED',
            enrollments: { none: { status: 'VALIDATED', year: { status: { not: 'CLOSED' } } } },
          },
          data: { status: 'REGISTERED' },
        });
      }
      await this.recordDecision(tx, ctx, 'school.year_status_changed', 'SchoolYear', id, {
        from: year.status,
        to: dto.status,
      });
      return tx.schoolYear.findUniqueOrThrow({ where: { id } });
    });
    await this.publishDecisions(ctx.organizationId);
    return updated;
  }

  /** À appeler dans la transaction qui applique la décision : les deux réussissent ou échouent ensemble. */
  async recordDecision(
    tx: Prisma.TransactionClient,
    ctx: SchoolContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, string | number | boolean | string[] | null>,
  ): Promise<void> {
    await tx.schoolAccessDecision.create({
      data: {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action,
        targetType,
        targetId,
        metadata,
      },
    });
  }

  /**
   * Publie au journal Suite les décisions en attente. Ne lève jamais : la décision reste en attente et sera
   * reprise. Une ligne verrouillée n'est traitée que par un seul appel ; si le marquage a échoué après une
   * publication, `decisionId` évite le doublon dans le cas courant. Réserve S2-PUB-01 assumée : si la
   * transaction School expire pendant une insertion Suite, deux entrées peuvent porter le même
   * `decisionId` ; toute restitution doit donc dédoublonner sur ce champ.
   */
  async publishDecisions(organizationId: string): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SchoolAccessDecision"
          WHERE "organizationId" = ${organizationId}::uuid AND "publishedAt" IS NULL
          ORDER BY "createdAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const { id } of rows) {
          const decision = await tx.schoolAccessDecision.findUniqueOrThrow({ where: { id } });
          const known = await this.core.auditLog.count({
            where: {
              organizationId,
              action: decision.action,
              targetId: decision.targetId,
              metadata: { path: ['decisionId'], equals: id },
            },
          });
          if (known === 0) {
            await this.audit.record({
              organizationId,
              actorUserId: decision.actorUserId,
              action: decision.action,
              targetType: decision.targetType,
              targetId: decision.targetId,
              metadata: { ...(decision.metadata as Record<string, never>), decisionId: id },
            });
          }
          await tx.schoolAccessDecision.update({
            where: { id },
            data: { publishedAt: new Date() },
          });
        }
      });
    } catch (error) {
      this.logger.warn(`Décisions d'accès en attente de publication : ${(error as Error).name}`);
    }
  }

  /**
   * Verrou partagé des opérations qui exigent une année ouverte, pris avant tout autre verrou. La clôture
   * prend ce même établissement en exclusif : elle attend ces opérations, et elles relisent ensuite l'année.
   */
  async guardSchools(tx: Prisma.TransactionClient, schoolIds: string[]) {
    for (const id of [...new Set(schoolIds)].sort()) {
      await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${id}::uuid FOR SHARE`;
    }
  }

  private async assertYearStillOpen(tx: Prisma.TransactionClient, id: string) {
    const { status } = await tx.schoolYear.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    if (status === 'CLOSED') throw this.closed();
  }

  async createPeriod(ctx: SchoolContext, dto: CreatePeriodDto) {
    const year = await this.findYear(ctx, dto.schoolYearId);
    if (year.status === 'CLOSED') throw this.closed();
    this.assertRange(dto.startsOn, dto.endsOn);
    const startsOn = toDate(dto.startsOn);
    const endsOn = toDate(dto.endsOn);
    if (startsOn < year.startsOn || endsOn > year.endsOn) {
      throw new BadRequestException({
        code: 'PERIOD_OUTSIDE_YEAR',
        message: 'La période doit rester dans l’année scolaire.',
      });
    }
    const period = await this.db.$transaction(async (tx) => {
      await this.guardSchools(tx, [year.schoolId]);
      await tx.$queryRaw`SELECT id FROM "SchoolYear" WHERE id = ${year.id}::uuid FOR UPDATE`;
      await this.assertYearStillOpen(tx, year.id);
      const existing = await tx.academicPeriod.findMany({
        where: { schoolYearId: year.id },
        select: { startsOn: true, endsOn: true, position: true },
      });
      if (existing.some((p) => periodsOverlap(p, { startsOn, endsOn }))) {
        throw new ConflictException({
          code: 'PERIOD_OVERLAP',
          message: 'Cette période chevauche une période existante.',
        });
      }
      return tx.academicPeriod.create({
        data: {
          organizationId: ctx.organizationId,
          schoolYearId: year.id,
          kind: dto.kind,
          label: dto.label,
          labelAr: dto.labelAr ?? null,
          position: Math.max(0, ...existing.map((p) => p.position)) + 1,
          startsOn,
          endsOn,
        },
      });
    });
    await this.log(ctx, 'school.period_created', 'AcademicPeriod', period.id, {});
    return period;
  }

  // ─── Parcours, cycles, niveaux, classes, matières ───

  async listTracks(ctx: SchoolContext, schoolId: string) {
    await this.assertSchool(ctx, schoolId);
    return this.db.pedagogicalTrack.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { name: 'asc' },
    });
  }

  async createTrack(ctx: SchoolContext, dto: CreateTrackDto) {
    await this.assertSchool(ctx, dto.schoolId);
    const track = await this.unique(
      () =>
        this.db.pedagogicalTrack.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: dto.schoolId,
            name: dto.name,
            nameAr: dto.nameAr ?? null,
            locale: dto.locale ?? 'FR',
          },
        }),
      'SCHOOL_NAME_USED',
      'Ce parcours existe déjà.',
    );
    await this.log(ctx, 'school.track_created', 'PedagogicalTrack', track.id, {});
    return track;
  }

  async listCycles(ctx: SchoolContext, schoolId: string) {
    await this.assertSchool(ctx, schoolId);
    return this.db.cycle.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { position: 'asc' },
      include: { levels: { orderBy: { position: 'asc' } } },
    });
  }

  async createCycle(ctx: SchoolContext, dto: CreateCycleDto) {
    await this.assertSchool(ctx, dto.schoolId);
    const position =
      (await this.db.cycle.count({
        where: { organizationId: ctx.organizationId, schoolId: dto.schoolId },
      })) + 1;
    const cycle = await this.unique(
      () =>
        this.db.cycle.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: dto.schoolId,
            name: dto.name,
            nameAr: dto.nameAr ?? null,
            position,
          },
        }),
      'SCHOOL_NAME_USED',
      'Ce cycle existe déjà.',
    );
    await this.log(ctx, 'school.cycle_created', 'Cycle', cycle.id, {});
    return cycle;
  }

  async createLevel(ctx: SchoolContext, dto: CreateLevelDto) {
    const cycle = await this.db.cycle.findFirst({
      where: { id: dto.cycleId, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true },
    });
    if (!cycle) throw new NotFoundException(NOT_FOUND);
    await this.assertSchool(ctx, cycle.schoolId);
    const position = (await this.db.level.count({ where: { cycleId: cycle.id } })) + 1;
    const level = await this.unique(
      () =>
        this.db.level.create({
          data: {
            organizationId: ctx.organizationId,
            cycleId: cycle.id,
            name: dto.name,
            nameAr: dto.nameAr ?? null,
            position,
          },
        }),
      'SCHOOL_NAME_USED',
      'Ce niveau existe déjà.',
    );
    await this.log(ctx, 'school.level_created', 'Level', level.id, {});
    return level;
  }

  async listClasses(ctx: SchoolContext, schoolYearId: string) {
    await this.findYear(ctx, schoolYearId);
    return this.db.schoolClass.findMany({
      where: { organizationId: ctx.organizationId, schoolYearId },
      orderBy: { name: 'asc' },
      include: {
        level: { select: { id: true, name: true, nameAr: true } },
        track: { select: { id: true, name: true, nameAr: true } },
      },
    });
  }

  /** L'année, le niveau et le parcours d'une classe doivent appartenir au même établissement. */
  async createClass(ctx: SchoolContext, dto: CreateClassDto) {
    const year = await this.findYear(ctx, dto.schoolYearId);
    if (year.status === 'CLOSED') throw this.closed();
    const level = await this.db.level.findFirst({
      where: { id: dto.levelId, organizationId: ctx.organizationId },
      select: { cycle: { select: { schoolId: true } } },
    });
    if (level?.cycle.schoolId !== year.schoolId) throw this.otherSchool();
    if (dto.trackId) await this.assertTrackInSchool(ctx, dto.trackId, year.schoolId);
    const created = await this.unique(
      () =>
        this.db.$transaction(async (tx) => {
          await this.guardSchools(tx, [year.schoolId]);
          await this.assertYearStillOpen(tx, year.id);
          return tx.schoolClass.create({
            data: {
              organizationId: ctx.organizationId,
              schoolYearId: year.id,
              levelId: dto.levelId,
              trackId: dto.trackId ?? null,
              name: dto.name,
              nameAr: dto.nameAr ?? null,
              capacity: dto.capacity ?? null,
            },
          });
        }),
      'SCHOOL_NAME_USED',
      'Cette classe existe déjà pour cette année.',
    );
    await this.log(ctx, 'school.class_created', 'SchoolClass', created.id, {});
    return created;
  }

  async listSubjects(ctx: SchoolContext, schoolId: string) {
    await this.assertSchool(ctx, schoolId);
    return this.db.subject.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { name: 'asc' },
      include: { track: { select: { id: true, name: true, nameAr: true } } },
    });
  }

  async createSubject(ctx: SchoolContext, dto: CreateSubjectDto) {
    await this.assertSchool(ctx, dto.schoolId);
    if (dto.trackId) await this.assertTrackInSchool(ctx, dto.trackId, dto.schoolId);
    const subject = await this.unique(
      () =>
        this.db.subject.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: dto.schoolId,
            trackId: dto.trackId ?? null,
            name: dto.name,
            nameAr: dto.nameAr ?? null,
            isReligious: dto.isReligious ?? false,
            defaultCoefficient: dto.defaultCoefficient ?? 1,
          },
        }),
      'SCHOOL_NAME_USED',
      'Cette matière existe déjà.',
    );
    await this.log(ctx, 'school.subject_created', 'Subject', subject.id, {});
    return subject;
  }

  // ─── Règles de notation ───

  async listPolicies(ctx: SchoolContext, schoolId: string) {
    await this.assertSchool(ctx, schoolId);
    return this.db.gradingPolicyVersion.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { version: 'desc' },
    });
  }

  /** Ajout d'une version, jamais de réécriture : un bulletin garde les règles de son calcul. */
  async createPolicy(ctx: SchoolContext, dto: CreateGradingPolicyDto) {
    await this.assertSchool(ctx, dto.schoolId);
    const errors = validateGradingRules(dto.rules);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_GRADING_RULES',
        message: 'Règles de notation invalides.',
        details: errors,
      });
    }
    const policy = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${dto.schoolId}::uuid FOR UPDATE`;
      const last = await tx.gradingPolicyVersion.aggregate({
        where: { schoolId: dto.schoolId },
        _max: { version: true },
      });
      return tx.gradingPolicyVersion.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: dto.schoolId,
          version: (last._max.version ?? 0) + 1,
          rules: dto.rules as unknown as Prisma.InputJsonObject,
          effectiveFrom: toDate(dto.effectiveFrom),
          createdByUserId: ctx.userId,
        },
      });
    });
    await this.log(ctx, 'school.grading_policy_created', 'GradingPolicyVersion', policy.id, {
      version: policy.version,
    });
    return policy;
  }

  // ─── Export ───

  /** Export structuré du périmètre, autorisé en lecture seule : le client reste maître de ses données. */
  async export(ctx: SchoolContext) {
    const schools = await this.db.school.findMany({
      where: this.schoolWhere(ctx),
      orderBy: { name: 'asc' },
      include: {
        tracks: true,
        subjects: true,
        policies: { orderBy: { version: 'asc' } },
        cycles: { include: { levels: true }, orderBy: { position: 'asc' } },
        years: {
          orderBy: { startsOn: 'asc' },
          include: { periods: { orderBy: { position: 'asc' } }, classes: true },
        },
      },
    });
    await this.log(ctx, 'school.exported', 'School', null, { schools: schools.length });
    return { exportedAt: new Date().toISOString(), organizationId: ctx.organizationId, schools };
  }

  // ─── Outils ───

  schoolWhere(ctx: SchoolContext): Prisma.SchoolWhereInput {
    return {
      organizationId: ctx.organizationId,
      ...(ctx.schoolIds ? { id: { in: ctx.schoolIds } } : {}),
    };
  }

  async assertSchool(ctx: SchoolContext, id: string): Promise<void> {
    const school = await this.db.school.findFirst({
      where: { ...this.schoolWhere(ctx), id },
      select: { id: true },
    });
    // Le filtre ctx.schoolIds n'est pas écrasé : un identifiant hors périmètre reste introuvable.
    if (!school || (ctx.schoolIds && !ctx.schoolIds.includes(id))) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  async findYear(ctx: SchoolContext, id: string) {
    const year = await this.db.schoolYear.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!year) throw new NotFoundException(NOT_FOUND);
    await this.assertSchool(ctx, year.schoolId);
    return year;
  }

  private async assertTrackInSchool(ctx: SchoolContext, trackId: string, schoolId: string) {
    const track = await this.db.pedagogicalTrack.findFirst({
      where: { id: trackId, organizationId: ctx.organizationId, schoolId },
      select: { id: true },
    });
    if (!track) throw this.otherSchool();
  }

  private assertRange(startsOn: string, endsOn: string) {
    if (!isValidDateRange(startsOn, endsOn)) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'La date de fin doit suivre la date de début.',
      });
    }
  }

  private closed() {
    return new ConflictException({
      code: 'SCHOOL_YEAR_CLOSED',
      message: 'Cette année scolaire est clôturée.',
    });
  }

  private otherSchool() {
    return new BadRequestException({
      code: 'OTHER_SCHOOL',
      message: 'Ces éléments n’appartiennent pas au même établissement.',
    });
  }

  async unique<T>(work: () => Promise<T>, code: string, message: string): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code, message });
      }
      throw error;
    }
  }

  async log(
    ctx: SchoolContext,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, string | number | string[] | null>,
  ) {
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}
