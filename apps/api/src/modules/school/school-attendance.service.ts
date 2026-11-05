import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_DEFAULT_SLOT,
  type SchoolAttendanceStatus,
  attendanceAlerts,
  attendanceStats,
  attendanceStatsFromCounts,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { SchoolContext } from './school-access';
import type {
  AttendanceQueryDto,
  JustificationCreateDto,
  JustificationReviewDto,
  SaveAttendanceDto,
} from './school-portal.dto';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolNotificationsService } from './school-notifications.service';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
/** Justificatif : période d'un mois au plus, au plus un mois à l'avance (absence prévue). */
const MAX_JUSTIFICATION_DAYS = 31;
const HISTORY_LIMIT = 500;

/** Date AAAA-MM-JJ décalée de `days` jours. */
function shift(iso: string, days: number): string {
  return day(new Date(toDate(iso).getTime() + days * 86_400_000));
}

/**
 * Présences (Sprint 6) : appel d'une classe par jour et séance, jamais deux fois pour la même séance
 * (unicité en base). Toute correction est motivée et conservée dans l'historique. L'enseignant ne fait
 * l'appel que pour ses classes. Une absence couverte par un justificatif accepté est enregistrée
 * « justifiée ». Absence et retard notifient les responsables (portail, SMS si activés).
 */
@Injectable()
export class SchoolAttendanceService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly school: SchoolService,
    private readonly assessment: SchoolAssessmentService,
    private readonly students: SchoolStudentsService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  /** Feuille d'appel : élèves de la classe, relevé existant, justificatifs acceptés pour ce jour. */
  async sheet(ctx: SchoolContext, q: AttendanceQueryDto) {
    const scope = await this.classInScope(ctx, q.classId);
    const slot = q.slot ?? SCHOOL_DEFAULT_SLOT;
    return this.students.snapshot(async (tx) => {
      const roster = await this.assessment.roster(tx, ctx, scope.id);
      const session = await tx.schoolAttendanceSession.findUnique({
        where: { classId_date_slot: { classId: scope.id, date: toDate(q.date), slot } },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          records: {
            select: { id: true, studentId: true, status: true, minutesLate: true, note: true },
          },
        },
      });
      const records = new Map((session?.records ?? []).map((r) => [r.studentId, r]));
      // Élèves relevés dans cette séance puis sortis de la classe : toujours affichés, pour corriger.
      const everyone = await this.withFormer(tx, ctx.organizationId, roster, [...records.keys()]);
      const justified = await this.justifiedOn(
        tx,
        ctx.organizationId,
        scope.schoolId,
        everyone.map((s) => s.id),
        q.date,
      );
      return {
        class: { id: scope.id, name: scope.name, nameAr: scope.nameAr },
        date: q.date,
        slot,
        session: session
          ? { id: session.id, takenAt: session.createdAt, updatedAt: session.updatedAt }
          : null,
        students: everyone.map((s) => ({
          id: s.id,
          matricule: s.matricule,
          lastName: s.lastName,
          firstName: s.firstName,
          lastNameAr: s.lastNameAr,
          firstNameAr: s.firstNameAr,
          former: s.former,
          record: records.get(s.id) ?? null,
          justified: justified.has(s.id),
        })),
      };
    });
  }

  /**
   * Enregistre l'appel (collectif) ou une partie (individuel). La séance est créée une seule fois sous
   * verrou ; un relevé existant ne change qu'avec un motif, conservé dans l'historique.
   */
  async save(ctx: SchoolContext, dto: SaveAttendanceDto) {
    const scope = await this.classInScope(ctx, dto.classId);
    const slot = dto.slot ?? SCHOOL_DEFAULT_SLOT;
    if (new Set(dto.records.map((r) => r.studentId)).size !== dto.records.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_STUDENT',
        message: 'Un élève figure deux fois dans l’appel.',
      });
    }
    const school = await this.db.school.findUniqueOrThrow({
      where: { id: scope.schoolId },
      select: { timezone: true },
    });
    if (dto.date > today(school.timezone)) {
      throw new BadRequestException({
        code: 'DATE_IN_FUTURE',
        message: 'L’appel ne peut pas porter sur une date future.',
      });
    }
    const alerts: { recordId: string; studentId: string; status: SchoolAttendanceStatus }[] = [];
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [scope.schoolId]);
      // Classe avant le lien enseignant, comme la fin d'une affectation : l'enseignant tient encore la
      // classe au moment d'écrire, et la garde jusqu'au commit.
      await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ${scope.id}::uuid FOR KEY SHARE`;
      if (!(await this.school.holdsClasses(tx, ctx, [scope.id]))) {
        throw new NotFoundException(NOT_FOUND);
      }
      const year = await tx.schoolYear.findUniqueOrThrow({
        where: { id: scope.schoolYearId },
        select: { status: true, startsOn: true, endsOn: true },
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
      // Séance créée une seule fois, même si deux appels arrivent ensemble ; puis verrouillée.
      await tx.$executeRaw`
        INSERT INTO "SchoolAttendanceSession"
          ("id", "organizationId", "schoolId", "schoolYearId", "classId", "date", "slot", "takenByUserId",
           "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${scope.schoolId}::uuid,
          ${scope.schoolYearId}::uuid, ${scope.id}::uuid, ${dto.date}::date, ${slot}, ${ctx.userId}::uuid,
          now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
        ON CONFLICT ("classId", "date", "slot") DO NOTHING`;
      const [session] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "SchoolAttendanceSession"
        WHERE "classId" = ${scope.id}::uuid AND "date" = ${dto.date}::date AND "slot" = ${slot}
        FOR UPDATE`;
      const roster = new Set((await this.assessment.roster(tx, ctx, scope.id)).map((s) => s.id));
      // Avant de lire les justificatifs : une acceptation concurrente attend cet appel, ou le précède.
      await this.lockStudents(
        tx,
        dto.records.map((r) => r.studentId),
      );
      // Relevés de la séance, stables sous son verrou : un élève sorti de la classe depuis reste
      // corrigeable ; une nouvelle saisie exige l'effectif actuel.
      const existing = new Map(
        (await tx.schoolAttendanceRecord.findMany({ where: { sessionId: session!.id } })).map(
          (r) => [r.studentId, r],
        ),
      );
      if (dto.records.some((r) => !roster.has(r.studentId) && !existing.has(r.studentId))) {
        throw new BadRequestException({
          code: 'STUDENT_NOT_IN_CLASS',
          message: 'Un élève n’est pas inscrit dans cette classe.',
        });
      }
      const justified = await this.justifiedOn(
        tx,
        ctx.organizationId,
        scope.schoolId,
        dto.records.map((r) => r.studentId),
        dto.date,
      );
      let corrections = 0;
      for (const input of dto.records) {
        const status: SchoolAttendanceStatus =
          input.status === 'ABSENT' && justified.has(input.studentId) ? 'EXCUSED' : input.status;
        const minutesLate = status === 'LATE' ? (input.minutesLate ?? null) : null;
        const note = input.note?.trim() || null;
        const current = existing.get(input.studentId);
        if (current) {
          const changed =
            current.status !== status ||
            current.minutesLate !== minutesLate ||
            current.note !== note;
          if (!changed) continue;
          if (!dto.reason) {
            throw new BadRequestException({
              code: 'CORRECTION_REASON_REQUIRED',
              message: 'Corriger un appel déjà enregistré exige un motif.',
            });
          }
          await tx.schoolAttendanceRecord.update({
            where: { id: current.id },
            data: { status, minutesLate, note, updatedByUserId: ctx.userId },
          });
          await tx.schoolAttendanceEvent.create({
            data: {
              organizationId: ctx.organizationId,
              recordId: current.id,
              fromStatus: current.status,
              toStatus: status,
              fromMinutesLate: current.minutesLate,
              toMinutesLate: minutesLate,
              fromNote: current.note,
              toNote: note,
              reason: dto.reason,
              actorUserId: ctx.userId,
            },
          });
          corrections += 1;
          if (status !== current.status && attendanceAlerts(status)) {
            alerts.push({ recordId: current.id, studentId: input.studentId, status });
          }
        } else {
          const created = await tx.schoolAttendanceRecord.create({
            data: {
              organizationId: ctx.organizationId,
              sessionId: session!.id,
              studentId: input.studentId,
              status,
              minutesLate,
              note,
              updatedByUserId: ctx.userId,
            },
          });
          await tx.schoolAttendanceEvent.create({
            data: {
              organizationId: ctx.organizationId,
              recordId: created.id,
              fromStatus: null,
              toStatus: status,
              toMinutesLate: minutesLate,
              toNote: note,
              reason: justified.has(input.studentId) && status === 'EXCUSED' ? 'JUSTIFIED' : null,
              actorUserId: ctx.userId,
            },
          });
          if (attendanceAlerts(status)) {
            alerts.push({ recordId: created.id, studentId: input.studentId, status });
          }
        }
      }
      if (corrections > 0) {
        await this.school.recordDecision(
          tx,
          ctx,
          'school.attendance_corrected',
          'SchoolAttendanceSession',
          session!.id,
          { corrections },
        );
      }
      const date = `${dto.date.slice(8, 10)}/${dto.date.slice(5, 7)}`;
      for (const kind of ['ABSENT', 'LATE'] as const) {
        const group = alerts.filter((a) => a.status === kind);
        for (const a of group) {
          await this.notifications.notifyStudents(tx, {
            organizationId: ctx.organizationId,
            schoolId: scope.schoolId,
            kind: kind === 'ABSENT' ? 'ABSENCE' : 'LATE',
            resourceId: a.recordId,
            studentIds: [a.studentId],
            params: { date: dto.date, slot },
            dedupe: () => `attendance:${a.recordId}:${kind}`,
            sms: { kind: kind === 'ABSENT' ? 'ABSENCE' : 'LATE', date },
          });
        }
      }
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.sheet(ctx, { classId: dto.classId, date: dto.date, slot });
  }

  /** Historique d'un relevé : saisie puis corrections, avec leur auteur et leur motif. */
  async recordHistory(ctx: SchoolContext, recordId: string) {
    const record = await this.db.schoolAttendanceRecord.findFirst({
      where: { id: recordId, organizationId: ctx.organizationId },
      select: { studentId: true, session: { select: { classId: true } } },
    });
    if (!record) throw new NotFoundException(NOT_FOUND);
    await this.classInScope(ctx, record.session.classId);
    const events = await this.db.schoolAttendanceEvent.findMany({
      where: { organizationId: ctx.organizationId, recordId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        fromMinutesLate: true,
        toMinutesLate: true,
        fromNote: true,
        toNote: true,
        reason: true,
        actorUserId: true,
        createdAt: true,
      },
    });
    const actors = await this.core.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.actorUserId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return events.map(({ actorUserId, ...e }) => ({ ...e, actor: names.get(actorUserId) ?? null }));
  }

  /**
   * Présences d'un élève sur une période : relevés, statistiques, justificatifs. L'enseignant ne voit que
   * les relevés de ses classes, sans les justificatifs (motifs des familles).
   */
  async student(ctx: SchoolContext, studentId: string, from?: string, to?: string) {
    const student = await this.students.findStudent(ctx, studentId);
    return this.studentRecords(ctx.organizationId, student.id, from, to, ctx);
  }

  /**
   * Relevés d'un élève, partagés avec le portail parents (enfant autorisé déjà vérifié ; sans `staff`).
   * Statistiques agrégées par la base sur toute la période ; seule la liste affichée est limitée
   * (`truncated`). Classes de l'enseignant lues dans le même instantané que les relevés.
   */
  async studentRecords(
    organizationId: string,
    studentId: string,
    from?: string,
    to?: string,
    staff?: SchoolContext,
  ) {
    const date =
      from || to
        ? { ...(from ? { gte: toDate(from) } : {}), ...(to ? { lte: toDate(to) } : {}) }
        : undefined;
    const [counts, records, justifications] = await this.students.snapshot(async (tx) => {
      const own = staff ? await this.school.ownClasses(staff, tx) : null;
      // Personnel : établissements de son périmètre seulement (un élève transféré garde ses relevés
      // et justificatifs de l'ancien établissement hors de portée du nouveau).
      const schools = staff?.schoolIds ? { schoolId: { in: staff.schoolIds } } : {};
      const where: Prisma.SchoolAttendanceRecordWhereInput = {
        organizationId,
        studentId,
        session: {
          ...schools,
          ...(date ? { date } : {}),
          ...(own ? { classId: { in: own } } : {}),
        },
      };
      return [
        await tx.schoolAttendanceRecord.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        await this.recordsPage(tx, where),
        own ? [] : await this.recentJustifications(tx, { organizationId, studentId, ...schools }),
      ] as const;
    });
    const stats = attendanceStatsFromCounts(
      Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    );
    return {
      stats,
      truncated: stats.sessions > records.length,
      records: records.map((r) => ({
        id: r.id,
        status: r.status,
        minutesLate: r.minutesLate,
        date: day(r.session.date),
        slot: r.session.slot,
        class: r.session.class,
      })),
      justifications: justifications.map((j) => ({
        ...j,
        fromDate: day(j.fromDate),
        toDate: day(j.toDate),
      })),
    };
  }

  private recordsPage(tx: Tx, where: Prisma.SchoolAttendanceRecordWhereInput) {
    return tx.schoolAttendanceRecord.findMany({
      where,
      orderBy: [{ session: { date: 'desc' } }, { session: { slot: 'asc' } }],
      take: HISTORY_LIMIT,
      select: {
        id: true,
        status: true,
        minutesLate: true,
        session: {
          select: {
            date: true,
            slot: true,
            class: { select: { id: true, name: true, nameAr: true } },
          },
        },
      },
    });
  }

  private recentJustifications(tx: Tx, where: Prisma.SchoolAbsenceJustificationWhereInput) {
    return tx.schoolAbsenceJustification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        reason: true,
        byGuardian: true,
        status: true,
        reviewNote: true,
        createdAt: true,
      },
    });
  }

  /** Statistiques d'une classe sur une période : par élève et au total, retards compris. */
  async classStats(ctx: SchoolContext, classId: string, from: string, to: string) {
    const scope = await this.classInScope(ctx, classId);
    return this.students.snapshot(async (tx) => {
      const roster = await this.assessment.roster(tx, ctx, scope.id);
      const records = await tx.schoolAttendanceRecord.findMany({
        where: {
          organizationId: ctx.organizationId,
          session: { classId: scope.id, date: { gte: toDate(from), lte: toDate(to) } },
        },
        select: { studentId: true, status: true, minutesLate: true },
      });
      const sessions = await tx.schoolAttendanceSession.count({
        where: { classId: scope.id, date: { gte: toDate(from), lte: toDate(to) } },
      });
      // Élèves relevés sur la période puis sortis de la classe : le détail explique tout le total.
      const everyone = await this.withFormer(
        tx,
        ctx.organizationId,
        roster,
        records.map((r) => r.studentId),
      );
      return {
        class: { id: scope.id, name: scope.name, nameAr: scope.nameAr },
        from,
        to,
        sessions,
        total: attendanceStats(records.map((r) => r.status)),
        students: everyone.map((s) => {
          const own = records.filter((r) => r.studentId === s.id);
          return {
            id: s.id,
            matricule: s.matricule,
            lastName: s.lastName,
            firstName: s.firstName,
            lastNameAr: s.lastNameAr,
            firstNameAr: s.firstNameAr,
            former: s.former,
            ...attendanceStats(own.map((r) => r.status)),
            minutesLate: own.reduce((sum, r) => sum + (r.minutesLate ?? 0), 0),
          };
        }),
      };
    });
  }

  // ─── Justificatifs ───

  async justifications(ctx: SchoolContext, schoolId: string, status?: string) {
    await this.school.assertSchool(ctx, schoolId);
    const rows = await this.db.schoolAbsenceJustification.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId,
        ...(status ? { status: status as 'PENDING' } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        reason: true,
        byGuardian: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
        student: {
          select: {
            id: true,
            matricule: true,
            lastName: true,
            firstName: true,
            lastNameAr: true,
            firstNameAr: true,
          },
        },
      },
    });
    return rows.map((r) => ({ ...r, fromDate: day(r.fromDate), toDate: day(r.toDate) }));
  }

  /** Justificatif saisi par l'établissement : accepté d'emblée et appliqué aux absences relevées. */
  async createByStaff(ctx: SchoolContext, dto: JustificationCreateDto) {
    const student = await this.students.findStudent(ctx, dto.studentId);
    await this.assertRange(student.schoolId, dto.fromDate, dto.toDate);
    const id = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [student.schoolId]);
      const created = await tx.schoolAbsenceJustification.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: student.schoolId,
          studentId: student.id,
          fromDate: toDate(dto.fromDate),
          toDate: toDate(dto.toDate),
          reason: dto.reason,
          byGuardian: false,
          submittedByUserId: ctx.userId,
          status: 'ACCEPTED',
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
        },
      });
      await this.apply(tx, ctx.organizationId, ctx.userId, created);
      await this.school.recordDecision(
        tx,
        ctx,
        'school.absence_justified',
        'SchoolStudent',
        student.id,
        { justificationId: created.id },
      );
      return created.id;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { id };
  }

  /** Motif transmis par un responsable depuis le portail : en attente de validation. */
  async submitByGuardian(
    organizationId: string,
    schoolId: string,
    studentId: string,
    userId: string,
    dto: Omit<JustificationCreateDto, 'studentId'>,
  ) {
    await this.assertRange(schoolId, dto.fromDate, dto.toDate);
    const created = await this.db.schoolAbsenceJustification.create({
      data: {
        organizationId,
        schoolId,
        studentId,
        fromDate: toDate(dto.fromDate),
        toDate: toDate(dto.toDate),
        reason: dto.reason,
        byGuardian: true,
        submittedByUserId: userId,
      },
      select: { id: true, status: true },
    });
    return created;
  }

  /** Examen d'un justificatif en attente : accepté, il justifie les absences relevées sur sa période. */
  async review(ctx: SchoolContext, id: string, dto: JustificationReviewDto) {
    const found = await this.db.schoolAbsenceJustification.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { schoolId: true, studentId: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [found.schoolId]);
      // Verrou de l'élève avant celui du justificatif et des relevés (même ordre que l'appel).
      await this.lockStudents(tx, [found.studentId]);
      await tx.$queryRaw`SELECT id FROM "SchoolAbsenceJustification" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.schoolAbsenceJustification.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'PENDING') {
        throw new ConflictException({
          code: 'JUSTIFICATION_REVIEWED',
          message: 'Ce justificatif a déjà été examiné.',
        });
      }
      const reviewed = await tx.schoolAbsenceJustification.update({
        where: { id },
        data: {
          status: dto.decision,
          reviewedByUserId: ctx.userId,
          reviewedAt: new Date(),
          reviewNote: dto.note ?? null,
        },
      });
      if (dto.decision === 'ACCEPTED')
        await this.apply(tx, ctx.organizationId, ctx.userId, reviewed);
      await this.school.recordDecision(
        tx,
        ctx,
        'school.absence_justification_reviewed',
        'SchoolStudent',
        found.studentId,
        { justificationId: id, decision: dto.decision },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { reviewed: true };
  }

  // ─── Outils ───

  /** Absences relevées sur la période d'un justificatif accepté : passées en « justifiées », tracées. */
  private async apply(
    tx: Tx,
    organizationId: string,
    actorUserId: string,
    j: { schoolId: string; studentId: string; fromDate: Date; toDate: Date },
  ) {
    // Même verrou que l'appel : un relevé en cours d'enregistrement est visible une fois le verrou obtenu.
    await this.lockStudents(tx, [j.studentId]);
    // Séances de l'établissement du justificatif seulement : après un transfert, il ne touche jamais
    // aux présences relevées par le nouvel établissement.
    const records = await tx.$queryRaw<{ id: string; note: string | null }[]>`
      SELECT r.id, r.note FROM "SchoolAttendanceRecord" r
      JOIN "SchoolAttendanceSession" s ON s.id = r."sessionId"
      WHERE r."organizationId" = ${organizationId}::uuid AND r."studentId" = ${j.studentId}::uuid
        AND s."schoolId" = ${j.schoolId}::uuid AND r.status = 'ABSENT'
        AND s."date" BETWEEN ${day(j.fromDate)}::date AND ${day(j.toDate)}::date
      ORDER BY r.id FOR UPDATE OF r`;
    for (const { id, note } of records) {
      await tx.schoolAttendanceRecord.update({
        where: { id },
        data: { status: 'EXCUSED', updatedByUserId: actorUserId },
      });
      await tx.schoolAttendanceEvent.create({
        data: {
          organizationId,
          recordId: id,
          fromStatus: 'ABSENT',
          toStatus: 'EXCUSED',
          fromNote: note,
          toNote: note,
          reason: 'JUSTIFIED',
          actorUserId,
        },
      });
    }
  }

  /**
   * Effectif actuel suivi des élèves relevés mais sortis de la classe depuis (`former`), triés par nom :
   * leurs relevés restent visibles et corrigeables.
   */
  private async withFormer<T extends { id: string }>(
    tx: Tx,
    organizationId: string,
    roster: T[],
    recordedIds: string[],
  ) {
    const current = new Set(roster.map((s) => s.id));
    const former = await tx.schoolStudent.findMany({
      where: {
        organizationId,
        id: { in: [...new Set(recordedIds)].filter((id) => !current.has(id)) },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        matricule: true,
        lastName: true,
        firstName: true,
        lastNameAr: true,
        firstNameAr: true,
      },
    });
    return [
      ...roster.map((s) => ({ ...s, former: false })),
      ...former.map((s) => ({ ...s, former: true })),
    ];
  }

  /**
   * Verrou des présences de chaque élève, pris dans un ordre unique (identifiants triés) par l'appel et
   * par l'application d'un justificatif : l'un voit toujours ce que l'autre a validé.
   */
  private async lockStudents(tx: Tx, studentIds: string[]) {
    const keys = [
      ...new Set(studentIds.map((id) => `school-attendance:${id.toLowerCase()}`)),
    ].sort();
    if (keys.length === 0) return;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(k, 0))
      FROM (SELECT k FROM unnest(${keys}::text[]) AS k ORDER BY k) ordered`;
  }

  /** Élèves couverts ce jour par un justificatif accepté de cet établissement. */
  private async justifiedOn(
    db: Tx | SchoolPrismaService,
    organizationId: string,
    schoolId: string,
    studentIds: string[],
    date: string,
  ): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const rows = await db.schoolAbsenceJustification.findMany({
      where: {
        organizationId,
        schoolId,
        studentId: { in: studentIds },
        status: 'ACCEPTED',
        fromDate: { lte: toDate(date) },
        toDate: { gte: toDate(date) },
      },
      select: { studentId: true },
    });
    return new Set(rows.map((r) => r.studentId));
  }

  private async assertRange(schoolId: string, from: string, to: string) {
    const school = await this.db.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { timezone: true },
    });
    const now = today(school.timezone);
    if (from > to || to > shift(from, MAX_JUSTIFICATION_DAYS - 1) || from > shift(now, 31)) {
      throw new BadRequestException({
        code: 'INVALID_JUSTIFICATION_PERIOD',
        message: 'Période invalide : un mois au plus, au plus un mois à l’avance.',
      });
    }
  }

  /** Classe du périmètre ; l'enseignant, seulement l'une de ses classes. */
  private async classInScope(ctx: SchoolContext, classId: string) {
    const scope = await this.assessment.findClass(ctx, classId);
    const own = await this.school.ownClasses(ctx);
    if (own && !own.includes(scope.id)) throw new NotFoundException(NOT_FOUND);
    return scope;
  }
}
