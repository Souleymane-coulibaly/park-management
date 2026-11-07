import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  type PlanningConflict,
  type PlanningSlot,
  SchoolPermission,
  addDays,
  closureApplies,
  hasSchoolPermission,
  isoWeekday,
  isLimitedToOwnClasses,
  minutesToTime,
  slotConflicts,
  timeToMinutes,
  weekStart,
  weekdayOccurs,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { SchoolContext } from './school-access';
import { type ClassScope, SchoolAssessmentService } from './school-assessment.service';
import { type Closure, SchoolCalendarService } from './school-calendar.service';
import { SchoolExamsService } from './school-exams.service';
import { SchoolNotificationsService } from './school-notifications.service';
import type {
  LessonCancellationDto,
  SlotDto,
  TimetableDto,
  TimetableUpdateDto,
  UnavailabilityDto,
  UnavailabilityQueryDto,
} from './school-planning.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
const endMinutes = (end: string) => (end === '24:00' ? 1440 : timeToMinutes(end));
/** Fil des changements d'un enseignant : 30 derniers jours. */
const CHANGES_DAYS = 30;
/** Faits publiés qui forment le fil des changements d'un enseignant. */
const CHANGE_ACTIONS = [
  'published',
  'slot_added',
  'slot_changed',
  'slot_removed',
  'lesson_cancelled',
  'lesson_restored',
] as const;

const CONFLICT_MESSAGES: Record<string, string> = {
  SLOT_CLASS_OVERLAP: 'Ce créneau chevauche un autre cours de la classe.',
  SLOT_TEACHER_CONFLICT: 'L’enseignant a déjà cours à cet horaire dans une autre classe.',
  SLOT_ROOM_CONFLICT: 'La salle est déjà occupée à cet horaire.',
  SLOT_TEACHER_UNAVAILABLE: 'L’enseignant est indisponible à cet horaire.',
  SLOT_TEACHER_NOT_ASSIGNED: 'L’enseignant n’est plus affecté à cette matière dans la classe.',
  SLOT_SUBJECT_INACTIVE: 'La matière de ce cours est désactivée.',
  SLOT_GROUP_INACTIVE: 'Le groupe de ce cours est désactivé.',
  SLOT_ROOM_INACTIVE: 'La salle de ce cours est désactivée.',
};

const SLOT_SELECT = {
  id: true,
  timetableId: true,
  weekday: true,
  startMinute: true,
  endMinute: true,
  kind: true,
  subjectId: true,
  memberId: true,
  groupId: true,
  roomId: true,
  label: true,
  labelAr: true,
  subject: { select: { id: true, name: true, nameAr: true } },
  member: {
    select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true },
  },
  room: { select: { id: true, name: true, nameAr: true } },
} as const;

type SlotRow = Prisma.SchoolTimetableSlotGetPayload<{ select: typeof SLOT_SELECT }>;

const TIMETABLE_SELECT = {
  id: true,
  schoolId: true,
  schoolYearId: true,
  classId: true,
  label: true,
  status: true,
  validFrom: true,
  validTo: true,
  sourceId: true,
  publishedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TimetableRow = Prisma.SchoolTimetableGetPayload<{ select: typeof TIMETABLE_SELECT }>;

/** Filtre d'une vue de semaine : une classe (et ses groupes), un enseignant ou une salle. */
interface WeekFilter {
  organizationId: string;
  schoolIds: string[] | null;
  classId?: string;
  /** Établissement de la classe (vue d'une classe ou d'un enfant) : ses seules fermetures. */
  schoolId?: string;
  /** Enfant d'un parent : créneaux de toute la classe ou de l'un de ses groupes seulement. */
  groupIds?: string[];
  memberId?: string;
  roomId?: string;
  /** Enseignant : seulement ses classes (examens qu'il surveille exceptés). */
  classIds?: string[] | null;
  selfMemberId?: string | null;
  /** Portail parents : une fermeture réservée au personnel n'est qu'une suspension, sans son titre. */
  families?: boolean;
}

/**
 * Emplois du temps (Sprint 7). Une version par classe et par période de validité : brouillon, puis
 * publication contrôlée qui remplace la fin des versions précédentes. Créneaux d'une semaine type (cours
 * ou pause), conflits refusés à la création, à la modification et à la publication (classe, enseignant,
 * salle, indisponibilité, affectation), sous le verrou du planning de l'organisation. Les fermetures du
 * calendrier suspendent les cours ; un cours publié s'annule à une date précise.
 */
/** Conflit détecté, avec la plage demandée (seule restituée pour un établissement hors périmètre). */
type RestitutedConflict = PlanningConflict & { requested?: { start: number; end: number } };

@Injectable()
export class SchoolTimetablesService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly school: SchoolService,
    private readonly assessment: SchoolAssessmentService,
    private readonly calendar: SchoolCalendarService,
    private readonly exams: SchoolExamsService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  // ─── Versions ───

  /** Versions d'une classe ; brouillons réservés à qui prépare le planning. */
  async list(ctx: SchoolContext, classId: string) {
    const scope = await this.classInScope(ctx, classId);
    const rows = await this.db.schoolTimetable.findMany({
      where: {
        organizationId: ctx.organizationId,
        classId: scope.id,
        ...(this.manages(ctx) ? {} : { status: 'PUBLISHED' }),
      },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      select: { ...TIMETABLE_SELECT, _count: { select: { slots: true } } },
    });
    return rows.map(({ _count, ...t }) => ({ ...timetableView(t), slots: _count.slots }));
  }

  /** Version, créneaux et historique. */
  async get(ctx: SchoolContext, id: string) {
    const tt = await this.find(ctx, id);
    const [slots, events, scope] = await Promise.all([
      this.db.schoolTimetableSlot.findMany({
        where: { organizationId: ctx.organizationId, timetableId: id },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
        select: SLOT_SELECT,
      }),
      this.db.schoolTimetableEvent.findMany({
        where: { organizationId: ctx.organizationId, timetableId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, action: true, details: true, actorUserId: true, createdAt: true },
      }),
      this.assessment.findClass(ctx, tt.classId),
    ]);
    const groups = await this.groupNames(slots.map((s) => s.groupId));
    const actors = await this.core.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.actorUserId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return {
      ...timetableView(tt),
      class: { id: scope.id, name: scope.name, nameAr: scope.nameAr },
      slots: slots.map((s) => slotView(s, groups)),
      events: events.map(({ actorUserId, ...e }) => ({
        ...e,
        actor: names.get(actorUserId) ?? null,
      })),
    };
  }

  /** Nouvelle version en brouillon, vide ou copiée d'une version de la classe (semaine type). */
  async create(ctx: SchoolContext, dto: TimetableDto) {
    const scope = await this.assessment.findClass(ctx, dto.classId);
    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        await this.school.lockPlanning(tx, ctx.organizationId);
        await this.assertValidity(tx, scope, dto.validFrom, dto.validTo);
        let source: SlotRow[] = [];
        if (dto.sourceId) {
          const from = await tx.schoolTimetable.findFirst({
            where: { id: dto.sourceId, organizationId: ctx.organizationId, classId: scope.id },
            select: { id: true },
          });
          if (!from) throw new NotFoundException(NOT_FOUND);
          source = await tx.schoolTimetableSlot.findMany({
            where: { organizationId: ctx.organizationId, timetableId: from.id },
            select: SLOT_SELECT,
          });
        }
        const created = await tx.schoolTimetable.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: scope.schoolId,
            schoolYearId: scope.schoolYearId,
            classId: scope.id,
            label: dto.label ?? null,
            validFrom: toDate(dto.validFrom),
            validTo: toDate(dto.validTo),
            sourceId: dto.sourceId ?? null,
            createdByUserId: ctx.userId,
          },
        });
        if (source.length > 0) {
          await tx.schoolTimetableSlot.createMany({
            data: source.map((s) => ({
              organizationId: ctx.organizationId,
              timetableId: created.id,
              weekday: s.weekday,
              startMinute: s.startMinute,
              endMinute: s.endMinute,
              kind: s.kind,
              subjectId: s.subjectId,
              memberId: s.memberId,
              groupId: s.groupId,
              roomId: s.roomId,
              label: s.label,
              labelAr: s.labelAr,
            })),
          });
        }
        await this.event(tx, ctx, created.id, 'created', {
          sourceId: dto.sourceId ?? null,
          copiedSlots: source.length,
        });
        return created.id;
      });
    } catch (error) {
      // Un seul brouillon par classe (index partiel) : deux créations simultanées, une seule passe.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.draftExists();
      }
      throw error;
    }
    return this.get(ctx, id);
  }

  /** Validité ou libellé d'un brouillon. */
  async update(ctx: SchoolContext, id: string, dto: TimetableUpdateDto) {
    const tt = await this.find(ctx, id);
    const scope = await this.assessment.findClass(ctx, tt.classId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lockTimetable(tx, id);
      if (current.status !== 'DRAFT') throw this.notDraft();
      const validFrom = dto.validFrom ?? day(current.validFrom);
      const validTo = dto.validTo ?? day(current.validTo);
      await this.assertValidity(tx, scope, validFrom, validTo);
      await tx.schoolTimetable.update({
        where: { id },
        data: {
          validFrom: toDate(validFrom),
          validTo: toDate(validTo),
          ...(dto.label !== undefined ? { label: dto.label } : {}),
        },
      });
      await this.event(tx, ctx, id, 'updated', { validFrom, validTo });
    });
    return this.get(ctx, id);
  }

  /** Suppression d'un brouillon (une version publiée s'archive). */
  async remove(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lockTimetable(tx, id);
      if (current.status !== 'DRAFT') throw this.notDraft();
      await tx.schoolTimetable.delete({ where: { id } });
    });
    await this.school.log(ctx, 'school.timetable_draft_deleted', 'SchoolTimetable', id, {});
    return { deleted: true };
  }

  // ─── Créneaux ───

  async addSlot(ctx: SchoolContext, timetableId: string, dto: SlotDto) {
    await this.find(ctx, timetableId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, timetableId);
      if (tt.status === 'ARCHIVED') throw this.archived();
      const data = await this.validateSlot(tx, ctx, tt, dto);
      await this.assertNoConflict(tx, ctx, tt, [
        { ...planningSlot({ ...data, id: '', timetableId }, tt), id: undefined },
      ]);
      const created = await tx.schoolTimetableSlot.create({
        data: { organizationId: ctx.organizationId, timetableId, ...data },
      });
      await this.changed(tx, ctx, tt, 'slot_added', {
        slotId: created.id,
        weekday: data.weekday,
        members: participants(data.memberId),
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, timetableId);
  }

  async updateSlot(ctx: SchoolContext, timetableId: string, slotId: string, dto: SlotDto) {
    await this.find(ctx, timetableId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, timetableId);
      if (tt.status === 'ARCHIVED') throw this.archived();
      const before = await this.findSlot(tx, ctx, timetableId, slotId);
      const data = await this.validateSlot(tx, ctx, tt, dto);
      await this.assertNoConflict(tx, ctx, tt, [
        planningSlot({ ...data, id: slotId, timetableId }, tt),
      ]);
      await tx.schoolTimetableSlot.update({ where: { id: slotId }, data });
      if (before.weekday !== data.weekday) {
        await tx.schoolLessonException.deleteMany({
          where: { organizationId: ctx.organizationId, slotId },
        });
      }
      // Ancien et nouvel enseignant : le retrait d'un cours reste dans le fil de celui qui le perd.
      await this.changed(tx, ctx, tt, 'slot_changed', {
        slotId,
        weekday: data.weekday,
        members: participants(before.memberId, data.memberId),
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, timetableId);
  }

  async removeSlot(ctx: SchoolContext, timetableId: string, slotId: string) {
    await this.find(ctx, timetableId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, timetableId);
      if (tt.status === 'ARCHIVED') throw this.archived();
      const slot = await this.findSlot(tx, ctx, timetableId, slotId);
      await tx.schoolTimetableSlot.delete({ where: { id: slotId } });
      await this.changed(tx, ctx, tt, 'slot_removed', {
        slotId,
        weekday: slot.weekday,
        members: participants(slot.memberId),
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, timetableId);
  }

  /** Vérification sans publier : conflits de toute la version avec le planning publié. */
  async check(ctx: SchoolContext, id: string) {
    const tt = await this.find(ctx, id);
    const conflicts = await this.db.$transaction((tx) => this.versionConflicts(tx, ctx, tt));
    return { conflicts: conflicts.map((c) => ({ ...c, message: CONFLICT_MESSAGES[c.code] })) };
  }

  /**
   * Publication contrôlée : année ouverte, au moins un créneau, aucun conflit ni affectation terminée,
   * revérifiés sous verrou. Les versions publiées de la classe qui la recouvrent sont raccourcies (ou
   * archivées si elles commencent après elle) ; une version qui la dépasserait à la fin est refusée.
   */
  async publish(ctx: SchoolContext, id: string) {
    const found = await this.find(ctx, id);
    // Classe lue avant la transaction : la classe d'une version ne change jamais.
    const scope = await this.assessment.findClass(ctx, found.classId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, id);
      if (tt.status !== 'DRAFT') throw this.notDraft();
      await this.assertValidity(tx, scope, day(tt.validFrom), day(tt.validTo));
      const count = await tx.schoolTimetableSlot.count({ where: { timetableId: id } });
      if (count === 0) {
        throw new ConflictException({
          code: 'TIMETABLE_EMPTY',
          message: 'Un emploi du temps sans créneau ne peut pas être publié.',
        });
      }
      const conflicts = await this.versionConflicts(tx, ctx, tt);
      if (conflicts.length > 0) throw this.conflict(conflicts);
      const previous = await tx.schoolTimetable.findMany({
        where: {
          organizationId: ctx.organizationId,
          classId: tt.classId,
          status: 'PUBLISHED',
          validFrom: { lte: tt.validTo },
          validTo: { gte: tt.validFrom },
        },
        select: { id: true, validFrom: true, validTo: true },
      });
      const from = day(tt.validFrom);
      const to = day(tt.validTo);
      for (const p of previous) {
        if (day(p.validTo) > to) {
          throw new ConflictException({
            code: 'TIMETABLE_VALIDITY_OVERLAP',
            message:
              'Une version publiée de la classe se poursuit après celle-ci : ajustez les dates de validité.',
          });
        }
        if (day(p.validFrom) >= from) {
          await tx.schoolTimetable.update({
            where: { id: p.id },
            data: { status: 'ARCHIVED', archivedAt: new Date() },
          });
          await this.event(tx, ctx, p.id, 'archived', { replacedBy: id });
        } else {
          await tx.schoolTimetable.update({
            where: { id: p.id },
            data: { validTo: toDate(addDays(from, -1)) },
          });
          await this.event(tx, ctx, p.id, 'shortened', {
            replacedBy: id,
            validTo: addDays(from, -1),
          });
        }
      }
      await tx.schoolTimetable.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: ctx.userId },
      });
      const eventId = await this.event(tx, ctx, id, 'published', { slots: count });
      await this.notifyClass(tx, ctx, tt, 'TIMETABLE', eventId, {
        change: 'published',
        class: scope.name,
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.timetable_published',
        'SchoolTimetable',
        id,
        {
          classId: tt.classId,
          validFrom: from,
          validTo: to,
          replaced: previous.length,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  /** Archivage d'une version publiée : elle cesse de s'appliquer, l'historique reste. */
  async archive(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, id);
      if (tt.status !== 'PUBLISHED') {
        throw new ConflictException({
          code: 'TIMETABLE_NOT_PUBLISHED',
          message: 'Seule une version publiée peut être archivée.',
        });
      }
      await tx.schoolTimetable.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      await this.event(tx, ctx, id, 'archived', {});
      await this.school.recordDecision(
        tx,
        ctx,
        'school.timetable_archived',
        'SchoolTimetable',
        id,
        {
          classId: tt.classId,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  // ─── Annulation d'un cours à une date ───

  async cancelLesson(ctx: SchoolContext, slotId: string, dto: LessonCancellationDto) {
    const found = await this.findPublishedSlot(ctx, slotId);
    const id = await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const tt = await this.lockTimetable(tx, found.timetableId);
      if (tt.status !== 'PUBLISHED') throw new NotFoundException(NOT_FOUND);
      // Créneau relu sous le verrou : jour, horaire et groupe à jour (une modification a pu passer).
      const slot = await this.findSlot(tx, ctx, tt.id, slotId);
      if (
        slot.kind !== 'LESSON' ||
        isoWeekday(dto.date) !== slot.weekday ||
        dto.date < day(tt.validFrom) ||
        dto.date > day(tt.validTo)
      ) {
        throw new BadRequestException({
          code: 'LESSON_NOT_ON_DATE',
          message: 'Ce cours n’a pas lieu à cette date.',
        });
      }
      let exception;
      try {
        exception = await tx.schoolLessonException.create({
          data: {
            organizationId: ctx.organizationId,
            slotId,
            date: toDate(dto.date),
            reason: dto.reason,
            createdByUserId: ctx.userId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException({
            code: 'LESSON_ALREADY_CANCELLED',
            message: 'Ce cours est déjà annulé à cette date.',
          });
        }
        throw error;
      }
      const eventId = await this.event(tx, ctx, tt.id, 'lesson_cancelled', {
        slotId,
        date: dto.date,
        reason: dto.reason,
        members: participants(slot.memberId),
      });
      await this.notifyClass(
        tx,
        ctx,
        tt,
        'LESSON_CANCELLED',
        eventId,
        {
          date: dto.date,
          start: minutesToTime(slot.startMinute),
          subject: slot.subject?.name ?? '',
        },
        slot.groupId,
      );
      await this.school.recordDecision(
        tx,
        ctx,
        'school.lesson_cancelled',
        'SchoolTimetable',
        tt.id,
        {
          slotId,
          date: dto.date,
        },
      );
      return exception.id;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { id };
  }

  async restoreLesson(ctx: SchoolContext, slotId: string, date: string) {
    const found = await this.findPublishedSlot(ctx, slotId);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      // Version et créneau relus sous le verrou : une version archivée entre-temps ne rétablit rien.
      const tt = await this.lockTimetable(tx, found.timetableId);
      if (tt.status !== 'PUBLISHED') throw new NotFoundException(NOT_FOUND);
      const slot = await this.findSlot(tx, ctx, tt.id, slotId);
      // Le cours doit encore avoir lieu ce jour-là (créneau déplacé ou version raccourcie : rien à rétablir).
      if (
        slot.kind !== 'LESSON' ||
        isoWeekday(date) !== slot.weekday ||
        date < day(tt.validFrom) ||
        date > day(tt.validTo)
      ) {
        throw new BadRequestException({
          code: 'LESSON_NOT_ON_DATE',
          message: 'Ce cours n’a pas lieu à cette date.',
        });
      }
      const { count } = await tx.schoolLessonException.deleteMany({
        where: { organizationId: ctx.organizationId, slotId, date: toDate(date) },
      });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      // Pas d'annonce de reprise si une fermeture suspend toujours le cours ce jour-là : le fait est
      // alors un simple retrait d'annulation, absent du fil des enseignants.
      const closures = await this.calendar.closures(
        tx,
        ctx.organizationId,
        [tt.schoolId],
        date,
        date,
      );
      const suspended = closures.some((c) =>
        closureApplies(c, {
          schoolId: tt.schoolId,
          classId: tt.classId,
          groupIds: slot.groupId ? [slot.groupId] : [],
        }),
      );
      const eventId = await this.event(
        tx,
        ctx,
        tt.id,
        suspended ? 'lesson_exception_removed' : 'lesson_restored',
        { slotId, date, members: participants(slot.memberId) },
      );
      if (!suspended)
        await this.notifyClass(
          tx,
          ctx,
          tt,
          'LESSON_CANCELLED',
          eventId,
          {
            change: 'restored',
            date,
            start: minutesToTime(slot.startMinute),
            subject: slot.subject?.name ?? '',
          },
          slot.groupId,
        );
    });
    return { restored: true };
  }

  // ─── Indisponibilités des enseignants ───

  async unavailability(ctx: SchoolContext, q: UnavailabilityQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const rows = await this.db.schoolTeacherUnavailability.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        ...(q.memberId ? { memberId: q.memberId } : {}),
      },
      orderBy: [{ memberId: 'asc' }, { weekday: 'asc' }, { startMinute: 'asc' }],
      select: {
        id: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        reason: true,
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            firstNameAr: true,
            lastNameAr: true,
          },
        },
      },
    });
    return rows.map(({ startMinute, endMinute, ...r }) => ({
      ...r,
      start: minutesToTime(startMinute),
      end: minutesToTime(endMinute),
    }));
  }

  /** Nouvelle indisponibilité : refusée si elle recouvre un cours publié, en cours ou à venir. */
  async addUnavailability(ctx: SchoolContext, dto: UnavailabilityDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const start = timeToMinutes(dto.start);
    const end = endMinutes(dto.end);
    if (end <= start) throw this.invalidTime();
    const id = await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const member = await tx.schoolMember.findFirst({
        where: {
          id: dto.memberId,
          organizationId: ctx.organizationId,
          isActive: true,
          OR: [{ role: 'GROUP_DIRECTOR' }, { assignments: { some: { schoolId: dto.schoolId } } }],
        },
        select: { id: true },
      });
      if (!member) throw new NotFoundException(NOT_FOUND);
      const today = new Date().toISOString().slice(0, 10);
      const all = await tx.schoolTimetableSlot.findMany({
        where: {
          organizationId: ctx.organizationId,
          memberId: dto.memberId,
          weekday: dto.weekday,
          startMinute: { lt: end },
          endMinute: { gt: start },
          timetable: { status: 'PUBLISHED', validTo: { gte: toDate(today) } },
        },
        select: {
          id: true,
          startMinute: true,
          endMinute: true,
          timetable: { select: { classId: true, validFrom: true, validTo: true } },
        },
      });
      // Cours qui ont encore une occurrence ce jour-là, d'aujourd'hui à la fin de leur validité.
      const upcoming = all.filter((l) => {
        const from = day(l.timetable.validFrom) > today ? day(l.timetable.validFrom) : today;
        return weekdayOccurs(dto.weekday, from, day(l.timetable.validTo));
      });
      const lessons = upcoming;
      if (lessons.length > 0) {
        // Cours d'un autre établissement que ceux de la requête : ni créneau ni classe restitués.
        const details = await this.withClassNames(
          tx,
          ctx,
          lessons.map((l) => ({
            code: 'UNAVAILABILITY_CONFLICT' as PlanningConflict['code'],
            slotId: l.id,
            classId: l.timetable.classId,
            weekday: dto.weekday,
            start: l.startMinute,
            end: l.endMinute,
            requested: { start, end },
          })),
        );
        throw new ConflictException({
          code: 'UNAVAILABILITY_CONFLICT',
          message: 'L’enseignant a déjà des cours publiés sur cette plage.',
          details: details.map(({ class: cls, ...d }) => ({
            ...d,
            classId: cls?.id ?? null,
            class: cls,
          })),
        });
      }
      const created = await tx.schoolTeacherUnavailability.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: dto.schoolId,
          memberId: dto.memberId,
          weekday: dto.weekday,
          startMinute: start,
          endMinute: end,
          reason: dto.reason ?? null,
          createdByUserId: ctx.userId,
        },
      });
      return created.id;
    });
    await this.school.log(
      ctx,
      'school.teacher_unavailability_added',
      'SchoolMember',
      dto.memberId,
      {
        unavailabilityId: id,
      },
    );
    return { id };
  }

  async removeUnavailability(ctx: SchoolContext, id: string) {
    const found = await this.db.schoolTeacherUnavailability.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { schoolId: true, memberId: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    await this.db.schoolTeacherUnavailability.delete({ where: { id } });
    await this.school.log(
      ctx,
      'school.teacher_unavailability_removed',
      'SchoolMember',
      found.memberId,
      {
        unavailabilityId: id,
      },
    );
    return { deleted: true };
  }

  // ─── Vues de semaine ───

  /** Semaine publiée d'une classe : cours, pauses, annulations, fermetures, examens. */
  async classWeek(ctx: SchoolContext, classId: string, date: string) {
    const scope = await this.classInScope(ctx, classId);
    return {
      class: { id: scope.id, name: scope.name, nameAr: scope.nameAr },
      ...(await this.week(
        {
          organizationId: ctx.organizationId,
          schoolIds: [scope.schoolId],
          schoolId: scope.schoolId,
          classId: scope.id,
        },
        date,
      )),
    };
  }

  /**
   * Planning personnel d'un enseignant (soi-même pour un enseignant) : cours de ses classes, examens qu'il
   * surveille, fil des changements publiés des 30 derniers jours. Un enseignant ne voit que les classes
   * qui lui sont encore confiées, même si d'anciens créneaux le citent.
   */
  async teacherWeek(ctx: SchoolContext, memberId: string | undefined, date: string) {
    const target = memberId ?? ctx.memberId;
    if (!target) throw new NotFoundException(NOT_FOUND);
    if (isLimitedToOwnClasses(ctx.role) && target !== ctx.memberId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    // Hors du périmètre d'établissements de l'utilisateur : introuvable, sans révéler son identité.
    const member = await this.db.schoolMember.findFirst({
      where: {
        id: target,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { assignments: { some: { schoolId: { in: ctx.schoolIds } } } } : {}),
      },
      select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true },
    });
    if (!member) throw new NotFoundException(NOT_FOUND);
    const own = await this.school.ownClasses(ctx);
    const since = new Date(Date.now() - CHANGES_DAYS * 86_400_000);
    const changes = await this.db.schoolTimetableEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        createdAt: { gte: since },
        action: { in: [...CHANGE_ACTIONS] },
        AND: [
          // Faits qui le citent (avant ou après la modification), ou versions où il enseigne encore.
          {
            OR: [
              { details: { path: ['members'], array_contains: [target] } },
              { timetable: { slots: { some: { memberId: target } } } },
            ],
          },
          // Changements réellement publiés : un créneau préparé en brouillon n'en est pas un.
          {
            OR: [
              { action: { in: ['published', 'lesson_cancelled', 'lesson_restored'] } },
              { details: { path: ['published'], equals: 'true' } },
            ],
          },
        ],
        timetable: {
          status: { not: 'DRAFT' },
          ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
          ...(own ? { classId: { in: own } } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        timetable: { select: { class: { select: { id: true, name: true, nameAr: true } } } },
      },
    });
    return {
      member,
      ...(await this.week(
        {
          organizationId: ctx.organizationId,
          schoolIds: ctx.schoolIds,
          memberId: target,
          classIds: own,
          selfMemberId: ctx.memberId,
        },
        date,
      )),
      changes: changes.map(({ timetable, ...c }) => ({ ...c, class: timetable.class })),
    };
  }

  /** Occupation d'une salle sur une semaine ; l'enseignant n'y voit que ses classes et ses surveillances. */
  async roomWeek(ctx: SchoolContext, roomId: string, date: string) {
    const room = await this.db.schoolRoom.findFirst({
      where: { id: roomId, organizationId: ctx.organizationId },
      select: {
        id: true,
        schoolId: true,
        name: true,
        nameAr: true,
        capacity: true,
        isActive: true,
      },
    });
    if (!room) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, room.schoolId);
    const own = await this.school.ownClasses(ctx);
    const { schoolId: _schoolId, ...rest } = room;
    return {
      room: rest,
      ...(await this.week(
        {
          organizationId: ctx.organizationId,
          schoolIds: [room.schoolId],
          roomId,
          classIds: own,
          selfMemberId: ctx.memberId,
        },
        date,
      )),
    };
  }

  /** Semaine d'un enfant pour son parent : sa classe, ses groupes, examens publiés seulement. */
  async childWeek(
    child: { organizationId: string; schoolId: string; classId: string; groupIds: string[] },
    date: string,
  ) {
    return this.week(
      {
        organizationId: child.organizationId,
        schoolIds: [child.schoolId],
        schoolId: child.schoolId,
        classId: child.classId,
        groupIds: child.groupIds,
        families: true,
      },
      date,
    );
  }

  // ─── Outils ───

  /**
   * Semaine du lundi au dimanche : pour chaque jour, la version publiée valable ce jour-là, ses créneaux,
   * les cours annulés, les fermetures de l'établissement applicables au cours (classe ou groupe) et les
   * examens publiés.
   */
  private async week(filter: WeekFilter, date: string) {
    const monday = weekStart(date);
    const sunday = addDays(monday, 6);
    const slots = await this.db.schoolTimetableSlot.findMany({
      where: {
        organizationId: filter.organizationId,
        ...(filter.memberId ? { memberId: filter.memberId } : {}),
        ...(filter.roomId ? { roomId: filter.roomId } : {}),
        ...(filter.groupIds
          ? { OR: [{ groupId: null }, { groupId: { in: filter.groupIds } }] }
          : {}),
        timetable: {
          status: 'PUBLISHED',
          validFrom: { lte: toDate(sunday) },
          validTo: { gte: toDate(monday) },
          ...(filter.classId ? { classId: filter.classId } : {}),
          ...(filter.classIds ? { classId: { in: filter.classIds } } : {}),
          ...(filter.schoolIds ? { schoolId: { in: filter.schoolIds } } : {}),
        },
      },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
      select: {
        ...SLOT_SELECT,
        timetable: {
          select: {
            schoolId: true,
            classId: true,
            validFrom: true,
            validTo: true,
            class: { select: { id: true, name: true, nameAr: true } },
          },
        },
        exceptions: {
          where: { date: { gte: toDate(monday), lte: toDate(sunday) } },
          select: { date: true, reason: true },
        },
      },
    });
    const schoolIds = filter.schoolId
      ? [filter.schoolId]
      : (filter.schoolIds ?? [...new Set(slots.map((s) => s.timetable.schoolId))]);
    const examScope: Prisma.SchoolExamScheduleWhereInput[] =
      filter.classIds && !filter.memberId
        ? [
            { evaluation: { classId: { in: filter.classIds } } },
            ...(filter.selfMemberId ? [{ supervisorMemberId: filter.selfMemberId }] : []),
          ]
        : [];
    const [closures, groups, exams] = await Promise.all([
      this.calendar.closures(this.db, filter.organizationId, schoolIds, monday, sunday),
      this.groupNames(slots.map((s) => s.groupId)),
      this.exams.publishedFor(this.db, filter.organizationId, {
        date: { gte: toDate(monday), lte: toDate(sunday) },
        ...(filter.schoolIds ? { schoolId: { in: filter.schoolIds } } : {}),
        ...(filter.roomId ? { roomId: filter.roomId } : {}),
        ...(filter.memberId ? { supervisorMemberId: filter.memberId } : {}),
        ...(examScope.length ? { OR: examScope } : {}),
        ...(filter.classId
          ? {
              evaluation: {
                classId: filter.classId,
                ...(filter.groupIds
                  ? { OR: [{ groupId: null }, { groupId: { in: filter.groupIds } }] }
                  : {}),
              },
            }
          : {}),
      }),
    ]);
    const view = (c: Closure) => closureView(c, filter.families === true);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => {
      const weekday = isoWeekday(d);
      const dayClosures = closures.filter((c) => c.startsOn <= d && c.endsOn >= d);
      const lessons = slots
        .filter(
          (s) =>
            s.weekday === weekday &&
            day(s.timetable.validFrom) <= d &&
            day(s.timetable.validTo) >= d,
        )
        .map((s) => {
          const closure = dayClosures.find((c) =>
            closureApplies(c, {
              schoolId: s.timetable.schoolId,
              classId: s.timetable.classId,
              groupIds: s.groupId ? [s.groupId] : [],
            }),
          );
          const cancelled = s.exceptions.find((e) => day(e.date) === d);
          return {
            ...slotView(s, groups),
            class: s.timetable.class,
            closed: closure ? view(closure) : null,
            cancelled: cancelled ? { reason: cancelled.reason } : null,
          };
        });
      const lessonClasses = new Set(lessons.map((l) => l.class.id));
      const shown = dayClosures.filter((c) => {
        if (filter.classId) {
          // Enfant : ce qui le concerne (établissement, sa classe, l'un de ses groupes) ; personnel :
          // tout ce qui touche la classe, y compris la fermeture d'un de ses groupes.
          return filter.groupIds
            ? closureApplies(c, {
                schoolId: filter.schoolId ?? c.schoolId,
                classId: filter.classId,
                groupIds: filter.groupIds,
              })
            : c.audience === 'SCHOOL' || c.relatedClassIds.includes(filter.classId);
        }
        return c.audience === 'SCHOOL' || c.relatedClassIds.some((id) => lessonClasses.has(id));
      });
      return {
        date: d,
        weekday,
        closures: shown.map(view),
        lessons,
        exams: exams.filter((e) => e.date === d),
      };
    });
    return { weekStart: monday, days };
  }

  /** Conflits de toute une version (publication, vérification) : créneaux, affectations terminées. */
  private async versionConflicts(tx: Tx, ctx: SchoolContext, tt: TimetableRow) {
    const slots = await tx.schoolTimetableSlot.findMany({
      where: { organizationId: ctx.organizationId, timetableId: tt.id },
      select: SLOT_SELECT,
    });
    // Établissement gardé avant toute ressource ou affectation : la clôture d'année (garde exclusive,
    // puis fin des affectations) se sérialise avec cette vérification ; l'année est relue sous la garde.
    await this.guardOpenYear(tx, tt);
    const candidates = slots.map((s) => planningSlot(s, tt));
    const conflicts = await this.conflicts(tx, ctx, tt, candidates);
    const active = await this.activeResources(tx, ctx.organizationId, tt, slots);
    await this.lockMembers(
      tx,
      slots.map((s) => s.memberId).filter((x): x is string => !!x),
    );
    for (const s of slots) {
      if (s.kind !== 'LESSON') continue;
      const inactive =
        (s.subjectId && !active.subjects.has(s.subjectId) && 'SLOT_SUBJECT_INACTIVE') ||
        (s.groupId && !active.groups.has(s.groupId) && 'SLOT_GROUP_INACTIVE') ||
        (s.roomId && !active.rooms.has(s.roomId) && 'SLOT_ROOM_INACTIVE');
      if (inactive) {
        conflicts.push({
          code: inactive as PlanningConflict['code'],
          slotId: s.id,
          classId: tt.classId,
          weekday: s.weekday,
          start: s.startMinute,
          end: s.endMinute,
        });
        continue;
      }
      const assigned = await this.isAssigned(tx, ctx.organizationId, tt.classId, s);
      if (!assigned) {
        conflicts.push({
          code: 'SLOT_TEACHER_NOT_ASSIGNED' as PlanningConflict['code'],
          slotId: s.id,
          classId: tt.classId,
          weekday: s.weekday,
          start: s.startMinute,
          end: s.endMinute,
        });
      }
    }
    return this.withClassNames(tx, ctx, conflicts);
  }

  /**
   * Matières, groupes et salles des cours encore actifs (et de la classe ou de l'établissement), lus en
   * partage jusqu'au commit : une désactivation concurrente attend la publication, ou la précède et se voit.
   */
  private async activeResources(
    tx: Tx,
    organizationId: string,
    tt: TimetableRow,
    slots: { subjectId: string | null; groupId: string | null; roomId: string | null }[],
  ) {
    const ids = (pick: (s: (typeof slots)[number]) => string | null) => [
      ...new Set(slots.map(pick).filter((x): x is string => !!x)),
    ];
    const subjects = ids((s) => s.subjectId);
    const groups = ids((s) => s.groupId);
    const rooms = ids((s) => s.roomId);
    const read = async (query: Prisma.Sql | null) =>
      query
        ? new Set((await tx.$queryRaw<{ id: string }[]>(query)).map((r) => r.id))
        : new Set<string>();
    return {
      subjects: await read(
        subjects.length
          ? Prisma.sql`SELECT id FROM "Subject" WHERE id = ANY(${subjects}::uuid[])
              AND "organizationId" = ${organizationId}::uuid AND "schoolId" = ${tt.schoolId}::uuid
              AND "isActive" FOR SHARE`
          : null,
      ),
      groups: await read(
        groups.length
          ? Prisma.sql`SELECT id FROM "SchoolClassGroup" WHERE id = ANY(${groups}::uuid[])
              AND "organizationId" = ${organizationId}::uuid AND "classId" = ${tt.classId}::uuid
              AND "isActive" FOR SHARE`
          : null,
      ),
      rooms: await read(
        rooms.length
          ? Prisma.sql`SELECT id FROM "SchoolRoom" WHERE id = ANY(${rooms}::uuid[])
              AND "organizationId" = ${organizationId}::uuid AND "schoolId" = ${tt.schoolId}::uuid
              AND "isActive" FOR SHARE`
          : null,
      ),
    };
  }

  private async assertNoConflict(
    tx: Tx,
    ctx: SchoolContext,
    tt: TimetableRow,
    candidates: PlanningSlot[],
  ) {
    const conflicts = await this.conflicts(tx, ctx, tt, candidates);
    if (conflicts.length > 0) throw this.conflict(await this.withClassNames(tx, ctx, conflicts));
  }

  /**
   * Conflits des candidats avec : les créneaux de la même version, les cours des versions publiées de
   * l'organisation qui recouvrent sa validité (même enseignant, ou même salle), les indisponibilités des
   * enseignants. Les autres versions de la même classe sont ignorées (la publication les remplace).
   */
  private async conflicts(
    tx: Tx,
    ctx: SchoolContext,
    tt: TimetableRow,
    candidates: PlanningSlot[],
  ) {
    if (candidates.length === 0) return [];
    const members = [...new Set(candidates.map((c) => c.memberId).filter((x): x is string => !!x))];
    const rooms = [...new Set(candidates.map((c) => c.roomId).filter((x): x is string => !!x))];
    const resources: Prisma.SchoolTimetableSlotWhereInput[] = [
      ...(members.length ? [{ memberId: { in: members } }] : []),
      ...(rooms.length ? [{ roomId: { in: rooms } }] : []),
    ];
    const others = await tx.schoolTimetableSlot.findMany({
      where: {
        organizationId: ctx.organizationId,
        weekday: { in: [...new Set(candidates.map((c) => c.weekday))] },
        OR: [
          { timetableId: tt.id },
          ...(resources.length
            ? [
                {
                  kind: 'LESSON' as const,
                  OR: resources,
                  timetable: {
                    status: 'PUBLISHED' as const,
                    id: { not: tt.id },
                    validFrom: { lte: tt.validTo },
                    validTo: { gte: tt.validFrom },
                  },
                },
              ]
            : []),
        ],
      },
      select: { ...SLOT_SELECT, timetable: { select: TIMETABLE_SELECT } },
    });
    const existing = others.map((s) => planningSlot(s, s.timetable));
    const unavailable = members.length
      ? (
          await tx.schoolTeacherUnavailability.findMany({
            where: { organizationId: ctx.organizationId, memberId: { in: members } },
            select: { memberId: true, weekday: true, startMinute: true, endMinute: true },
          })
        ).map((u) => ({
          memberId: u.memberId,
          weekday: u.weekday,
          start: u.startMinute,
          end: u.endMinute,
        }))
      : [];
    const seen = new Set<string>();
    const result: RestitutedConflict[] = [];
    for (const candidate of candidates) {
      for (const c of slotConflicts(candidate, existing, unavailable)) {
        // Une paire de créneaux de la même version n'est signalée qu'une fois.
        const key = [
          c.code,
          ...[candidate.id ?? 'new', c.slotId ?? `${c.weekday}:${c.start}`].sort(),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...c, requested: { start: candidate.start, end: candidate.end } });
      }
    }
    return result;
  }

  /** Données d'un créneau, contrôlées : heures, cours complet, matière, groupe, salle, affectation. */
  private async validateSlot(tx: Tx, ctx: SchoolContext, tt: TimetableRow, dto: SlotDto) {
    const startMinute = timeToMinutes(dto.start);
    const endMinute = endMinutes(dto.end);
    if (endMinute <= startMinute) throw this.invalidTime();
    // Pauses comprises : aucun créneau saisi dans une année clôturée.
    await this.guardOpenYear(tx, tt);
    if (dto.kind === 'BREAK') {
      if (dto.subjectId || dto.memberId || dto.groupId || dto.roomId) {
        throw new BadRequestException({
          code: 'SLOT_BREAK_RESOURCES',
          message: 'Une pause n’a ni matière, ni enseignant, ni groupe, ni salle.',
        });
      }
      return {
        weekday: dto.weekday,
        startMinute,
        endMinute,
        kind: 'BREAK' as const,
        subjectId: null,
        memberId: null,
        groupId: null,
        roomId: null,
        label: dto.label ?? null,
        labelAr: dto.labelAr ?? null,
      };
    }
    if (!dto.subjectId || !dto.memberId) {
      throw new BadRequestException({
        code: 'SLOT_LESSON_INCOMPLETE',
        message: 'Un cours exige une matière et un enseignant.',
      });
    }
    const subject = await tx.subject.findFirst({
      where: {
        id: dto.subjectId,
        organizationId: ctx.organizationId,
        schoolId: tt.schoolId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!subject) {
      throw new BadRequestException({
        code: 'INVALID_SUBJECT',
        message: 'Matière invalide pour cet établissement.',
      });
    }
    const groupId = dto.groupId ?? null;
    if (groupId) {
      const group = await tx.schoolClassGroup.findFirst({
        where: {
          id: groupId,
          organizationId: ctx.organizationId,
          classId: tt.classId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!group)
        throw new BadRequestException({
          code: 'INVALID_GROUP',
          message: 'Groupe invalide pour cette classe.',
        });
    }
    const roomId = dto.roomId ?? null;
    if (roomId) {
      const room = await tx.schoolRoom.findFirst({
        where: {
          id: roomId,
          organizationId: ctx.organizationId,
          schoolId: tt.schoolId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!room)
        throw new BadRequestException({ code: 'INVALID_ROOM', message: 'Salle invalide.' });
    }
    const slot = { subjectId: dto.subjectId, memberId: dto.memberId, groupId };
    await this.lockMembers(tx, [dto.memberId]);
    if (!(await this.isAssigned(tx, ctx.organizationId, tt.classId, slot))) {
      throw new ConflictException({
        code: 'SLOT_TEACHER_NOT_ASSIGNED',
        message: CONFLICT_MESSAGES.SLOT_TEACHER_NOT_ASSIGNED,
      });
    }
    return {
      weekday: dto.weekday,
      startMinute,
      endMinute,
      kind: 'LESSON' as const,
      subjectId: dto.subjectId,
      memberId: dto.memberId,
      groupId,
      roomId,
      label: null,
      labelAr: null,
    };
  }

  /**
   * Affectation active de l'enseignant pour la matière dans la classe (Sprint 3B) ; pour un créneau de
   * groupe, l'affectation du groupe ou celle de toute la classe.
   */
  /**
   * Enseignants verrouillés (partage des clés, ordre trié) avant leurs affectations : la désactivation d'un
   * membre, qui le verrouille puis termine ses affectations, attend cette écriture ou la précède. Sans ce
   * verrou, l'insertion du créneau (clé vers le membre) et la fin d'affectation s'attendraient mutuellement.
   */
  /** Garde partagée de l'établissement (celle que la clôture prend en exclusif), puis année relue ouverte. */
  private async guardOpenYear(tx: Tx, tt: TimetableRow) {
    await this.school.guardSchools(tx, [tt.schoolId]);
    const year = await tx.schoolYear.findUniqueOrThrow({
      where: { id: tt.schoolYearId },
      select: { status: true },
    });
    if (year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
  }

  private async lockMembers(tx: Tx, memberIds: string[]) {
    const ids = [...new Set(memberIds)].sort();
    if (ids.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM "SchoolMember" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR KEY SHARE`;
  }

  private async isAssigned(
    tx: Tx,
    organizationId: string,
    classId: string,
    slot: { subjectId: string | null; memberId: string | null; groupId: string | null },
  ) {
    if (!slot.subjectId || !slot.memberId) return false;
    // Cours de groupe : l'affectation du groupe ou de toute la classe ; cours de toute la classe :
    // l'affectation de toute la classe seulement. Verrou partagé jusqu'au commit : la fin d'une
    // affectation attend cette écriture, ou l'a précédée et se voit.
    const group = slot.groupId
      ? Prisma.sql`("groupId" = ${slot.groupId}::uuid OR "groupId" IS NULL)`
      : Prisma.sql`"groupId" IS NULL`;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SchoolTeachingAssignment"
      WHERE "organizationId" = ${organizationId}::uuid AND "classId" = ${classId}::uuid
        AND "subjectId" = ${slot.subjectId}::uuid AND "memberId" = ${slot.memberId}::uuid
        AND "endedAt" IS NULL AND ${group}
      FOR SHARE`;
    return rows.length > 0;
  }

  private async assertValidity(tx: Tx, scope: ClassScope, validFrom: string, validTo: string) {
    if (validTo < validFrom) {
      throw new BadRequestException({
        code: 'INVALID_VALIDITY',
        message: 'La fin de validité précède son début.',
      });
    }
    const year = await tx.schoolYear.findUniqueOrThrow({
      where: { id: scope.schoolYearId },
      select: { startsOn: true, endsOn: true, status: true },
    });
    if (year.status === 'CLOSED') {
      throw new ConflictException({
        code: 'SCHOOL_YEAR_CLOSED',
        message: 'Cette année scolaire est clôturée.',
      });
    }
    if (validFrom < day(year.startsOn) || validTo > day(year.endsOn)) {
      throw new BadRequestException({
        code: 'VALIDITY_OUT_OF_YEAR',
        message: 'La validité doit rester dans l’année scolaire de la classe.',
      });
    }
  }

  /** Version publiée modifiée : historique, familles notifiées ; un brouillon : historique seul. */
  private async changed(
    tx: Tx,
    ctx: SchoolContext,
    tt: TimetableRow,
    action: string,
    details: Record<string, string | number | null | string[]>,
  ) {
    const eventId = await this.event(tx, ctx, tt.id, action, {
      ...details,
      published: tt.status === 'PUBLISHED' ? 'true' : 'false',
    });
    if (tt.status !== 'PUBLISHED') return;
    const cls = await tx.schoolClass.findUniqueOrThrow({
      where: { id: tt.classId },
      select: { name: true },
    });
    await this.notifyClass(tx, ctx, tt, 'TIMETABLE', eventId, {
      change: 'changed',
      class: cls.name,
    });
    await this.school.recordDecision(
      tx,
      ctx,
      'school.timetable_changed',
      'SchoolTimetable',
      tt.id,
      {
        action,
        ...details,
      },
    );
  }

  /** Familles des élèves de la classe (d'un groupe, pour un cours de groupe) : une notification par fait. */
  private async notifyClass(
    tx: Tx,
    ctx: SchoolContext,
    tt: TimetableRow,
    kind: 'TIMETABLE' | 'LESSON_CANCELLED',
    eventId: string,
    params: Record<string, string>,
    groupId: string | null = null,
  ) {
    if (groupId) {
      const group = await tx.schoolClassGroup.findUnique({
        where: { id: groupId },
        select: { isActive: true },
      });
      // Le portail n'affiche pas les cours d'un groupe désactivé : il n'y a rien à annoncer.
      if (!group?.isActive) return;
    }
    await this.notifications.notifyStudents(tx, {
      organizationId: ctx.organizationId,
      schoolId: tt.schoolId,
      kind,
      resourceId: tt.id,
      studentIds: await this.notifications.portalStudents(
        tx,
        ctx.organizationId,
        tt.classId,
        groupId,
      ),
      params,
      dedupe: (studentId) => `timetable:${eventId}:${studentId}`,
    });
  }

  private async event(
    tx: Tx,
    ctx: SchoolContext,
    timetableId: string,
    action: string,
    details: Record<string, string | number | null | string[]>,
  ) {
    const created = await tx.schoolTimetableEvent.create({
      data: {
        organizationId: ctx.organizationId,
        timetableId,
        action,
        details,
        actorUserId: ctx.userId,
      },
    });
    return created.id;
  }

  /**
   * Noms des classes en conflit, lus dans la transaction de l'appelant. La détection reste globale (un
   * enseignant ne peut pas être réservé deux fois), mais un conflit avec une classe d'un établissement
   * hors du périmètre de la requête ne révèle ni la classe, ni le créneau, ni ses horaires : seuls le
   * motif, le jour et la plage DEMANDÉE sont restitués.
   */
  private async withClassNames(db: Tx, ctx: SchoolContext, conflicts: RestitutedConflict[]) {
    const ids = [...new Set(conflicts.map((c) => c.classId).filter((x): x is string => !!x))];
    const classes = ids.length
      ? await db.schoolClass.findMany({
          where: { id: { in: ids }, organizationId: ctx.organizationId },
          select: { id: true, name: true, nameAr: true, year: { select: { schoolId: true } } },
        })
      : [];
    const visible = new Map(
      classes
        .filter((c) => !ctx.schoolIds || ctx.schoolIds.includes(c.year.schoolId))
        .map((c) => [c.id, { id: c.id, name: c.name, nameAr: c.nameAr }]),
    );
    return conflicts.map((c) => {
      const cls = c.classId ? visible.get(c.classId) : undefined;
      // Indisponibilité : sans classe ni établissement restitués, seule la plage demandée est rendue.
      const hidden = (!!c.classId && !cls) || c.code === 'SLOT_TEACHER_UNAVAILABLE';
      return {
        code: c.code,
        slotId: hidden ? null : (c.slotId ?? null),
        class: cls ?? null,
        weekday: c.weekday,
        start: hidden
          ? c.requested
            ? minutesToTime(c.requested.start)
            : null
          : minutesToTime(c.start),
        end: hidden ? (c.requested ? minutesToTime(c.requested.end) : null) : minutesToTime(c.end),
      };
    });
  }

  private conflict(conflicts: { code: string }[]) {
    const code = conflicts[0]!.code;
    return new ConflictException({ code, message: CONFLICT_MESSAGES[code], details: conflicts });
  }

  private async groupNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0)
      return new Map<string, { id: string; name: string; nameAr: string | null }>();
    const rows = await this.db.schoolClassGroup.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, nameAr: true },
    });
    return new Map(rows.map((g) => [g.id, g]));
  }

  private manages(ctx: SchoolContext) {
    return hasSchoolPermission(ctx.role, SchoolPermission.PLANNING_MANAGE);
  }

  /** Classe du périmètre ; l'enseignant, seulement l'une de ses classes. */
  private async classInScope(ctx: SchoolContext, classId: string) {
    const scope = await this.assessment.findClass(ctx, classId);
    const own = await this.school.ownClasses(ctx);
    if (own && !own.includes(scope.id)) throw new NotFoundException(NOT_FOUND);
    return scope;
  }

  /** Version du périmètre ; brouillons et archives réservés à qui prépare, l'enseignant ses classes. */
  private async find(ctx: SchoolContext, id: string) {
    const tt = await this.db.schoolTimetable.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: TIMETABLE_SELECT,
    });
    if (!tt) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, tt.schoolId);
    if (!this.manages(ctx) && tt.status !== 'PUBLISHED') throw new NotFoundException(NOT_FOUND);
    const own = await this.school.ownClasses(ctx);
    if (own && !own.includes(tt.classId)) throw new NotFoundException(NOT_FOUND);
    return tt;
  }

  private async findSlot(tx: Tx, ctx: SchoolContext, timetableId: string, slotId: string) {
    const slot = await tx.schoolTimetableSlot.findFirst({
      where: { id: slotId, organizationId: ctx.organizationId, timetableId },
      select: SLOT_SELECT,
    });
    if (!slot) throw new NotFoundException(NOT_FOUND);
    return slot;
  }

  private async findPublishedSlot(ctx: SchoolContext, slotId: string) {
    const slot = await this.db.schoolTimetableSlot.findFirst({
      where: { id: slotId, organizationId: ctx.organizationId, timetable: { status: 'PUBLISHED' } },
      select: { ...SLOT_SELECT, timetable: { select: { schoolId: true } } },
    });
    if (!slot) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, slot.timetable.schoolId);
    return slot;
  }

  private async lockTimetable(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolTimetable" WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.schoolTimetable.findUniqueOrThrow({ where: { id }, select: TIMETABLE_SELECT });
  }

  private invalidTime() {
    return new BadRequestException({
      code: 'SLOT_INVALID_TIME',
      message: 'L’heure de fin doit suivre l’heure de début.',
    });
  }

  private notDraft() {
    return new ConflictException({
      code: 'TIMETABLE_NOT_DRAFT',
      message: 'Seul un brouillon peut être modifié de cette façon ou publié.',
    });
  }

  private archived() {
    return new ConflictException({
      code: 'TIMETABLE_ARCHIVED',
      message: 'Une version archivée ne se modifie plus.',
    });
  }

  private draftExists() {
    return new ConflictException({
      code: 'TIMETABLE_DRAFT_EXISTS',
      message: 'Un brouillon existe déjà pour cette classe : modifiez-le ou supprimez-le.',
    });
  }
}

/** Enseignants cités par un fait (avant et après), sans doublon ni vide. */
function participants(...ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}

function planningSlot(
  s: {
    id: string;
    timetableId: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
    kind: 'LESSON' | 'BREAK';
    memberId: string | null;
    roomId: string | null;
    groupId: string | null;
  },
  tt: { classId: string; validFrom: Date; validTo: Date },
): PlanningSlot {
  return {
    id: s.id,
    timetableId: s.timetableId,
    classId: tt.classId,
    groupId: s.groupId,
    kind: s.kind,
    weekday: s.weekday,
    start: s.startMinute,
    end: s.endMinute,
    memberId: s.memberId,
    roomId: s.roomId,
    validFrom: day(tt.validFrom),
    validTo: day(tt.validTo),
  };
}

function timetableView(t: TimetableRow) {
  return {
    id: t.id,
    classId: t.classId,
    schoolYearId: t.schoolYearId,
    label: t.label,
    status: t.status,
    validFrom: day(t.validFrom),
    validTo: day(t.validTo),
    sourceId: t.sourceId,
    publishedAt: t.publishedAt,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function slotView(
  s: SlotRow,
  groups: Map<string, { id: string; name: string; nameAr: string | null }>,
) {
  return {
    id: s.id,
    weekday: s.weekday,
    start: minutesToTime(s.startMinute),
    end: minutesToTime(s.endMinute),
    kind: s.kind,
    label: s.label,
    labelAr: s.labelAr,
    subject: s.subject,
    teacher: s.member,
    room: s.room,
    group: s.groupId ? (groups.get(s.groupId) ?? null) : null,
  };
}

function closureView(c: Closure, families: boolean) {
  if (families && c.visibility !== 'FAMILIES') {
    return { id: null, title: null, titleAr: null, category: null };
  }
  return { id: c.id, title: c.title, titleAr: c.titleAr, category: c.category };
}
