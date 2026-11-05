import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  QURAN_SURAHS,
  type QuranStatus,
  isLimitedToOwnClasses,
  quranModuleActive,
  quranModuleAvailable,
  quranProgressFromHistory,
  quranProgressSummary,
  quranSurahStates,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import type { QuranEvaluationDto, QuranSettingsDto } from './school-assessment.dto';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | SchoolPrismaService;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Module facultatif « Mémorisation du Coran » (Sprint 4). Actif seulement pour un établissement en
 * Bilingue dont la direction l'a activé ; sinon toutes ses routes de données répondent « introuvable »,
 * comme si le module n'existait pas. Données d'enseignement religieux de mineurs : saisie par
 * l'enseignant affecté à la matière Coran de la classe, consultation par la direction, chaque
 * consultation et chaque évaluation journalisées, aucun export. Elles n'entrent dans aucune moyenne.
 */
@Injectable()
export class SchoolQuranService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly assessment: SchoolAssessmentService,
  ) {}

  /** État du module pour un établissement : disponible (langue), activé, effectif, matière. */
  async settings(ctx: SchoolContext, schoolId: string) {
    const { defaultLocale } = await this.school.assertSchool(ctx, schoolId);
    const settings = await this.db.schoolQuranSettings.findUnique({ where: { schoolId } });
    const enabled = settings?.enabled ?? false;
    return {
      available: quranModuleAvailable(defaultLocale),
      enabled,
      active: quranModuleActive(defaultLocale, enabled),
      subjectId: settings?.subjectId ?? null,
    };
  }

  /**
   * Activation ou désactivation par la direction, sous verrou exclusif de l'établissement : un
   * changement de langue ou une évaluation en cours (verrou partagé) ne peut pas s'intercaler. Désactiver
   * masque le module sans rien supprimer.
   */
  async saveSettings(ctx: SchoolContext, dto: QuranSettingsDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "School" WHERE id = ${dto.schoolId}::uuid FOR UPDATE`;
      const school = await tx.school.findUniqueOrThrow({
        where: { id: dto.schoolId },
        select: { defaultLocale: true },
      });
      if (dto.enabled && !quranModuleAvailable(school.defaultLocale)) {
        throw new ConflictException({
          code: 'QURAN_MODULE_UNAVAILABLE',
          message: 'Ce module est réservé aux établissements configurés en Bilingue.',
        });
      }
      if (dto.enabled && !dto.subjectId) {
        throw new BadRequestException({
          code: 'QURAN_SUBJECT_REQUIRED',
          message: 'Choisissez la matière dont les enseignants saisissent la mémorisation.',
        });
      }
      if (dto.subjectId) {
        const subject = await tx.subject.findFirst({
          where: {
            id: dto.subjectId,
            organizationId: ctx.organizationId,
            schoolId: dto.schoolId,
            isActive: true,
          },
          select: { id: true },
        });
        if (!subject) {
          throw new BadRequestException({
            code: 'SUBJECT_UNAVAILABLE',
            message: 'Cette matière n’est pas une matière active de l’établissement.',
          });
        }
      }
      await tx.schoolQuranSettings.upsert({
        where: { schoolId: dto.schoolId },
        create: {
          schoolId: dto.schoolId,
          organizationId: ctx.organizationId,
          enabled: dto.enabled,
          subjectId: dto.subjectId ?? null,
          updatedByUserId: ctx.userId,
        },
        update: {
          enabled: dto.enabled,
          ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId } : {}),
          updatedByUserId: ctx.userId,
        },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.quran_module_changed',
        'School',
        dto.schoolId,
        {
          enabled: dto.enabled,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.settings(ctx, dto.schoolId);
  }

  /** Catalogue de référence des sourates (données publiques, sans élève). */
  surahs() {
    return QURAN_SURAHS;
  }

  /** Vue de progression d'une classe : synthèse par élève. */
  async classProgress(ctx: SchoolContext, classId: string) {
    const scope = await this.assessment.findClass(ctx, classId);
    const result = await this.students.snapshot(async (tx) => {
      const settings = await this.activeModule(tx, ctx, scope.schoolId);
      const roster = await this.assessment.roster(tx, ctx, scope.id);
      const visible = await this.visibleStudents(tx, ctx, scope.id, settings.subjectId);
      // Élèves encore rattachés à l'établissement de la classe : un élève transféré depuis (ancienne
      // année clôturée) n'expose pas sa progression actuelle, tenue ailleurs.
      const current = new Set(
        (
          await tx.schoolStudent.findMany({
            where: {
              organizationId: ctx.organizationId,
              schoolId: scope.schoolId,
              id: { in: roster.map((s) => s.id) },
            },
            select: { id: true },
          })
        ).map((s) => s.id),
      );
      const ids = roster.filter((s) => current.has(s.id) && visible(s.groupIds)).map((s) => s.id);
      const progress = await tx.schoolQuranProgress.findMany({
        where: { organizationId: ctx.organizationId, studentId: { in: ids } },
        select: { studentId: true, surah: true, status: true },
      });
      const last = await tx.schoolQuranEvaluation.groupBy({
        by: ['studentId'],
        where: { organizationId: ctx.organizationId, studentId: { in: ids } },
        _max: { evaluatedOn: true },
      });
      const lastOf = new Map(last.map((l) => [l.studentId, day(l._max.evaluatedOn)]));
      return roster
        .filter((s) => ids.includes(s.id))
        .map((s) => ({
          id: s.id,
          matricule: s.matricule,
          lastName: s.lastName,
          firstName: s.firstName,
          lastNameAr: s.lastNameAr,
          firstNameAr: s.firstNameAr,
          summary: quranProgressSummary(progress.filter((p) => p.studentId === s.id)),
          lastEvaluatedOn: lastOf.get(s.id) ?? null,
        }));
    });
    await this.school.log(ctx, 'school.quran_class_viewed', 'SchoolClass', scope.id, {
      students: result.length,
    });
    return result;
  }

  /** Progression individuelle : 114 sourates et historique complet des évaluations. */
  async studentProgress(ctx: SchoolContext, studentId: string) {
    await this.students.findStudent(ctx, studentId);
    const result = await this.students.snapshot(async (tx) => {
      // Élève, établissement et périmètre relus dans l'instantané même des données restituées : un
      // transfert terminé entre-temps rend l'élève introuvable, et le module est celui de son école.
      const own = await this.students.ownClasses(ctx, tx);
      const identity = await tx.schoolStudent.findFirst({
        where: {
          id: studentId,
          organizationId: ctx.organizationId,
          ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
          ...this.students.ownClassesFilter(own),
        },
        select: {
          id: true,
          schoolId: true,
          matricule: true,
          lastName: true,
          firstName: true,
          lastNameAr: true,
          firstNameAr: true,
        },
      });
      if (!identity) throw new NotFoundException(NOT_FOUND);
      const settings = await this.activeModule(tx, ctx, identity.schoolId);
      await this.assertCanSee(tx, ctx, studentId, settings.subjectId);
      const progress = await tx.schoolQuranProgress.findMany({
        where: { organizationId: ctx.organizationId, studentId },
      });
      const history = await tx.schoolQuranEvaluation.findMany({
        where: { organizationId: ctx.organizationId, studentId },
        orderBy: [{ evaluatedOn: 'desc' }, { sequence: 'desc' }],
        select: {
          id: true,
          surah: true,
          status: true,
          evaluatedOn: true,
          remark: true,
          remarkShared: true,
          evaluatorUserId: true,
          createdAt: true,
        },
      });
      const states = quranSurahStates(
        progress.map((p) => ({
          surah: p.surah,
          status: p.status,
          memorizedOn: day(p.memorizedOn),
          lastReviewedOn: day(p.lastReviewedOn),
        })),
      );
      const { schoolId: _school, ...student } = identity;
      return {
        student,
        surahs: states,
        summary: quranProgressSummary(states.map((s) => ({ surah: s.number, status: s.status }))),
        history: history.map((h) => ({ ...h, evaluatedOn: day(h.evaluatedOn) })),
        canEvaluate: isLimitedToOwnClasses(ctx.role),
      };
    });
    await this.school.log(ctx, 'school.quran_student_viewed', 'SchoolStudent', studentId, {});
    return result;
  }

  /**
   * Évaluation d'une sourate par l'enseignant affecté à la matière Coran de la classe de l'élève.
   * L'historique ne se réécrit jamais ; l'état courant est recalculé depuis lui sous verrou de l'élève.
   */
  async evaluate(ctx: SchoolContext, studentId: string, dto: QuranEvaluationDto) {
    const student = await this.students.findStudent(ctx, studentId);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [student.schoolId]);
      const settings = await this.activeModule(tx, ctx, student.schoolId);
      const locked = await this.students.lockInScope(tx, ctx, studentId);
      if (locked.schoolId !== student.schoolId) throw new NotFoundException(NOT_FOUND);
      const school = await tx.school.findUniqueOrThrow({
        where: { id: student.schoolId },
        select: { timezone: true },
      });
      if (dto.evaluatedOn > today(school.timezone)) {
        throw new BadRequestException({
          code: 'DATE_IN_FUTURE',
          message: 'La date de l’évaluation ne peut pas être dans le futur.',
        });
      }
      // Classes actuelles de l'élève en partage, après l'élève et avant les affectations (ordre du module) :
      // un retrait de groupe ou une fin d'affectation (classe exclusive) attend cette évaluation, et le
      // contrôle qui suit relit inscriptions et groupes sous ces verrous.
      const classes = await tx.schoolEnrollment.findMany({
        where: {
          organizationId: ctx.organizationId,
          studentId,
          status: 'VALIDATED',
          classId: { not: null },
          year: { status: { not: 'CLOSED' } },
        },
        select: { classId: true },
      });
      const classIds = [...new Set(classes.map((c) => c.classId as string))].sort();
      if (classIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ANY(${classIds}::uuid[]) ORDER BY id FOR SHARE`;
      }
      await this.assertCanSee(tx, ctx, studentId, settings.subjectId, true);
      // Numéro d'ordre attribué sous le verrou exclusif de l'élève : strictement croissant, jamais en double.
      const last = await tx.schoolQuranEvaluation.aggregate({
        where: { studentId, surah: dto.surah },
        _max: { sequence: true },
      });
      await tx.schoolQuranEvaluation.create({
        data: {
          organizationId: ctx.organizationId,
          studentId,
          surah: dto.surah,
          status: dto.status,
          evaluatedOn: new Date(`${dto.evaluatedOn}T00:00:00.000Z`),
          remark: dto.remark ?? null,
          // Une observation n'est partagée avec la famille que si elle existe et que l'enseignant l'autorise.
          remarkShared: Boolean(dto.remark) && (dto.remarkShared ?? false),
          sequence: (last._max.sequence ?? 0) + 1,
          evaluatorUserId: ctx.userId,
        },
      });
      const history = await tx.schoolQuranEvaluation.findMany({
        where: { organizationId: ctx.organizationId, studentId, surah: dto.surah },
        select: { status: true, evaluatedOn: true, sequence: true },
      });
      const state = quranProgressFromHistory(
        history.map((h) => ({
          status: h.status as QuranStatus,
          evaluatedOn: day(h.evaluatedOn) as string,
          sequence: h.sequence,
        })),
      );
      const data = {
        status: state.status,
        memorizedOn: state.memorizedOn ? new Date(`${state.memorizedOn}T00:00:00.000Z`) : null,
        lastReviewedOn: state.lastReviewedOn
          ? new Date(`${state.lastReviewedOn}T00:00:00.000Z`)
          : null,
        updatedByUserId: ctx.userId,
      };
      await tx.schoolQuranProgress.upsert({
        where: { studentId_surah: { studentId, surah: dto.surah } },
        create: { organizationId: ctx.organizationId, studentId, surah: dto.surah, ...data },
        update: data,
      });
    });
    await this.school.log(ctx, 'school.quran_evaluated', 'SchoolStudent', studentId, {
      surah: dto.surah,
    });
    return this.studentProgress(ctx, studentId);
  }

  // ─── Outils ───

  /** Réglages d'un module actif ; sinon « introuvable », sans révéler que le module existe. */
  private async activeModule(db: Db, ctx: SchoolContext, schoolId: string) {
    const school = await db.school.findFirst({
      where: { id: schoolId, organizationId: ctx.organizationId },
      select: { defaultLocale: true, quran: { select: { enabled: true, subjectId: true } } },
    });
    if (!school || !quranModuleActive(school.defaultLocale, school.quran?.enabled ?? false)) {
      throw new NotFoundException(NOT_FOUND);
    }
    return { subjectId: school.quran?.subjectId ?? null };
  }

  /**
   * Filtre des élèves visibles dans une classe : tous pour la direction ; pour l'enseignant, ceux de
   * ses affectations sur la matière Coran (classe entière ou groupes).
   */
  private async visibleStudents(
    db: Db,
    ctx: SchoolContext,
    classId: string,
    subjectId: string | null,
  ): Promise<(groupIds: string[]) => boolean> {
    if (!isLimitedToOwnClasses(ctx.role)) return () => true;
    const slots = await this.quranSlots(db, ctx, [classId], subjectId);
    if (slots.length === 0) throw this.notAssigned();
    if (slots.some((s) => s.groupId === null)) return () => true;
    const groups = new Set(slots.map((s) => s.groupId));
    return (groupIds) => groupIds.some((g) => groups.has(g));
  }

  /**
   * Droit sur un élève : la direction dans son périmètre ; l'enseignant, s'il est affecté à la matière
   * Coran de la classe actuelle de l'élève (ou de son groupe). En écriture, l'affectation est verrouillée
   * en partage : sa fin attend l'évaluation en cours.
   */
  private async assertCanSee(
    db: Db,
    ctx: SchoolContext,
    studentId: string,
    subjectId: string | null,
    lock = false,
  ) {
    if (!isLimitedToOwnClasses(ctx.role)) {
      if (lock) throw this.notAssigned();
      return;
    }
    const enrollments = await db.schoolEnrollment.findMany({
      where: {
        organizationId: ctx.organizationId,
        studentId,
        status: 'VALIDATED',
        classId: { not: null },
        year: { status: { not: 'CLOSED' } },
      },
      select: { classId: true },
    });
    const classIds = enrollments.map((e) => e.classId as string);
    const slots = await this.quranSlots(db, ctx, classIds, subjectId, lock);
    if (slots.some((s) => s.groupId === null)) return;
    const groupIds = slots.map((s) => s.groupId as string);
    const inGroup =
      groupIds.length > 0 &&
      (await db.schoolClassGroupStudent.count({
        where: { organizationId: ctx.organizationId, studentId, groupId: { in: groupIds } },
      })) > 0;
    if (!inGroup) throw this.notAssigned();
  }

  private async quranSlots(
    db: Db,
    ctx: SchoolContext,
    classIds: string[],
    subjectId: string | null,
    lock = false,
  ): Promise<{ groupId: string | null }[]> {
    if (!ctx.memberId || !subjectId || classIds.length === 0) return [];
    if (lock) {
      return (db as Tx).$queryRaw<{ groupId: string | null }[]>`
        SELECT a."groupId" FROM "SchoolTeachingAssignment" a
        WHERE a."organizationId" = ${ctx.organizationId}::uuid AND a."memberId" = ${ctx.memberId}::uuid
          AND a."classId" = ANY(${classIds}::uuid[]) AND a."subjectId" = ${subjectId}::uuid
          AND a."endedAt" IS NULL
        ORDER BY a.id FOR SHARE`;
    }
    return db.schoolTeachingAssignment.findMany({
      where: {
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        classId: { in: classIds },
        subjectId,
        endedAt: null,
      },
      select: { groupId: true },
    });
  }

  private notAssigned() {
    return new ForbiddenException({
      code: 'TEACHER_NOT_ASSIGNED',
      message:
        'Seul l’enseignant affecté à la matière Coran de la classe peut accéder à cet élève.',
    });
  }
}
