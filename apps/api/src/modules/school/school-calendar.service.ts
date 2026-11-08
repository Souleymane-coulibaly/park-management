import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_CLOSURE_CATEGORIES,
  SchoolPermission,
  type SchoolEventAudience,
  type SchoolEventVisibility,
  closureApplies,
  isClosure,
  addDays,
  hasSchoolPermission,
  minutesToTime,
  timeToMinutes,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolNotificationsService } from './school-notifications.service';
import type { CalendarEventDto, CalendarQueryDto } from './school-planning.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | SchoolPrismaService;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);
/** Un événement couvre au plus une année ; une requête de calendrier au plus 13 mois. */
const MAX_EVENT_DAYS = 366;
const MAX_RANGE_DAYS = 400;

const EVENT_SELECT = {
  id: true,
  schoolId: true,
  category: true,
  title: true,
  titleAr: true,
  description: true,
  descriptionAr: true,
  startsOn: true,
  endsOn: true,
  startMinute: true,
  endMinute: true,
  audience: true,
  visibility: true,
  status: true,
  important: true,
  publishedAt: true,
  targets: { select: { classId: true, groupId: true } },
} as const;

type EventRow = Prisma.SchoolCalendarEventGetPayload<{ select: typeof EVENT_SELECT }>;

/** Fermeture publiée (vacances, férié, journée pédagogique), ses cibles et sa visibilité. */
export interface Closure {
  id: string;
  schoolId: string;
  title: string;
  titleAr: string | null;
  category: string;
  startsOn: string;
  endsOn: string;
  audience: SchoolEventAudience;
  visibility: SchoolEventVisibility;
  /** Classes visées (public CLASSES). */
  classIds: string[];
  /** Groupes visés (public GROUPS) : seuls leurs cours sont suspendus. */
  groupIds: string[];
  /** Classes concernées directement ou par l'un de leurs groupes (affichage du personnel). */
  relatedClassIds: string[];
}

/**
 * Calendrier scolaire (Sprint 7) : événements de l'établissement (vacances, jours fériés, journées
 * pédagogiques, sessions d'examens, réunions, sorties…), avec leurs dates propres à chaque établissement.
 * Brouillon, publication, annulation ; public (établissement, classes, groupes) et visibilité (personnel,
 * familles). Les fermetures publiées suspendent les cours et refusent un examen.
 */
@Injectable()
export class SchoolCalendarService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  /**
   * Calendrier d'une période : année et périodes, événements, sans brouillon pour qui ne gère pas le
   * calendrier ; l'enseignant ne voit que ce qui vise l'établissement ou ses classes.
   */
  async list(ctx: SchoolContext, q: CalendarQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    assertRange(q.from, q.to);
    const manages = hasSchoolPermission(ctx.role, SchoolPermission.CALENDAR_MANAGE);
    const own = await this.school.ownClasses(ctx);
    const [rows, years] = await Promise.all([
      this.db.schoolCalendarEvent.findMany({
        where: {
          organizationId: ctx.organizationId,
          schoolId: q.schoolId,
          startsOn: { lte: toDate(q.to) },
          endsOn: { gte: toDate(q.from) },
          ...(manages ? {} : { status: 'PUBLISHED' }),
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: EVENT_SELECT,
      }),
      this.db.schoolYear.findMany({
        where: {
          organizationId: ctx.organizationId,
          schoolId: q.schoolId,
          startsOn: { lte: toDate(q.to) },
          endsOn: { gte: toDate(q.from) },
        },
        select: {
          id: true,
          label: true,
          startsOn: true,
          endsOn: true,
          status: true,
          periods: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              label: true,
              labelAr: true,
              kind: true,
              startsOn: true,
              endsOn: true,
            },
          },
        },
      }),
    ]);
    const groupClasses = own ? await this.groupClasses(rows) : new Map<string, string>();
    const visible = own ? rows.filter((e) => targetsAny(e, own, groupClasses)) : rows;
    return {
      years: years.map((y) => ({
        ...y,
        startsOn: day(y.startsOn),
        endsOn: day(y.endsOn),
        periods: y.periods.map((p) => ({ ...p, startsOn: day(p.startsOn), endsOn: day(p.endsOn) })),
      })),
      events: visible.map(view),
    };
  }

  async get(ctx: SchoolContext, id: string) {
    const found = await this.find(ctx, id);
    return view(found);
  }

  async create(ctx: SchoolContext, dto: CalendarEventDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const data = await this.validate(ctx, dto, true);
    const id = await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const created = await tx.schoolCalendarEvent.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: dto.schoolId,
          ...data.fields,
          createdByUserId: ctx.userId,
          targets: { create: data.targets },
        },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.calendar_event_created',
        'SchoolCalendarEvent',
        created.id,
        { category: dto.category },
      );
      return created.id;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  /** Modification d'un brouillon ou d'un événement publié (une annulation ne se modifie plus). */
  async update(ctx: SchoolContext, id: string, dto: CalendarEventDto) {
    const found = await this.find(ctx, id);
    if (dto.schoolId !== found.schoolId) throw new NotFoundException(NOT_FOUND);
    const data = await this.validate(ctx, dto, false);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lockEvent(tx, id);
      if (current.status === 'CANCELLED') throw this.cancelled();
      await tx.schoolCalendarEventTarget.deleteMany({
        where: { organizationId: ctx.organizationId, eventId: id },
      });
      await tx.schoolCalendarEvent.update({
        where: { id },
        data: { ...data.fields, updatedByUserId: ctx.userId, targets: { create: data.targets } },
      });
      // Événement publié : cibles finales actives, et aucune fermeture sur un examen programmé.
      if (current.status === 'PUBLISHED') {
        await this.assertTargetsActive(
          tx,
          await tx.schoolCalendarEvent.findUniqueOrThrow({ where: { id }, select: EVENT_SELECT }),
        );
      }
      await this.assertNoExamDuringClosure(tx, ctx.organizationId, id);
      await this.school.recordDecision(
        tx,
        ctx,
        'school.calendar_event_updated',
        'SchoolCalendarEvent',
        id,
        { status: current.status },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  /** Publication : visible selon sa visibilité ; important et visible des familles, il les notifie. */
  async publish(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lockEvent(tx, id);
      if (current.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'EVENT_NOT_DRAFT',
          message: 'Seul un brouillon peut être publié.',
        });
      }
      // Cibles revalidées : une classe archivée ou un groupe désactivé depuis le brouillon ne reçoit rien.
      await this.assertTargetsActive(tx, current);
      await tx.schoolCalendarEvent.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), updatedByUserId: ctx.userId },
      });
      await this.assertNoExamDuringClosure(tx, ctx.organizationId, id);
      if (current.important && current.visibility === 'FAMILIES') {
        await this.notifications.notifyStudents(tx, {
          organizationId: ctx.organizationId,
          schoolId: current.schoolId,
          kind: 'EVENT',
          resourceId: id,
          studentIds: await this.audienceStudents(tx, ctx.organizationId, current),
          params: { title: current.title, date: day(current.startsOn) },
          dedupe: (studentId) => `event:${id}:${studentId}`,
        });
      }
      await this.school.recordDecision(
        tx,
        ctx,
        'school.calendar_event_published',
        'SchoolCalendarEvent',
        id,
        { category: current.category, important: current.important },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  async cancel(ctx: SchoolContext, id: string) {
    await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.lockPlanning(tx, ctx.organizationId);
      const current = await this.lockEvent(tx, id);
      if (current.status === 'CANCELLED') throw this.cancelled();
      await tx.schoolCalendarEvent.update({
        where: { id },
        data: { status: 'CANCELLED', updatedByUserId: ctx.userId },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.calendar_event_cancelled',
        'SchoolCalendarEvent',
        id,
        { wasPublished: current.status === 'PUBLISHED' },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.get(ctx, id);
  }

  // ─── Lectures partagées (planning, examens, portail) ───

  /** Fermetures publiées d'établissements sur une période, avec les classes visées. */
  async closures(db: Db, organizationId: string, schoolIds: string[], from: string, to: string) {
    if (schoolIds.length === 0) return [];
    const rows = await db.schoolCalendarEvent.findMany({
      where: {
        organizationId,
        schoolId: { in: schoolIds },
        status: 'PUBLISHED',
        category: { in: [...SCHOOL_CLOSURE_CATEGORIES] },
        startsOn: { lte: toDate(to) },
        endsOn: { gte: toDate(from) },
      },
      select: EVENT_SELECT,
    });
    const groupClasses = await this.groupClasses(rows, db);
    return rows.map((e): Closure => ({
      id: e.id,
      schoolId: e.schoolId,
      title: e.title,
      titleAr: e.titleAr,
      category: e.category,
      startsOn: day(e.startsOn),
      endsOn: day(e.endsOn),
      audience: e.audience,
      visibility: e.visibility,
      classIds: e.targets.map((t) => t.classId).filter((x): x is string => !!x),
      groupIds: e.targets.map((t) => t.groupId).filter((x): x is string => !!x),
      relatedClassIds: classIdsOf(e, groupClasses),
    }));
  }

  /**
   * Événements publiés visibles des familles pour des enfants : établissement entier, classe de l'enfant
   * ou l'un de ses groupes.
   */
  async forFamilies(
    organizationId: string,
    children: { schoolId: string; classId: string | null; groupIds: string[] }[],
    from: string,
    to: string,
  ) {
    if (children.length === 0) return [];
    assertRange(from, to);
    const filters: Prisma.SchoolCalendarEventWhereInput[] = children.map((c) => ({
      schoolId: c.schoolId,
      OR: [
        { audience: 'SCHOOL' },
        ...(c.classId
          ? [{ audience: 'CLASSES' as const, targets: { some: { classId: c.classId } } }]
          : []),
        ...(c.groupIds.length
          ? [{ audience: 'GROUPS' as const, targets: { some: { groupId: { in: c.groupIds } } } }]
          : []),
      ],
    }));
    const rows = await this.db.schoolCalendarEvent.findMany({
      where: {
        organizationId,
        status: 'PUBLISHED',
        visibility: 'FAMILIES',
        startsOn: { lte: toDate(to) },
        endsOn: { gte: toDate(from) },
        OR: filters,
      },
      orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
      select: EVENT_SELECT,
    });
    return rows.map((e) => {
      const { targets: _targets, status: _status, ...rest } = view(e);
      return rest;
    });
  }

  // ─── Outils ───

  /**
   * Une fermeture publiée ne recouvre aucun examen non annulé de la même cible (établissement, classe ou
   * groupe), lu sous le verrou du planning que prend aussi la programmation des examens.
   */
  private async assertNoExamDuringClosure(tx: Tx, organizationId: string, eventId: string) {
    const e = await tx.schoolCalendarEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: EVENT_SELECT,
    });
    if (e.status !== 'PUBLISHED' || !isClosure(e.category)) return;
    const closure = {
      schoolId: e.schoolId,
      audience: e.audience,
      classIds: e.targets.map((t) => t.classId).filter((x): x is string => !!x),
      groupIds: e.targets.map((t) => t.groupId).filter((x): x is string => !!x),
    };
    const exams = await tx.schoolExamSchedule.findMany({
      where: {
        organizationId,
        schoolId: e.schoolId,
        status: { not: 'CANCELLED' },
        date: { gte: e.startsOn, lte: e.endsOn },
      },
      select: {
        id: true,
        date: true,
        startMinute: true,
        durationMinutes: true,
        evaluation: {
          select: {
            classId: true,
            groupId: true,
            title: true,
            class: { select: { id: true, name: true, nameAr: true } },
          },
        },
      },
    });
    const blocking = exams.filter((x) =>
      closureApplies(closure, {
        schoolId: e.schoolId,
        classId: x.evaluation.classId,
        groupIds: x.evaluation.groupId ? [x.evaluation.groupId] : [],
      }),
    );
    if (blocking.length > 0) {
      throw new ConflictException({
        code: 'CLOSURE_EXAM_CONFLICT',
        message:
          'Des examens sont programmés pendant cette fermeture : déplacez-les ou annulez-les d’abord.',
        details: blocking.map((x) => ({
          code: 'CLOSURE_EXAM_CONFLICT',
          examId: x.id,
          date: day(x.date),
          start: minutesToTime(x.startMinute),
          end: minutesToTime(x.startMinute + x.durationMinutes),
          class: x.evaluation.class,
          title: x.evaluation.title,
        })),
      });
    }
  }

  /**
   * Champs contrôlés. En modification, un texte facultatif absent de la requête est conservé (seul `null`
   * l'efface) : un écran qui n'affiche pas la traduction arabe ne la perd pas.
   */
  private async validate(ctx: SchoolContext, dto: CalendarEventDto, creating: boolean) {
    const keep = <T>(v: T | null | undefined) => (creating ? (v ?? null) : v);
    if (dto.endsOn < dto.startsOn || addDays(dto.startsOn, MAX_EVENT_DAYS - 1) < dto.endsOn) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_PERIOD',
        message: 'Période invalide : la fin précède le début ou dépasse un an.',
      });
    }
    const hasTimes = dto.start != null || dto.end != null;
    let startMinute: number | null = null;
    let endMinute: number | null = null;
    if (hasTimes) {
      if (!dto.start || !dto.end) throw this.invalidTime();
      startMinute = timeToMinutes(dto.start);
      endMinute = dto.end === '24:00' ? 1440 : timeToMinutes(dto.end);
      if (endMinute <= startMinute) throw this.invalidTime();
    }
    const ids = [...new Set(dto.targetIds ?? [])];
    let targets: { classId?: string; groupId?: string }[] = [];
    if (dto.audience === 'SCHOOL') {
      if (ids.length > 0) throw this.invalidTargets();
    } else {
      if (ids.length === 0) throw this.invalidTargets();
      const found =
        dto.audience === 'CLASSES'
          ? await this.db.schoolClass.count({
              where: {
                organizationId: ctx.organizationId,
                id: { in: ids },
                year: { schoolId: dto.schoolId },
              },
            })
          : await this.db.schoolClassGroup.count({
              where: {
                organizationId: ctx.organizationId,
                id: { in: ids },
                class: { year: { schoolId: dto.schoolId } },
              },
            });
      if (found !== ids.length) throw this.invalidTargets();
      targets = ids.map((id) => (dto.audience === 'CLASSES' ? { classId: id } : { groupId: id }));
    }
    return {
      fields: {
        category: dto.category,
        title: dto.title,
        titleAr: keep(dto.titleAr),
        description: keep(dto.description),
        descriptionAr: keep(dto.descriptionAr),
        startsOn: toDate(dto.startsOn),
        endsOn: toDate(dto.endsOn),
        startMinute,
        endMinute,
        audience: dto.audience,
        visibility: dto.visibility,
        important: dto.important ?? false,
      },
      // Création imbriquée : l'organisation se déduit de l'événement (relation composée).
      targets,
    };
  }

  /** Élèves concernés : inscription validée dans une classe visée (année en cours) ou membres d'un groupe. */
  /**
   * Élèves concernés, selon les règles du portail : inscription validée dans une classe visée de l'année en
   * cours, ou appartenance à un groupe actif dont l'élève est inscrit dans la classe (année en cours).
   */
  private async audienceStudents(tx: Tx, organizationId: string, event: EventRow) {
    const classIds = event.targets.map((t) => t.classId).filter((x): x is string => !!x);
    const groupIds = event.targets.map((t) => t.groupId).filter((x): x is string => !!x);
    const groups =
      event.audience === 'GROUPS'
        ? await tx.schoolClassGroup.findMany({
            where: { id: { in: groupIds }, isActive: true, class: { isActive: true } },
            select: { id: true, classId: true },
          })
        : [];
    const where: Prisma.SchoolStudentWhereInput =
      event.audience === 'GROUPS'
        ? {
            groups: { some: { groupId: { in: groups.map((g) => g.id) } } },
            enrollments: {
              some: {
                status: 'VALIDATED',
                year: { status: 'ACTIVE' },
                classId: { in: groups.map((g) => g.classId) },
              },
            },
          }
        : {
            schoolId: event.schoolId,
            enrollments: {
              some: {
                status: 'VALIDATED',
                year: { status: 'ACTIVE' },
                ...(event.audience === 'CLASSES' ? { classId: { in: classIds } } : {}),
              },
            },
          };
    const rows = await tx.schoolStudent.findMany({
      where: { organizationId, ...where },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Toutes les classes ou tous les groupes visés sont encore actifs (groupe : sa classe aussi). */
  private async assertTargetsActive(tx: Tx, event: EventRow) {
    const classIds = event.targets.map((t) => t.classId).filter((x): x is string => !!x);
    const groupIds = event.targets.map((t) => t.groupId).filter((x): x is string => !!x);
    // Lues en partage jusqu'au commit : un archivage ou une désactivation concurrente attend, ou précède.
    const active =
      event.audience === 'CLASSES'
        ? (
            await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM "SchoolClass" WHERE id = ANY(${classIds}::uuid[]) AND "isActive"
              FOR SHARE`
          ).length
        : event.audience === 'GROUPS'
          ? (
              await tx.$queryRaw<{ id: string }[]>`
                SELECT g.id FROM "SchoolClassGroup" g JOIN "SchoolClass" c ON c.id = g."classId"
                WHERE g.id = ANY(${groupIds}::uuid[]) AND g."isActive" AND c."isActive"
                FOR SHARE OF g, c`
            ).length
          : 0;
    const expected = event.audience === 'CLASSES' ? classIds.length : groupIds.length;
    if (event.audience !== 'SCHOOL' && active !== expected) {
      throw new ConflictException({
        code: 'EVENT_TARGET_INACTIVE',
        message:
          'Une classe ou un groupe visé a été archivé ou désactivé : modifiez les destinataires.',
      });
    }
  }

  /** Classe de chaque groupe visé (un enseignant voit l'événement d'un groupe de ses classes). */
  private async groupClasses(rows: EventRow[], db: Db = this.db) {
    const groupIds = rows.flatMap((e) =>
      e.targets.map((t) => t.groupId).filter((x): x is string => !!x),
    );
    if (groupIds.length === 0) return new Map<string, string>();
    const groups = await db.schoolClassGroup.findMany({
      where: { id: { in: [...new Set(groupIds)] } },
      select: { id: true, classId: true },
    });
    return new Map(groups.map((g) => [g.id, g.classId]));
  }

  private async find(ctx: SchoolContext, id: string) {
    const found = await this.db.schoolCalendarEvent.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: EVENT_SELECT,
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, found.schoolId);
    const manages = hasSchoolPermission(ctx.role, SchoolPermission.CALENDAR_MANAGE);
    if (!manages && found.status !== 'PUBLISHED') throw new NotFoundException(NOT_FOUND);
    const own = await this.school.ownClasses(ctx);
    if (own && !targetsAny(found, own, await this.groupClasses([found]))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return found;
  }

  private async lockEvent(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolCalendarEvent" WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.schoolCalendarEvent.findUniqueOrThrow({ where: { id }, select: EVENT_SELECT });
  }

  private cancelled() {
    return new ConflictException({
      code: 'EVENT_CANCELLED',
      message: 'Cet événement est annulé.',
    });
  }

  private invalidTime() {
    return new BadRequestException({
      code: 'SLOT_INVALID_TIME',
      message: 'L’heure de fin doit suivre l’heure de début.',
    });
  }

  private invalidTargets() {
    return new BadRequestException({
      code: 'INVALID_TARGETS',
      message: 'Destinataires invalides pour ce public.',
    });
  }
}

function assertRange(from: string, to: string) {
  if (to < from || addDays(from, MAX_RANGE_DAYS) < to) {
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: 'Période de consultation invalide (13 mois au plus).',
    });
  }
}

function classIdsOf(e: EventRow, groupClasses: Map<string, string>): string[] {
  return [
    ...new Set(
      e.targets
        .map((t) => t.classId ?? (t.groupId ? groupClasses.get(t.groupId) : undefined))
        .filter((x): x is string => !!x),
    ),
  ];
}

/** Événement de l'établissement entier, ou visant l'une de ces classes (directement ou par un groupe). */
function targetsAny(e: EventRow, classIds: string[], groupClasses: Map<string, string>) {
  return e.audience === 'SCHOOL' || classIdsOf(e, groupClasses).some((c) => classIds.includes(c));
}

function view(e: EventRow) {
  return {
    id: e.id,
    schoolId: e.schoolId,
    category: e.category,
    title: e.title,
    titleAr: e.titleAr,
    description: e.description,
    descriptionAr: e.descriptionAr,
    startsOn: day(e.startsOn),
    endsOn: day(e.endsOn),
    start: e.startMinute === null ? null : minutesToTime(e.startMinute),
    end: e.endMinute === null ? null : minutesToTime(e.endMinute),
    audience: e.audience,
    visibility: e.visibility,
    status: e.status,
    important: e.important,
    publishedAt: e.publishedAt,
    targets: e.targets.map((t) => t.classId ?? t.groupId!),
  };
}
