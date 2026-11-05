import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SchoolPermission,
  closureApplies,
  hasSchoolPermission,
  minutesToTime,
  rangesOverlap,
  timeToMinutes,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolNotificationsService } from './school-notifications.service';
import type { ExamDto, ExamQueryDto } from './school-planning.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | SchoolPrismaService;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);

export const EXAM_SELECT = {
  id: true,
  schoolId: true,
  date: true,
  startMinute: true,
  durationMinutes: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  room: { select: { id: true, name: true, nameAr: true } },
  supervisor: {
    select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true },
  },
  evaluation: {
    select: {
      id: true,
      title: true,
      titleAr: true,
      kind: true,
      classId: true,
      groupId: true,
      schoolYearId: true,
      class: { select: { id: true, name: true, nameAr: true } },
      group: { select: { id: true, name: true, nameAr: true } },
      subject: { select: { id: true, name: true, nameAr: true } },
    },
  },
} as const;

export type ExamRow = Prisma.SchoolExamScheduleGetPayload<{ select: typeof EXAM_SELECT }>;

export function examView(e: ExamRow) {
  return {
    id: e.id,
    date: day(e.date),
    start: minutesToTime(e.startMinute),
    end: minutesToTime(e.startMinute + e.durationMinutes),
    durationMinutes: e.durationMinutes,
    status: e.status,
    publishedAt: e.publishedAt,
    room: e.room,
    supervisor: e.supervisor,
    evaluation: {
      id: e.evaluation.id,
      title: e.evaluation.title,
      titleAr: e.evaluation.titleAr,
      kind: e.evaluation.kind,
    },
    class: e.evaluation.class,
    group: e.evaluation.group,
    subject: e.evaluation.subject,
  };
}

/**
 * Programmation des examens (Sprint 7) : date, heure, durée, salle et surveillant d'une évaluation du
 * Sprint 4, dont les notes restent la seule source. Refusée un jour de fermeture de la classe, ou en
 * conflit avec un autre examen de la même classe, de la même salle ou du même surveillant. Publiée, elle
 * apparaît au calendrier et notifie les familles ; tout changement de date ou d'horaire les notifie aussi.
 */
@Injectable()
export class SchoolExamsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly assessment: SchoolAssessmentService,
    private readonly calendar: SchoolCalendarService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  /**
   * Examens d'une période : sans brouillon pour qui ne gère pas les examens ; l'enseignant, ceux de ses
   * classes et ceux qu'il surveille.
   */
  async list(ctx: SchoolContext, q: ExamQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const manages = hasSchoolPermission(ctx.role, SchoolPermission.EXAMS_MANAGE);
    const own = await this.school.ownClasses(ctx);
    const rows = await this.db.schoolExamSchedule.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        date: { gte: toDate(q.from), lte: toDate(q.to) },
        ...(manages ? {} : { status: 'PUBLISHED' }),
        ...(q.classId ? { evaluation: { classId: q.classId } } : {}),
        ...(own
          ? {
              OR: [
                { evaluation: { classId: { in: own } } },
                ...(ctx.memberId ? [{ supervisorMemberId: ctx.memberId }] : []),
              ],
            }
          : {}),
      },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
      select: EXAM_SELECT,
    });
    return rows.map(examView);
  }

  async create(ctx: SchoolContext, dto: ExamDto) {
    const evaluation = await this.findEvaluation(ctx, dto.evaluationId);
    const id = await this.db.$transaction(async (tx) => {
      await this.lockWrite(tx, ctx, evaluation);
      const existing = await tx.schoolExamSchedule.findUnique({
        where: { evaluationId: evaluation.id },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: 'EXAM_ALREADY_SCHEDULED',
          message: 'Cette évaluation est déjà programmée.',
        });
      }
      const fields = await this.validate(tx, ctx, evaluation, dto, null);
      await this.syncEvaluationDate(tx, ctx, evaluation, dto.date);
      const created = await tx.schoolExamSchedule.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: evaluation.schoolId,
          evaluationId: evaluation.id,
          ...fields,
          createdByUserId: ctx.userId,
        },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.exam_scheduled',
        'SchoolExamSchedule',
        created.id,
        {
          evaluationId: evaluation.id,
        },
      );
      return created.id;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  /** Modification : une programmation publiée qui change de date ou d'horaire notifie les familles. */
  async update(ctx: SchoolContext, id: string, dto: ExamDto) {
    const found = await this.find(ctx, id);
    if (dto.evaluationId !== found.evaluation.id) throw new NotFoundException(NOT_FOUND);
    const evaluation = await this.findEvaluation(ctx, found.evaluation.id);
    await this.db.$transaction(async (tx) => {
      await this.lockWrite(tx, ctx, evaluation);
      const current = await this.lock(tx, id);
      if (current.status === 'CANCELLED') throw this.cancelled();
      const fields = await this.validate(tx, ctx, evaluation, dto, id);
      if (day(current.date) !== dto.date) {
        await this.syncEvaluationDate(tx, ctx, evaluation, dto.date);
      }
      const updated = await tx.schoolExamSchedule.update({
        where: { id },
        data: { ...fields, updatedByUserId: ctx.userId },
        select: EXAM_SELECT,
      });
      const moved =
        day(current.date) !== dto.date ||
        current.startMinute !== fields.startMinute ||
        current.durationMinutes !== fields.durationMinutes;
      if (current.status === 'PUBLISHED' && moved) {
        await this.notify(tx, ctx, updated, 'moved');
      }
      await this.school.recordDecision(tx, ctx, 'school.exam_updated', 'SchoolExamSchedule', id, {
        moved,
        status: current.status,
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  async publish(ctx: SchoolContext, id: string) {
    const found = await this.find(ctx, id);
    const evaluation = await this.findEvaluation(ctx, found.evaluation.id);
    await this.db.$transaction(async (tx) => {
      await this.lockWrite(tx, ctx, evaluation);
      const current = await this.lock(tx, id);
      await this.assertTargetActive(tx, evaluation);
      if (current.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'EXAM_NOT_DRAFT',
          message: 'Seule une programmation en brouillon peut être publiée.',
        });
      }
      // Revérifiée sous verrou : une fermeture ou un autre examen publié entre-temps l'emporte.
      await this.validate(
        tx,
        ctx,
        evaluation,
        {
          evaluationId: evaluation.id,
          date: day(current.date),
          start: minutesToTime(current.startMinute),
          durationMinutes: current.durationMinutes,
          roomId: current.room?.id ?? null,
          supervisorMemberId: current.supervisor?.id ?? null,
        },
        id,
      );
      const published = await tx.schoolExamSchedule.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByUserId: ctx.userId },
        select: EXAM_SELECT,
      });
      await this.notify(tx, ctx, published, 'published');
      await this.school.recordDecision(tx, ctx, 'school.exam_published', 'SchoolExamSchedule', id, {
        evaluationId: evaluation.id,
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  async cancel(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lock(tx, id);
      if (current.status === 'CANCELLED') throw this.cancelled();
      const cancelled = await tx.schoolExamSchedule.update({
        where: { id },
        data: { status: 'CANCELLED', updatedByUserId: ctx.userId },
        select: EXAM_SELECT,
      });
      if (current.status === 'PUBLISHED') await this.notify(tx, ctx, cancelled, 'cancelled');
      await this.school.recordDecision(tx, ctx, 'school.exam_cancelled', 'SchoolExamSchedule', id, {
        wasPublished: current.status === 'PUBLISHED',
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  async get(ctx: SchoolContext, id: string) {
    return examView(await this.find(ctx, id));
  }

  /** Examens publiés d'une classe sur une période (semaine du planning, portail parents). */
  async publishedFor(db: Db, organizationId: string, where: Prisma.SchoolExamScheduleWhereInput) {
    const rows = await db.schoolExamSchedule.findMany({
      where: { organizationId, status: 'PUBLISHED', ...where },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
      select: EXAM_SELECT,
    });
    return rows.map(examView);
  }

  // ─── Outils ───

  /**
   * Date dans l'année de l'évaluation, hors fermeture de la classe ; salle et surveillant de
   * l'établissement ; aucun chevauchement avec un autre examen non annulé de la même classe (groupes
   * distincts exceptés), de la même salle ou du même surveillant.
   */
  private async validate(
    tx: Tx,
    ctx: SchoolContext,
    evaluation: Awaited<ReturnType<SchoolExamsService['findEvaluation']>>,
    dto: ExamDto,
    selfId: string | null,
  ) {
    const startMinute = timeToMinutes(dto.start);
    if (startMinute + dto.durationMinutes > 1440) {
      throw new BadRequestException({
        code: 'SLOT_INVALID_TIME',
        message: 'L’examen doit se terminer au plus tard à minuit.',
      });
    }
    const year = await tx.schoolYear.findUniqueOrThrow({
      where: { id: evaluation.schoolYearId },
      select: { startsOn: true, endsOn: true, status: true },
    });
    if (year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
    if (dto.date < day(year.startsOn) || dto.date > day(year.endsOn)) {
      throw new BadRequestException({
        code: 'DATE_OUT_OF_YEAR',
        message: 'La date est en dehors de l’année scolaire de la classe.',
      });
    }
    // Date dans la période de l'évaluation : ses notes comptent pour cette période (Sprint 4).
    // Période lue en partage : un changement de ses bornes attend la programmation, ou la précède.
    await tx.$queryRaw`SELECT id FROM "AcademicPeriod" WHERE id = ${evaluation.periodId}::uuid FOR SHARE`;
    const period = await tx.academicPeriod.findUniqueOrThrow({
      where: { id: evaluation.periodId },
      select: { startsOn: true, endsOn: true },
    });
    if (dto.date < day(period.startsOn) || dto.date > day(period.endsOn)) {
      throw new BadRequestException({
        code: 'EXAM_OUTSIDE_PERIOD',
        message: 'La date doit rester dans la période de l’évaluation.',
      });
    }
    const closures = await this.calendar.closures(
      tx,
      ctx.organizationId,
      [evaluation.schoolId],
      dto.date,
      dto.date,
    );
    const closed = closures.find((c) =>
      closureApplies(c, {
        schoolId: evaluation.schoolId,
        classId: evaluation.classId,
        groupIds: evaluation.groupId ? [evaluation.groupId] : [],
      }),
    );
    if (closed) {
      throw new ConflictException({
        code: 'EXAM_ON_CLOSURE',
        message: `Jour de fermeture (${closed.title}) : aucun examen ne peut y être programmé.`,
      });
    }
    const roomId = dto.roomId ?? null;
    const supervisorMemberId = dto.supervisorMemberId ?? null;
    if (roomId) {
      const room = await tx.schoolRoom.findFirst({
        where: {
          id: roomId,
          organizationId: ctx.organizationId,
          schoolId: evaluation.schoolId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!room)
        throw new BadRequestException({ code: 'INVALID_ROOM', message: 'Salle invalide.' });
    }
    if (supervisorMemberId) {
      const member = await tx.schoolMember.findFirst({
        where: {
          id: supervisorMemberId,
          organizationId: ctx.organizationId,
          isActive: true,
          OR: [
            { role: 'GROUP_DIRECTOR' },
            { assignments: { some: { schoolId: evaluation.schoolId } } },
          ],
        },
        select: { id: true },
      });
      if (!member) {
        throw new BadRequestException({
          code: 'INVALID_SUPERVISOR',
          message: 'Surveillant invalide pour cet établissement.',
        });
      }
    }
    const end = startMinute + dto.durationMinutes;
    const sameDay = await tx.schoolExamSchedule.findMany({
      where: {
        organizationId: ctx.organizationId,
        date: toDate(dto.date),
        status: { not: 'CANCELLED' },
        ...(selfId ? { id: { not: selfId } } : {}),
        OR: [
          { evaluation: { classId: evaluation.classId } },
          ...(roomId ? [{ roomId }] : []),
          ...(supervisorMemberId ? [{ supervisorMemberId }] : []),
        ],
      },
      select: {
        id: true,
        startMinute: true,
        durationMinutes: true,
        roomId: true,
        supervisorMemberId: true,
        evaluation: { select: { classId: true, groupId: true, title: true } },
      },
    });
    for (const other of sameDay) {
      if (
        !rangesOverlap(
          startMinute,
          end,
          other.startMinute,
          other.startMinute + other.durationMinutes,
        )
      ) {
        continue;
      }
      const conflict = (code: string, message: string) =>
        new ConflictException({
          code,
          message,
          details: [
            {
              code,
              examId: other.id,
              start: minutesToTime(other.startMinute),
              end: minutesToTime(other.startMinute + other.durationMinutes),
            },
          ],
        });
      const otherGroup = other.evaluation.groupId;
      if (
        other.evaluation.classId === evaluation.classId &&
        !(evaluation.groupId && otherGroup && evaluation.groupId !== otherGroup)
      ) {
        throw conflict('EXAM_CLASS_CONFLICT', 'La classe a déjà un examen à cet horaire.');
      }
      if (roomId && other.roomId === roomId) {
        throw conflict(
          'EXAM_ROOM_CONFLICT',
          'La salle est déjà occupée par un examen à cet horaire.',
        );
      }
      if (supervisorMemberId && other.supervisorMemberId === supervisorMemberId) {
        throw conflict(
          'EXAM_SUPERVISOR_CONFLICT',
          'Le surveillant surveille déjà un examen à cet horaire.',
        );
      }
    }
    return {
      date: toDate(dto.date),
      startMinute,
      durationMinutes: dto.durationMinutes,
      roomId,
      supervisorMemberId,
    };
  }

  /** Classe et groupe de l'évaluation encore actifs, lus en partage jusqu'au commit. */
  private async assertTargetActive(
    tx: Tx,
    evaluation: { classId: string; groupId: string | null },
  ) {
    const rows = evaluation.groupId
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT g.id FROM "SchoolClassGroup" g JOIN "SchoolClass" c ON c.id = g."classId"
          WHERE g.id = ${evaluation.groupId}::uuid AND g."isActive" AND c."isActive" FOR SHARE OF g, c`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SchoolClass" WHERE id = ${evaluation.classId}::uuid AND "isActive" FOR SHARE`;
    if (rows.length === 0) {
      throw new ConflictException({
        code: 'EXAM_TARGET_INACTIVE',
        message: 'La classe ou le groupe de cette évaluation est archivé ou désactivé.',
      });
    }
  }

  /** Familles des élèves de la classe (ou du groupe) : une notification par fait et par élève. */
  private async notify(
    tx: Tx,
    ctx: SchoolContext,
    exam: ExamRow,
    change: 'published' | 'moved' | 'cancelled',
  ) {
    if (exam.evaluation.groupId) {
      const group = await tx.schoolClassGroup.findUnique({
        where: { id: exam.evaluation.groupId },
        select: { isActive: true },
      });
      if (!group?.isActive) return;
    }
    const students = await this.notifications.portalStudents(
      tx,
      ctx.organizationId,
      exam.evaluation.classId,
      exam.evaluation.groupId,
    );
    await this.notifications.notifyStudents(tx, {
      organizationId: ctx.organizationId,
      schoolId: exam.schoolId,
      kind: 'EXAM',
      resourceId: exam.id,
      studentIds: students,
      params: {
        change,
        title: exam.evaluation.title,
        subject: exam.evaluation.subject.name,
        date: day(exam.date),
        start: minutesToTime(exam.startMinute),
      },
      // Un changement = un fait : clé datée de la modification, jamais deux fois la même.
      dedupe: (studentId) => `exam:${exam.id}:${change}:${exam.updatedAt.getTime()}:${studentId}`,
    });
  }

  /**
   * Date de référence unique : la programmation fixe aussi la date de l'évaluation (Sprint 4), sous le
   * verrou des résultats déjà pris par `lockWrite` ; des résultats validés figent l'évaluation.
   */
  private async syncEvaluationDate(
    tx: Tx,
    ctx: SchoolContext,
    evaluation: { id: string; classId: string; periodId: string },
    date: string,
  ) {
    if (await this.assessment.activeValidation(tx, evaluation.classId, evaluation.periodId)) {
      throw new ConflictException({
        code: 'EXAM_RESULTS_VALIDATED',
        message:
          'Les résultats de cette période sont validés : l’évaluation ne peut plus être déplacée.',
      });
    }
    await tx.schoolEvaluation.update({
      where: { id: evaluation.id },
      data: { heldOn: toDate(date), updatedByUserId: ctx.userId },
    });
  }

  /**
   * Verrous d'une écriture de programmation, dans l'ordre commun : planning de l'organisation, puis
   * établissement et année (comme toute écriture du Sprint 4), puis résultats de la classe pour la période,
   * avant toute ligne (programmation, période, évaluation).
   */
  private async lockWrite(
    tx: Tx,
    ctx: SchoolContext,
    evaluation: { schoolId: string; classId: string; periodId: string },
  ) {
    await this.school.lockPlanning(tx, ctx.organizationId);
    await this.school.guardSchools(tx, [evaluation.schoolId]);
    await this.assessment.lockResults(tx, evaluation.classId, evaluation.periodId);
  }

  private async findEvaluation(ctx: SchoolContext, id: string) {
    const evaluation = await this.db.schoolEvaluation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        schoolId: true,
        schoolYearId: true,
        classId: true,
        groupId: true,
        periodId: true,
      },
    });
    if (!evaluation) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, evaluation.schoolId);
    return evaluation;
  }

  private async find(ctx: SchoolContext, id: string) {
    const found = await this.db.schoolExamSchedule.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { ...EXAM_SELECT, supervisorMemberId: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    const manages = hasSchoolPermission(ctx.role, SchoolPermission.EXAMS_MANAGE);
    if (!manages) {
      if (found.status !== 'PUBLISHED') throw new NotFoundException(NOT_FOUND);
      const own = await this.school.ownClasses(ctx);
      if (
        own &&
        !own.includes(found.evaluation.classId) &&
        found.supervisorMemberId !== ctx.memberId
      ) {
        throw new NotFoundException(NOT_FOUND);
      }
    }
    return found;
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolExamSchedule" WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.schoolExamSchedule.findUniqueOrThrow({ where: { id }, select: EXAM_SELECT });
  }

  private cancelled() {
    return new ConflictException({ code: 'EXAM_CANCELLED', message: 'Cet examen est annulé.' });
  }
}
