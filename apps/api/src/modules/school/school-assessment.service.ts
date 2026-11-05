import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  type ClassResults,
  type SchoolGradeStatus,
  type SchoolGradingRules,
  computeClassResults,
  gradeEntryError,
  hasSchoolPermission,
  isLimitedToOwnClasses,
  periodsOverlap,
  policyForPeriod,
  resolveGradingRules,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import type {
  ClassPeriodQueryDto,
  CreateEvaluationDto,
  EvaluationQueryDto,
  SaveAppreciationsDto,
  SaveCommentsDto,
  SaveGradesDto,
  UnlockResultsDto,
  UpdateEvaluationDto,
  UpdatePeriodDto,
} from './school-assessment.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | SchoolPrismaService;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

/** Classe lue avec ce qui fonde son contrôle : établissement, année, niveau. */
export interface ClassScope {
  id: string;
  name: string;
  nameAr: string | null;
  schoolId: string;
  schoolYearId: string;
  levelId: string;
  isActive: boolean;
}

/** Place d'enseignement : matière, groupe éventuel (null = toute la classe). */
interface Slot {
  subjectId: string;
  groupId: string | null;
}

export interface RosterStudent {
  id: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  birthDate: Date;
  groupIds: string[];
}

export interface ResultsSubjectView {
  id: string;
  name: string;
  nameAr: string | null;
  coefficient: number;
}

/** Résultats figés par une validation : tout ce qu'il faut pour les restituer à l'identique. */
interface FrozenResults {
  rules: SchoolGradingRules;
  subjects: { id: string; coefficient: number }[];
  results: ClassResults;
  /** Groupes de chaque élève à la validation : la vue de l'enseignant se recalcule sur cet état figé. */
  groups?: Record<string, string[]>;
}

export interface ClassPeriodResults {
  scope: ClassScope;
  period: { id: string; label: string; labelAr: string | null; endsOn: Date };
  rules: SchoolGradingRules;
  policyVersion: number | null;
  subjects: ResultsSubjectView[];
  roster: RosterStudent[];
  results: ClassResults;
  validation: { id: string; validatedAt: Date; validatedByUserId: string } | null;
}

const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? null : Number(d);

/**
 * Évaluations, notes, moyennes et validation des résultats (Sprint 4).
 *
 * Droits : la direction gère tout son périmètre ; l'enseignant ne voit et ne saisit que les matières,
 * classes et groupes de ses affectations actives ; le secrétariat consulte. Verrous, dans cet ordre :
 * établissement (partagé, la clôture d'année l'attend), verrou consultatif de la classe et de la période
 * (sérialise toute écriture avec la validation), affectation de l'enseignant (partagé : sa fin attend
 * la saisie en cours), puis la ligne visée. Après validation par la direction, notes, évaluations et
 * appréciations des enseignants sont refusées jusqu'à une réouverture motivée.
 */
@Injectable()
export class SchoolAssessmentService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
  ) {}

  // ─── Périodes ───

  async listPeriods(ctx: SchoolContext, schoolYearId: string) {
    const year = await this.school.findYear(ctx, schoolYearId);
    const periods = await this.db.academicPeriod.findMany({
      where: { organizationId: ctx.organizationId, schoolYearId: year.id },
      orderBy: { position: 'asc' },
      include: { _count: { select: { evaluations: true, validations: true } } },
    });
    return periods.map(({ _count, ...p }) => ({
      ...p,
      evaluations: _count.evaluations,
      inUse: _count.evaluations + _count.validations > 0,
    }));
  }

  /**
   * Modification d'une période, sous les verrous de l'établissement, de l'année et de la période : aucune
   * évaluation ne peut sortir de ses dates, aucune autre période n'est chevauchée.
   */
  async updatePeriod(ctx: SchoolContext, id: string, dto: UpdatePeriodDto) {
    const period = await this.findPeriod(ctx, id);
    const updated = await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [period.schoolId]);
      await tx.$queryRaw`SELECT id FROM "SchoolYear" WHERE id = ${period.schoolYearId}::uuid FOR UPDATE`;
      const year = await tx.schoolYear.findUniqueOrThrow({ where: { id: period.schoolYearId } });
      if (year.status === 'CLOSED') throw this.yearClosed();
      // Exclusif avant toute lecture : une évaluation (période en partage) ne peut pas choisir sa date
      // selon les anciennes bornes pendant ce contrôle.
      await tx.$queryRaw`SELECT id FROM "AcademicPeriod" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.academicPeriod.findUniqueOrThrow({ where: { id } });
      const startsOn = dto.startsOn ? toDate(dto.startsOn) : current.startsOn;
      const endsOn = dto.endsOn ? toDate(dto.endsOn) : current.endsOn;
      if (startsOn >= endsOn) {
        throw new BadRequestException({
          code: 'INVALID_DATES',
          message: 'La date de fin doit suivre la date de début.',
        });
      }
      if (startsOn < year.startsOn || endsOn > year.endsOn) {
        throw new BadRequestException({
          code: 'PERIOD_OUTSIDE_YEAR',
          message: 'La période doit rester dans l’année scolaire.',
        });
      }
      const others = await tx.academicPeriod.findMany({
        where: { schoolYearId: period.schoolYearId, id: { not: id } },
        select: { startsOn: true, endsOn: true },
      });
      if (others.some((p) => periodsOverlap(p, { startsOn, endsOn }))) {
        throw new ConflictException({
          code: 'PERIOD_OVERLAP',
          message: 'Cette période chevauche une période existante.',
        });
      }
      const outside = await tx.schoolEvaluation.count({
        where: { periodId: id, OR: [{ heldOn: { lt: startsOn } }, { heldOn: { gt: endsOn } }] },
      });
      if (outside > 0) {
        throw new ConflictException({
          code: 'PERIOD_EVALUATIONS_OUTSIDE',
          message: 'Des évaluations de cette période sortiraient de ses nouvelles dates.',
        });
      }
      return tx.academicPeriod.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.labelAr !== undefined ? { labelAr: dto.labelAr } : {}),
          startsOn,
          endsOn,
        },
      });
    });
    await this.school.log(ctx, 'school.period_updated', 'AcademicPeriod', id, {
      fields: Object.keys(dto),
    });
    return updated;
  }

  /** Suppression d'une période jamais utilisée : sans évaluation, appréciation ni validation. */
  async deletePeriod(ctx: SchoolContext, id: string) {
    const period = await this.findPeriod(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [period.schoolId]);
      await tx.$queryRaw`SELECT id FROM "SchoolYear" WHERE id = ${period.schoolYearId}::uuid FOR UPDATE`;
      const year = await tx.schoolYear.findUniqueOrThrow({ where: { id: period.schoolYearId } });
      if (year.status === 'CLOSED') throw this.yearClosed();
      await tx.$queryRaw`SELECT id FROM "AcademicPeriod" WHERE id = ${id}::uuid FOR UPDATE`;
      const used = await tx.academicPeriod.findUniqueOrThrow({
        where: { id },
        select: {
          _count: {
            select: { evaluations: true, validations: true, appreciation: true, comments: true },
          },
        },
      });
      if (Object.values(used._count).some((n) => n > 0)) {
        throw new ConflictException({
          code: 'PERIOD_IN_USE',
          message: 'Cette période porte déjà des évaluations ou des résultats.',
        });
      }
      await tx.academicPeriod.delete({ where: { id } });
    });
    await this.school.log(ctx, 'school.period_deleted', 'AcademicPeriod', id, {});
    return { id };
  }

  // ─── Évaluations ───

  async listEvaluations(ctx: SchoolContext, q: EvaluationQueryDto) {
    const scope = await this.findClass(ctx, q.classId);
    const period = await this.findClassPeriod(ctx, scope, q.periodId);
    // Affectations de l'enseignant et évaluations lues dans un même instantané.
    return this.students.snapshot(async (tx) => {
      const slots = await this.slots(ctx, scope.id, tx);
      if (slots && slots.length === 0) throw this.notAssigned();
      const evaluations = await tx.schoolEvaluation.findMany({
        where: {
          organizationId: ctx.organizationId,
          classId: scope.id,
          periodId: period.id,
          ...(q.subjectId ? { subjectId: q.subjectId } : {}),
          ...(slots ? { OR: slots.map((s) => this.slotFilter(s)) } : {}),
        },
        orderBy: [{ heldOn: 'asc' }, { createdAt: 'asc' }],
        select: {
          ...EVALUATION_VIEW,
          _count: { select: { grades: true } },
        },
      });
      const validation = await this.activeValidation(tx, scope.id, period.id);
      return {
        locked: Boolean(validation),
        evaluations: evaluations.map(({ _count, ...e }) => ({
          ...this.evaluationOut(e),
          graded: _count.grades,
        })),
      };
    });
  }

  async createEvaluation(ctx: SchoolContext, dto: CreateEvaluationDto) {
    const scope = await this.findClass(ctx, dto.classId);
    if (!scope.isActive) throw this.classArchived();
    const created = await this.db.$transaction(async (tx) => {
      await this.openForWriting(tx, ctx, scope, dto.periodId);
      await this.assertTeaches(tx, ctx, scope.id, dto.subjectId, dto.groupId ?? null);
      const period = await this.lockPeriod(tx, ctx, scope, dto.periodId);
      this.assertInPeriod(dto.heldOn, period);
      await this.assertSubject(tx, ctx, scope, dto.subjectId);
      if (dto.groupId) await this.assertGroup(tx, ctx, scope, dto.groupId);
      return tx.schoolEvaluation.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: scope.schoolId,
          schoolYearId: scope.schoolYearId,
          classId: scope.id,
          groupId: dto.groupId ?? null,
          subjectId: dto.subjectId,
          periodId: period.id,
          kind: dto.kind,
          title: dto.title,
          titleAr: dto.titleAr ?? null,
          heldOn: toDate(dto.heldOn),
          maxScore: dto.maxScore,
          coefficient: dto.coefficient ?? 1,
          createdByUserId: ctx.userId,
        },
        select: EVALUATION_VIEW,
      });
    });
    await this.school.log(ctx, 'school.evaluation_created', 'SchoolEvaluation', created.id, {
      classId: scope.id,
      subjectId: dto.subjectId,
    });
    return this.evaluationOut(created);
  }

  /** Classe, matière, groupe et période d'une évaluation ne changent pas : seuls ses attributs. */
  async updateEvaluation(ctx: SchoolContext, id: string, dto: UpdateEvaluationDto) {
    const { scope, evaluation } = await this.findEvaluation(ctx, id);
    const updated = await this.db.$transaction(async (tx) => {
      await this.openForWriting(tx, ctx, scope, evaluation.periodId);
      await this.assertTeaches(tx, ctx, scope.id, evaluation.subjectId, evaluation.groupId);
      const period = await this.lockPeriod(tx, ctx, scope, evaluation.periodId);
      await this.lockEvaluation(tx, ctx, id);
      if (dto.heldOn) this.assertInPeriod(dto.heldOn, period);
      if (dto.maxScore !== undefined) {
        const above = await tx.schoolGrade.count({
          where: { evaluationId: id, score: { gt: dto.maxScore } },
        });
        if (above > 0) {
          throw new ConflictException({
            code: 'GRADES_ABOVE_MAX',
            message: 'Des notes déjà saisies dépassent ce nouveau barème.',
          });
        }
      }
      return tx.schoolEvaluation.update({
        where: { id },
        data: {
          ...(dto.kind ? { kind: dto.kind } : {}),
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.titleAr !== undefined ? { titleAr: dto.titleAr } : {}),
          ...(dto.heldOn ? { heldOn: toDate(dto.heldOn) } : {}),
          ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
          ...(dto.coefficient !== undefined ? { coefficient: dto.coefficient } : {}),
          updatedByUserId: ctx.userId,
        },
        select: EVALUATION_VIEW,
      });
    });
    await this.school.log(ctx, 'school.evaluation_updated', 'SchoolEvaluation', id, {
      fields: Object.keys(dto),
    });
    return this.evaluationOut(updated);
  }

  /** Suppression d'une évaluation jamais notée : une saisie, même effacée, garde son journal. */
  async deleteEvaluation(ctx: SchoolContext, id: string) {
    const { scope, evaluation } = await this.findEvaluation(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.openForWriting(tx, ctx, scope, evaluation.periodId);
      await this.assertTeaches(tx, ctx, scope.id, evaluation.subjectId, evaluation.groupId);
      await this.lockEvaluation(tx, ctx, id);
      const traced = await tx.schoolGradeEvent.count({ where: { evaluationId: id } });
      if (traced > 0) {
        throw new ConflictException({
          code: 'EVALUATION_GRADED',
          message: 'Cette évaluation a déjà reçu des notes : elle ne peut plus être supprimée.',
        });
      }
      await tx.schoolEvaluation.delete({ where: { id } });
    });
    await this.school.log(ctx, 'school.evaluation_deleted', 'SchoolEvaluation', id, {});
    return { id };
  }

  /** Feuille de notes : l'évaluation, les élèves concernés et leurs saisies. */
  async sheet(ctx: SchoolContext, id: string) {
    const { scope } = await this.findEvaluation(ctx, id);
    return this.students.snapshot(async (tx) => {
      const evaluation = await tx.schoolEvaluation.findUniqueOrThrow({
        where: { id },
        select: EVALUATION_VIEW,
      });
      await this.assertCanRead(ctx, tx, scope.id, evaluation.subject.id, evaluation.groupId);
      const roster = await this.concerned(tx, ctx, scope.id, evaluation.groupId);
      const grades = await tx.schoolGrade.findMany({
        where: { evaluationId: id },
        select: { studentId: true, status: true, score: true, comment: true, updatedAt: true },
      });
      const validation = await this.activeValidation(tx, scope.id, evaluation.periodId);
      const byStudent = new Map(grades.map((g) => [g.studentId, g]));
      return {
        evaluation: this.evaluationOut(evaluation),
        locked: Boolean(validation),
        students: roster.map((s) => {
          const grade = byStudent.get(s.id);
          return {
            id: s.id,
            matricule: s.matricule,
            lastName: s.lastName,
            firstName: s.firstName,
            lastNameAr: s.lastNameAr,
            firstNameAr: s.firstNameAr,
            status: grade?.status ?? null,
            score: num(grade?.score),
            comment: grade?.comment ?? null,
            updatedAt: grade?.updatedAt ?? null,
          };
        }),
      };
    });
  }

  // ─── Notes ───

  /**
   * Saisie individuelle ou en tableau. Chaque changement réel est écrit avec sa trace (avant, après,
   * auteur, motif) dans la même transaction ; une ligne inchangée n'est pas réécrite.
   */
  async saveGrades(ctx: SchoolContext, id: string, dto: SaveGradesDto) {
    const { scope, evaluation } = await this.findEvaluation(ctx, id);
    const ids = dto.grades.map((g) => g.studentId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_STUDENT',
        message: 'Un élève figure deux fois dans la saisie.',
      });
    }
    this.assertEntries(dto, Number(evaluation.maxScore));
    const changed = await this.db.$transaction(async (tx) => {
      await this.openForWriting(tx, ctx, scope, evaluation.periodId, ids);
      await this.assertTeaches(tx, ctx, scope.id, evaluation.subjectId, evaluation.groupId);
      await this.lockEvaluation(tx, ctx, id);
      // Barème relu sous le verrou : une modification concurrente de l'évaluation est déjà appliquée.
      const fresh = await tx.schoolEvaluation.findUniqueOrThrow({
        where: { id },
        select: { maxScore: true },
      });
      this.assertEntries(dto, Number(fresh.maxScore));
      const concerned = new Set(
        (await this.concerned(tx, ctx, scope.id, evaluation.groupId)).map((s) => s.id),
      );
      if (ids.some((studentId) => !concerned.has(studentId))) {
        throw new BadRequestException({
          code: 'STUDENT_NOT_CONCERNED',
          message: 'Un élève de la saisie n’est pas concerné par cette évaluation.',
        });
      }
      const existing = await tx.schoolGrade.findMany({
        where: { evaluationId: id, studentId: { in: ids } },
      });
      const before = new Map(existing.map((g) => [g.studentId, g]));
      let count = 0;
      for (const entry of dto.grades) {
        const old = before.get(entry.studentId);
        const oldValue = old ? gradeValue(old.status, num(old.score), old.comment) : null;
        const newValue =
          entry.status === null
            ? null
            : gradeValue(
                entry.status,
                entry.status === 'SCORED' ? (entry.score ?? null) : null,
                entry.comment ?? null,
              );
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
        if (newValue === null) {
          await tx.schoolGrade.delete({ where: { id: old!.id } });
        } else if (old) {
          await tx.schoolGrade.update({
            where: { id: old.id },
            data: { ...newValue, updatedByUserId: ctx.userId },
          });
        } else {
          await tx.schoolGrade.create({
            data: {
              organizationId: ctx.organizationId,
              evaluationId: id,
              studentId: entry.studentId,
              ...newValue,
              createdByUserId: ctx.userId,
              updatedByUserId: ctx.userId,
            },
          });
        }
        await tx.schoolGradeEvent.create({
          data: {
            organizationId: ctx.organizationId,
            evaluationId: id,
            studentId: entry.studentId,
            action: !old ? 'created' : newValue === null ? 'deleted' : 'updated',
            before: oldValue ?? Prisma.JsonNull,
            after: newValue ?? Prisma.JsonNull,
            reason: old ? (dto.reason ?? null) : null,
            actorUserId: ctx.userId,
          },
        });
        count += 1;
      }
      return count;
    });
    await this.school.log(ctx, 'school.grades_saved', 'SchoolEvaluation', id, { changed });
    return { changed, sheet: await this.sheet(ctx, id) };
  }

  /** Journal des notes d'un élève pour une évaluation, du plus récent au plus ancien. */
  async gradeHistory(ctx: SchoolContext, id: string, studentId: string) {
    const { scope, evaluation } = await this.findEvaluation(ctx, id);
    return this.students.snapshot(async (tx) => {
      await this.assertCanRead(ctx, tx, scope.id, evaluation.subjectId, evaluation.groupId);
      // Élève relu dans l'instantané des événements : dans le périmètre de l'utilisateur et, pour
      // l'enseignant, inscrit dans la classe et visible pour cette matière (groupe actuel compris).
      const student = await tx.schoolStudent.findFirst({
        where: {
          id: studentId,
          organizationId: ctx.organizationId,
          ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
        },
        select: {
          enrollments: { where: { classId: scope.id, status: 'VALIDATED' }, select: { id: true } },
          groups: { where: { group: { classId: scope.id } }, select: { groupId: true } },
        },
      });
      if (!student) throw new NotFoundException(NOT_FOUND);
      const slots = await this.slots(ctx, scope.id, tx);
      if (
        slots &&
        (student.enrollments.length === 0 ||
          !this.seesStudent(
            slots,
            evaluation.subjectId,
            student.groups.map((g) => g.groupId),
          ))
      ) {
        throw new NotFoundException(NOT_FOUND);
      }
      return tx.schoolGradeEvent.findMany({
        where: { organizationId: ctx.organizationId, evaluationId: id, studentId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          before: true,
          after: true,
          reason: true,
          actorUserId: true,
          createdAt: true,
        },
      });
    });
  }

  // ─── Résultats ───

  /**
   * Moyennes d'une classe pour une période. Validés, les résultats sont restitués tels que figés ;
   * sinon, calculés avec la version de règles en vigueur à la fin de la période. L'enseignant ne reçoit
   * que les matières de ses affectations, sans moyenne générale ni rang.
   */
  async results(ctx: SchoolContext, q: ClassPeriodQueryDto) {
    const scope = await this.findClass(ctx, q.classId);
    const period = await this.findClassPeriod(ctx, scope, q.periodId);
    return this.students.snapshot(async (tx) => {
      const slots = await this.slots(ctx, scope.id, tx);
      if (slots && slots.length === 0) throw this.notAssigned();
      const appreciations = await tx.schoolAppreciation.findMany({
        where: { organizationId: ctx.organizationId, classId: scope.id, periodId: period.id },
        select: { subjectId: true, studentId: true, text: true, textAr: true },
      });
      if (!slots) {
        const full = await this.compute(tx, ctx, scope, period.id);
        return {
          validation: full.validation,
          rules: full.rules,
          policyVersion: full.policyVersion,
          subjects: full.subjects,
          students: full.roster.map(studentOut),
          results: full.results,
          appreciations,
          appreciationStudents: Object.fromEntries(
            full.subjects.map((x) => [x.id, full.roster.map((st) => st.id)]),
          ),
          restricted: false,
        };
      }
      // Enseignant : calcul refait sur ses seules affectations (matières, groupes, évaluations, élèves),
      // sans moyenne générale, rang ni moyenne de classe. Ses notes étant celles d'une feuille validée
      // le cas échéant, l'état de validation est restitué tel quel.
      const validation = await this.activeValidation(tx, scope.id, period.id);
      const own = await this.computeLive(
        tx,
        ctx,
        scope,
        await tx.academicPeriod.findUniqueOrThrow({
          where: { id: period.id },
          select: { id: true, label: true, labelAr: true, endsOn: true },
        }),
        slots,
        validation
          ? {
              frozen: validation.results as unknown as FrozenResults,
              policyVersion: validation.policyVersion,
            }
          : null,
      );
      const groupsOf = new Map(own.roster.map((s) => [s.id, s.groupIds]));
      return {
        validation: validation
          ? {
              id: validation.id,
              validatedAt: validation.validatedAt,
              validatedByUserId: validation.validatedByUserId,
            }
          : null,
        rules: own.rules,
        policyVersion: own.policyVersion,
        subjects: own.subjects,
        students: own.roster.map(studentOut),
        appreciations: appreciations.filter((a) => {
          const groups = groupsOf.get(a.studentId);
          return groups !== undefined && this.seesStudent(slots, a.subjectId, groups);
        }),
        appreciationStudents: Object.fromEntries(
          own.subjects.map((x) => [
            x.id,
            own.roster
              .filter((st) => this.seesStudent(slots, x.id, st.groupIds))
              .map((st) => st.id),
          ]),
        ),
        restricted: true,
        results: {
          rankingEnabled: false,
          classAverage: null,
          subjects: own.results.subjects,
          students: own.results.students.map((s) => ({
            ...s,
            generalAverage: null,
            rankingAverage: null,
            rank: null,
            tied: false,
            passed: null,
          })),
        },
      };
    });
  }

  /**
   * Résultats complets, restitués figés si validés. Toute lecture se fait par `db` (instantané ou
   * transaction sous le verrou consultatif) : notes, élèves et règles forment un seul état.
   */
  async compute(
    db: Db,
    ctx: SchoolContext,
    scope: ClassScope,
    periodId: string,
  ): Promise<ClassPeriodResults> {
    const period = await db.academicPeriod.findUniqueOrThrow({
      where: { id: periodId },
      select: { id: true, label: true, labelAr: true, endsOn: true },
    });
    const validation = await this.activeValidation(db, scope.id, periodId);
    if (validation) return this.frozenResults(db, ctx.organizationId, scope, period, validation);
    return this.computeLive(db, ctx, scope, period);
  }

  /**
   * Résultats figés d'une validation : règles, matières, élèves et moyennes tels que validés. Ne dépend
   * d'aucun rôle : le portail parents (Sprint 6) les relit pour une publication active.
   */
  async frozenResults(
    db: Db,
    organizationId: string,
    scope: ClassScope,
    period: ClassPeriodResults['period'],
    validation: {
      id: string;
      results: Prisma.JsonValue;
      policyVersion: number | null;
      validatedAt: Date;
      validatedByUserId: string;
    },
  ): Promise<ClassPeriodResults> {
    const frozen = validation.results as unknown as FrozenResults;
    const names = await db.subject.findMany({
      where: { id: { in: frozen.subjects.map((s) => s.id) } },
      select: { id: true, name: true, nameAr: true },
    });
    const byId = new Map(names.map((s) => [s.id, s]));
    // Élèves figés par la validation, quelles que soient les inscriptions actuelles : un élève parti
    // depuis garde son bulletin, et l'effectif comme le rang restent ceux de la validation.
    const frozenIds = frozen.results.students.map((s) => s.studentId);
    const students = await db.schoolStudent.findMany({
      where: { organizationId, id: { in: frozenIds } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: ROSTER_SELECT,
    });
    const roster = students.map((s) => ({ ...s, groupIds: [] }));
    return {
      scope,
      period,
      rules: frozen.rules,
      policyVersion: validation.policyVersion,
      subjects: frozen.subjects.map((s) => ({
        id: s.id,
        name: byId.get(s.id)?.name ?? '',
        nameAr: byId.get(s.id)?.nameAr ?? null,
        coefficient: s.coefficient,
      })),
      roster,
      results: frozen.results,
      validation: {
        id: validation.id,
        validatedAt: validation.validatedAt,
        validatedByUserId: validation.validatedByUserId,
      },
    };
  }

  /**
   * Calcul sur les données actuelles. `slots` (enseignant) restreint tout le calcul à ses affectations :
   * ses matières, les évaluations qu'elles couvrent (une affectation de groupe ne couvre que les
   * évaluations de ce groupe) et les élèves concernés ; les agrégats ne portent que sur ce périmètre.
   */
  private async computeLive(
    db: Db,
    ctx: SchoolContext,
    scope: ClassScope,
    period: ClassPeriodResults['period'],
    slots: Slot[] | null = null,
    validated: { frozen: FrozenResults; policyVersion: number | null } | null = null,
  ): Promise<ClassPeriodResults> {
    const periodId = period.id;
    // Feuille validée : élèves et groupes figés par la validation, jamais l'état actuel des inscriptions.
    let roster: RosterStudent[];
    if (validated?.frozen.groups) {
      const groups = validated.frozen.groups;
      const students = await db.schoolStudent.findMany({
        where: { organizationId: ctx.organizationId, id: { in: Object.keys(groups) } },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        select: ROSTER_SELECT,
      });
      roster = students.map((st) => ({ ...st, groupIds: groups[st.id] ?? [] }));
    } else {
      roster = await this.roster(db, ctx, scope.id);
    }
    const policies = await db.gradingPolicyVersion.findMany({
      where: { organizationId: ctx.organizationId, schoolId: scope.schoolId },
      select: { version: true, effectiveFrom: true, rules: true },
    });
    const policy = policyForPeriod(policies, period.endsOn);
    // Feuille validée : règles et coefficients figés, jamais une version publiée depuis.
    const rules = validated
      ? validated.frozen.rules
      : resolveGradingRules(policy?.rules as Partial<SchoolGradingRules> | undefined);
    const policyVersion = validated ? validated.policyVersion : (policy?.version ?? null);
    let evaluations = await db.schoolEvaluation.findMany({
      where: { organizationId: ctx.organizationId, classId: scope.id, periodId },
      select: { id: true, subjectId: true, groupId: true, maxScore: true, coefficient: true },
    });
    let subjects = await this.classSubjects(
      db,
      ctx,
      scope,
      evaluations.map((e) => e.subjectId),
    );
    if (validated) {
      const frozenCoefficient = new Map(
        validated.frozen.subjects.map((x) => [x.id, x.coefficient]),
      );
      subjects = subjects.map((x) => ({
        ...x,
        coefficient: frozenCoefficient.get(x.id) ?? x.coefficient,
      }));
    }
    if (slots) {
      const mine = new Set(slots.map((s) => s.subjectId));
      subjects = subjects.filter((s) => mine.has(s.id));
      evaluations = evaluations.filter((e) => this.covers(slots, e.subjectId, e.groupId));
      roster = roster.filter((s) => this.visibleTo(slots, s.groupIds));
    }
    const grades = await db.schoolGrade.findMany({
      where: { organizationId: ctx.organizationId, evaluation: { classId: scope.id, periodId } },
      select: { evaluationId: true, studentId: true, status: true, score: true },
    });
    const results = computeClassResults({
      rules,
      subjects: subjects.map((s) => ({ id: s.id, coefficient: s.coefficient })),
      evaluations: evaluations.map((e) => ({
        id: e.id,
        subjectId: e.subjectId,
        groupId: e.groupId,
        maxScore: Number(e.maxScore),
        coefficient: Number(e.coefficient),
      })),
      grades: grades.map((g) => ({ ...g, score: num(g.score) })),
      students: roster.map((s) => ({ id: s.id, groupIds: s.groupIds })),
    });
    return {
      scope,
      period,
      rules,
      policyVersion,
      subjects,
      roster,
      results,
      validation: null,
    };
  }

  /** Appréciations d'un enseignant pour une matière ; texte vide = appréciation retirée. */
  async saveAppreciations(ctx: SchoolContext, dto: SaveAppreciationsDto) {
    const scope = await this.findClass(ctx, dto.classId);
    await this.db.$transaction(async (tx) => {
      await this.openForWriting(
        tx,
        ctx,
        scope,
        dto.periodId,
        dto.items.map((i) => i.studentId),
      );
      const allowed = await this.appreciationStudents(tx, ctx, scope, dto.subjectId);
      await this.lockPeriod(tx, ctx, scope, dto.periodId);
      for (const item of dto.items) {
        if (!allowed.has(item.studentId)) {
          throw new BadRequestException({
            code: 'STUDENT_NOT_CONCERNED',
            message: 'Un élève de la saisie n’est pas concerné par cette matière.',
          });
        }
        const key = {
          periodId_classId_subjectId_studentId: {
            periodId: dto.periodId,
            classId: scope.id,
            subjectId: dto.subjectId,
            studentId: item.studentId,
          },
        };
        // Arabe absent de la saisie (établissement en Français : champ masqué) : la traduction conservée
        // n'est ni écrasée ni supprimée ; la ligne disparaît seulement si les deux langues sont vides.
        const kept =
          item.textAr === undefined
            ? ((await tx.schoolAppreciation.findUnique({ where: key, select: { textAr: true } }))
                ?.textAr ?? null)
            : item.textAr;
        if (!item.text && !kept) {
          await tx.schoolAppreciation.deleteMany({
            where: key.periodId_classId_subjectId_studentId,
          });
          continue;
        }
        await tx.schoolAppreciation.upsert({
          where: key,
          create: {
            organizationId: ctx.organizationId,
            schoolId: scope.schoolId,
            schoolYearId: scope.schoolYearId,
            periodId: dto.periodId,
            classId: scope.id,
            subjectId: dto.subjectId,
            studentId: item.studentId,
            text: item.text,
            textAr: kept,
            authorUserId: ctx.userId,
          },
          update: { text: item.text, textAr: kept, authorUserId: ctx.userId },
        });
      }
    });
    await this.school.log(ctx, 'school.appreciations_saved', 'SchoolClass', scope.id, {
      periodId: dto.periodId,
      subjectId: dto.subjectId,
      items: dto.items.length,
    });
    return { saved: dto.items.length };
  }

  /** Appréciation générale de la direction : possible aussi après validation, jamais année clôturée. */
  async saveComments(ctx: SchoolContext, dto: SaveCommentsDto) {
    const scope = await this.findClass(ctx, dto.classId);
    await this.db.$transaction(async (tx) => {
      await this.openForWriting(
        tx,
        ctx,
        scope,
        dto.periodId,
        dto.items.map((i) => i.studentId),
        true,
      );
      await this.lockPeriod(tx, ctx, scope, dto.periodId);
      // Feuille validée : les élèves figés par la validation (bulletins conservés) ; sinon l'effectif actuel.
      const validation = await this.activeValidation(tx, scope.id, dto.periodId);
      const roster = new Set(
        validation
          ? (validation.results as unknown as FrozenResults).results.students.map(
              (x) => x.studentId,
            )
          : (await this.roster(tx, ctx, scope.id)).map((x) => x.id),
      );
      for (const item of dto.items) {
        if (!roster.has(item.studentId)) {
          throw new BadRequestException({
            code: 'STUDENT_NOT_IN_CLASS',
            message: 'Un élève de la saisie n’est pas inscrit dans cette classe.',
          });
        }
        const where = { periodId: dto.periodId, classId: scope.id, studentId: item.studentId };
        // Même règle que les appréciations : un arabe absent de la saisie est conservé.
        const kept =
          item.textAr === undefined
            ? ((
                await tx.schoolReportComment.findUnique({
                  where: { periodId_classId_studentId: where },
                  select: { textAr: true },
                })
              )?.textAr ?? null)
            : item.textAr;
        if (!item.text && !kept) {
          await tx.schoolReportComment.deleteMany({ where });
          continue;
        }
        await tx.schoolReportComment.upsert({
          where: { periodId_classId_studentId: where },
          create: {
            organizationId: ctx.organizationId,
            schoolYearId: scope.schoolYearId,
            ...where,
            text: item.text,
            textAr: kept,
            authorUserId: ctx.userId,
          },
          update: { text: item.text, textAr: kept, authorUserId: ctx.userId },
        });
      }
    });
    await this.school.log(ctx, 'school.report_comments_saved', 'SchoolClass', scope.id, {
      periodId: dto.periodId,
      items: dto.items.length,
    });
    return { saved: dto.items.length };
  }

  async listComments(ctx: SchoolContext, q: ClassPeriodQueryDto) {
    const scope = await this.findClass(ctx, q.classId);
    await this.findClassPeriod(ctx, scope, q.periodId);
    return this.db.schoolReportComment.findMany({
      where: { organizationId: ctx.organizationId, classId: scope.id, periodId: q.periodId },
      select: { studentId: true, text: true, textAr: true, updatedAt: true },
    });
  }

  /**
   * Validation par la direction : les résultats sont calculés sous le verrou consultatif (aucune note
   * ne peut s'écrire pendant ce temps), figés avec leurs règles et tracés dans la même transaction.
   */
  async validate(ctx: SchoolContext, q: ClassPeriodQueryDto) {
    const scope = await this.findClass(ctx, q.classId);
    await this.findClassPeriod(ctx, scope, q.periodId);
    const created = await this.retryOnRosterChange(() =>
      this.db.$transaction(async (tx) => {
        // Élèves de la classe verrouillés en partage (une sortie, un transfert ou un changement de classe,
        // qui prennent l'élève en exclusif, attend ; une entrée attend la classe), puis effectif, groupes
        // et notes relus sous ces verrous : l'état figé est celui d'avant ou d'après, jamais un mélange.
        const enrolled = (await this.roster(tx, ctx, scope.id)).map((s) => s.id);
        await this.openForWriting(tx, ctx, scope, q.periodId, enrolled, false, false);
        // Un élève entré avant la prise du verrou de classe n'est pas verrouillé : la transaction recommence
        // avec le nouvel effectif, sans jamais prendre un élève après la classe (ordre du module).
        const known = new Set(enrolled);
        if ((await this.roster(tx, ctx, scope.id)).some((s) => !known.has(s.id))) {
          throw new RosterChanged();
        }
        await this.lockPeriod(tx, ctx, scope, q.periodId);
        const full = await this.compute(tx, ctx, scope, q.periodId);
        const frozen: FrozenResults = {
          rules: full.rules,
          subjects: full.subjects.map((s) => ({ id: s.id, coefficient: s.coefficient })),
          results: full.results,
          groups: Object.fromEntries(full.roster.map((s) => [s.id, s.groupIds])),
        };
        const validation = await tx.schoolResultValidation.create({
          data: {
            organizationId: ctx.organizationId,
            schoolYearId: scope.schoolYearId,
            classId: scope.id,
            periodId: q.periodId,
            policyVersion: full.policyVersion,
            results: frozen as unknown as Prisma.InputJsonObject,
            validatedByUserId: ctx.userId,
          },
          select: { id: true, validatedAt: true },
        });
        await this.school.recordDecision(
          tx,
          ctx,
          'school.results_validated',
          'SchoolClass',
          scope.id,
          {
            periodId: q.periodId,
            validationId: validation.id,
            students: full.roster.length,
          },
        );
        return validation;
      }),
    );
    await this.school.publishDecisions(ctx.organizationId);
    return created;
  }

  /** Recommence une validation dont l'effectif a changé pendant la prise des verrous (trois essais). */
  private async retryOnRosterChange<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof RosterChanged)) throw error;
        if (attempt >= 3) {
          throw new ConflictException({
            code: 'RESULTS_BUSY',
            message: 'La classe change en ce moment : réessayez la validation.',
          });
        }
      }
    }
  }

  /** Réouverture motivée : la validation reste dans l'historique, le motif n'en sort pas. */
  async unlock(ctx: SchoolContext, dto: UnlockResultsDto) {
    const scope = await this.findClass(ctx, dto.classId);
    await this.findClassPeriod(ctx, scope, dto.periodId);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [scope.schoolId]);
      await this.assertYearOpen(tx, scope.schoolYearId);
      await this.lockResults(tx, scope.id, dto.periodId);
      const active = await this.activeValidation(tx, scope.id, dto.periodId);
      if (!active) {
        throw new ConflictException({
          code: 'RESULTS_NOT_VALIDATED',
          message: 'Ces résultats ne sont pas validés.',
        });
      }
      await tx.schoolResultValidation.update({
        where: { id: active.id },
        data: { unlockedAt: new Date(), unlockedByUserId: ctx.userId, unlockReason: dto.reason },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.results_unlocked',
        'SchoolClass',
        scope.id,
        {
          periodId: dto.periodId,
          validationId: active.id,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { unlocked: true };
  }

  /** Historique des validations et réouvertures d'une classe pour une période. */
  async validations(ctx: SchoolContext, q: ClassPeriodQueryDto) {
    const scope = await this.findClass(ctx, q.classId);
    await this.findClassPeriod(ctx, scope, q.periodId);
    return this.db.schoolResultValidation.findMany({
      where: { organizationId: ctx.organizationId, classId: scope.id, periodId: q.periodId },
      orderBy: { validatedAt: 'desc' },
      select: {
        id: true,
        validatedAt: true,
        validatedByUserId: true,
        unlockedAt: true,
        unlockedByUserId: true,
        unlockReason: true,
        policyVersion: true,
      },
    });
  }

  // ─── Outils partagés avec les bulletins ───

  async findClass(ctx: SchoolContext, id: string): Promise<ClassScope> {
    const cls = await this.db.schoolClass.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        name: true,
        nameAr: true,
        levelId: true,
        schoolYearId: true,
        isActive: true,
        year: { select: { schoolId: true } },
      },
    });
    if (!cls) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, cls.year.schoolId);
    return {
      id: cls.id,
      name: cls.name,
      nameAr: cls.nameAr,
      levelId: cls.levelId,
      schoolYearId: cls.schoolYearId,
      isActive: cls.isActive,
      schoolId: cls.year.schoolId,
    };
  }

  async findClassPeriod(ctx: SchoolContext, scope: ClassScope, periodId: string) {
    const period = await this.db.academicPeriod.findFirst({
      where: { id: periodId, organizationId: ctx.organizationId, schoolYearId: scope.schoolYearId },
      select: { id: true, startsOn: true, endsOn: true },
    });
    if (!period) throw new NotFoundException(NOT_FOUND);
    return period;
  }

  /**
   * Élèves de la classe : inscription validée dans cette classe (définition des Sprints 2 et 3B), avec
   * leurs groupes de la classe. Une année clôturée garde ses élèves.
   */
  async roster(db: Db, ctx: SchoolContext, classId: string): Promise<RosterStudent[]> {
    const students = await db.schoolStudent.findMany({
      where: {
        organizationId: ctx.organizationId,
        enrollments: { some: { classId, status: 'VALIDATED' } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: {
        ...ROSTER_SELECT,
        groups: { where: { group: { classId } }, select: { groupId: true } },
      },
    });
    return students.map(({ groups, ...s }) => ({ ...s, groupIds: groups.map((g) => g.groupId) }));
  }

  async activeValidation(db: Db, classId: string, periodId: string) {
    return db.schoolResultValidation.findFirst({
      where: { classId, periodId, unlockedAt: null },
    });
  }

  // ─── Outils ───

  /**
   * Matières de la classe pour une période : celles de son niveau, et celles qui portent déjà une
   * évaluation. Coefficient du niveau, à défaut celui de la matière.
   */
  private async classSubjects(
    db: Db,
    ctx: SchoolContext,
    scope: ClassScope,
    evaluated: string[],
  ): Promise<ResultsSubjectView[]> {
    const subjects = await db.subject.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: scope.schoolId,
        OR: [
          { isActive: true, levels: { some: { levelId: scope.levelId } } },
          { id: { in: evaluated } },
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        nameAr: true,
        defaultCoefficient: true,
        levels: { where: { levelId: scope.levelId }, select: { coefficient: true } },
      },
    });
    return subjects.map((s) => ({
      id: s.id,
      name: s.name,
      nameAr: s.nameAr,
      coefficient: num(s.levels[0]?.coefficient) ?? Number(s.defaultCoefficient),
    }));
  }

  /** Élèves d'une évaluation : toute la classe, ou les élèves du groupe inscrits dans la classe. */
  private async concerned(db: Db, ctx: SchoolContext, classId: string, groupId: string | null) {
    const roster = await this.roster(db, ctx, classId);
    return groupId ? roster.filter((s) => s.groupIds.includes(groupId)) : roster;
  }

  /** Élèves dont l'utilisateur peut rédiger l'appréciation pour une matière. */
  private async appreciationStudents(
    tx: Tx,
    ctx: SchoolContext,
    scope: ClassScope,
    subjectId: string,
  ): Promise<Set<string>> {
    const roster = await this.roster(tx, ctx, scope.id);
    if (!isLimitedToOwnClasses(ctx.role)) {
      await this.assertSubject(tx, ctx, scope, subjectId, true);
      return new Set(roster.map((s) => s.id));
    }
    const slots = await this.lockSlots(tx, ctx, scope.id, subjectId);
    if (slots.length === 0) throw this.notAssigned();
    if (slots.some((s) => s.groupId === null)) return new Set(roster.map((s) => s.id));
    const groups = new Set(slots.map((s) => s.groupId));
    return new Set(roster.filter((s) => s.groupIds.some((g) => groups.has(g))).map((s) => s.id));
  }

  /** Affectations actives de l'enseignant dans la classe ; null pour un rôle non limité. */
  private async slots(ctx: SchoolContext, classId: string, db: Db): Promise<Slot[] | null> {
    if (!isLimitedToOwnClasses(ctx.role)) return null;
    if (!ctx.memberId) return [];
    return db.schoolTeachingAssignment.findMany({
      where: {
        organizationId: ctx.organizationId,
        memberId: ctx.memberId,
        classId,
        endedAt: null,
        class: { year: { status: { not: 'CLOSED' } } },
      },
      select: { subjectId: true, groupId: true },
    });
  }

  /** Une évaluation de toute la classe exige une affectation à toute la classe. */
  private slotFilter(slot: Slot): Prisma.SchoolEvaluationWhereInput {
    return slot.groupId
      ? { subjectId: slot.subjectId, groupId: slot.groupId }
      : { subjectId: slot.subjectId };
  }

  /** L'enseignant voit l'élève dans au moins une de ses matières (classe entière ou groupe de l'élève). */
  private visibleTo(slots: Slot[], groupIds: string[]) {
    return slots.some((s) => s.groupId === null || groupIds.includes(s.groupId));
  }

  /** L'enseignant voit l'élève pour cette matière : affectation à toute la classe ou à son groupe. */
  private seesStudent(slots: Slot[], subjectId: string, groupIds: string[]) {
    return slots.some(
      (s) => s.subjectId === subjectId && (s.groupId === null || groupIds.includes(s.groupId)),
    );
  }

  private covers(slots: Slot[], subjectId: string, groupId: string | null) {
    return slots.some(
      (s) => s.subjectId === subjectId && (s.groupId === null || s.groupId === groupId),
    );
  }

  private async assertCanRead(
    ctx: SchoolContext,
    db: Db,
    classId: string,
    subjectId: string,
    groupId: string | null,
  ) {
    const slots = await this.slots(ctx, classId, db);
    if (slots && !this.covers(slots, subjectId, groupId)) throw this.notAssigned();
  }

  /**
   * Droit d'écriture de l'enseignant, vérifié sous verrou partagé de ses affectations : une fin
   * d'affectation (écriture sur la même ligne) attend la saisie, qui ne peut donc pas lui survivre.
   */
  private async assertTeaches(
    tx: Tx,
    ctx: SchoolContext,
    classId: string,
    subjectId: string,
    groupId: string | null,
  ) {
    if (!isLimitedToOwnClasses(ctx.role)) {
      if (!hasSchoolPermission(ctx.role, 'school.assessment.manage')) throw this.notAssigned();
      return;
    }
    const slots = await this.lockSlots(tx, ctx, classId, subjectId);
    if (!this.covers(slots, subjectId, groupId)) throw this.notAssigned();
  }

  private async lockSlots(
    tx: Tx,
    ctx: SchoolContext,
    classId: string,
    subjectId: string,
  ): Promise<Slot[]> {
    if (!ctx.memberId) return [];
    return tx.$queryRaw<Slot[]>`
      SELECT a."subjectId", a."groupId" FROM "SchoolTeachingAssignment" a
      WHERE a."organizationId" = ${ctx.organizationId}::uuid AND a."memberId" = ${ctx.memberId}::uuid
        AND a."classId" = ${classId}::uuid AND a."subjectId" = ${subjectId}::uuid
        AND a."endedAt" IS NULL
      ORDER BY a.id FOR SHARE`;
  }

  /**
   * Verrous et contrôles communs à toute écriture de résultats, dans l'ordre établi du module
   * (établissement, élève, classe, inscription ; puis affectations, période, ligne visée) :
   * - établissement en partage : la clôture d'année, exclusive, attend ;
   * - élèves visés en partage, bornés à l'établissement de la classe : un transfert, une sortie ou un
   *   changement de classe (verrou exclusif de l'élève) attend, et leurs inscriptions ne bougent plus ;
   * - classe en partage : un changement de groupe ou une fin d'affectation (verrou exclusif de la classe)
   *   attend, et la clé étrangère vers la classe ne peut plus former de cycle ;
   * - année en `KEY SHARE` avant toute période : une modification de période (année exclusive, puis
   *   période) ne peut pas croiser l'insertion qui référence l'année ;
   * - verrou consultatif de la feuille de résultats, puis contrôle de la validation.
   * `allowValidated` : appréciation générale de la direction, possible après validation.
   */
  private async openForWriting(
    tx: Tx,
    ctx: SchoolContext,
    scope: ClassScope,
    periodId: string,
    studentIds: string[] = [],
    allowValidated = false,
    strictStudents = true,
  ) {
    await this.school.guardSchools(tx, [scope.schoolId]);
    await this.assertYearOpen(tx, scope.schoolYearId);
    await this.lockStudents(tx, ctx, scope.schoolId, studentIds, strictStudents);
    await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ${scope.id}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "SchoolYear" WHERE id = ${scope.schoolYearId}::uuid FOR KEY SHARE`;
    await this.lockResults(tx, scope.id, periodId);
    if (!allowValidated && (await this.activeValidation(tx, scope.id, periodId))) {
      throw new ConflictException({
        code: 'RESULTS_VALIDATED',
        message: 'Les résultats de cette période sont validés : rouvrez-les pour modifier.',
      });
    }
  }

  /**
   * Élèves visés, verrouillés en partage dans un ordre fixe et bornés à l'organisation et à
   * l'établissement de la classe : un identifiant étranger n'est jamais verrouillé et donne 404.
   */
  private async lockStudents(
    tx: Tx,
    ctx: SchoolContext,
    schoolId: string,
    ids: string[],
    strict = true,
  ) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SchoolStudent"
      WHERE id = ANY(${unique}::uuid[]) AND "organizationId" = ${ctx.organizationId}::uuid
        AND "schoolId" = ${schoolId}::uuid
      ORDER BY id FOR SHARE`;
    // `strict` à faux (validation) : un élève déjà parti de l'établissement n'est simplement pas verrouillé.
    if (strict && rows.length !== unique.length) throw new NotFoundException(NOT_FOUND);
  }

  /**
   * Verrou consultatif de la classe et de la période, pris après le contrôle de périmètre : il sérialise
   * notes, évaluations, appréciations, validation et réouverture d'une même feuille de résultats.
   */
  /** Verrou des résultats d'une classe pour une période : validation, réouverture, publication. */
  async lockResults(tx: Tx, classId: string, periodId: string) {
    // Identifiants en minuscules : un même UUID écrit autrement par le client donne le même verrou.
    const key = `school-results:${classId.toLowerCase()}:${periodId.toLowerCase()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  /** Période de l'année de la classe, verrouillée en partage : ses dates ne changent pas d'ici la fin. */
  private async lockPeriod(tx: Tx, ctx: SchoolContext, scope: ClassScope, periodId: string) {
    const rows = await tx.$queryRaw<{ id: string; startsOn: Date; endsOn: Date }[]>`
      SELECT id, "startsOn", "endsOn" FROM "AcademicPeriod"
      WHERE id = ${periodId}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
        AND "schoolYearId" = ${scope.schoolYearId}::uuid
      FOR SHARE`;
    const period = rows[0];
    if (!period) throw new NotFoundException(NOT_FOUND);
    return period;
  }

  private async lockEvaluation(tx: Tx, ctx: SchoolContext, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SchoolEvaluation"
      WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException(NOT_FOUND);
  }

  private async assertYearOpen(tx: Tx, schoolYearId: string) {
    const { status } = await tx.schoolYear.findUniqueOrThrow({
      where: { id: schoolYearId },
      select: { status: true },
    });
    if (status === 'CLOSED') throw this.yearClosed();
  }

  private assertInPeriod(heldOn: string, period: { startsOn: Date; endsOn: Date }) {
    const day = toDate(heldOn);
    if (day < period.startsOn || day > period.endsOn) {
      throw new BadRequestException({
        code: 'EVALUATION_OUTSIDE_PERIOD',
        message: 'La date de l’évaluation doit se situer dans la période.',
      });
    }
  }

  /** Matière active de l'établissement, enseignée au niveau de la classe. */
  private async assertSubject(
    tx: Tx,
    ctx: SchoolContext,
    scope: ClassScope,
    subjectId: string,
    allowEvaluated = false,
  ) {
    const subject = await tx.subject.findFirst({
      where: { id: subjectId, organizationId: ctx.organizationId, schoolId: scope.schoolId },
      select: {
        isActive: true,
        levels: { where: { levelId: scope.levelId }, select: { levelId: true } },
      },
    });
    if (!subject) throw new NotFoundException(NOT_FOUND);
    if (allowEvaluated) return;
    if (!subject.isActive || subject.levels.length === 0) {
      throw new BadRequestException({
        code: 'SUBJECT_NOT_IN_LEVEL',
        message: 'Cette matière n’est pas une matière active enseignée au niveau de cette classe.',
      });
    }
  }

  private async assertGroup(tx: Tx, ctx: SchoolContext, scope: ClassScope, groupId: string) {
    const group = await tx.schoolClassGroup.findFirst({
      where: { id: groupId, organizationId: ctx.organizationId, classId: scope.id },
      select: { isActive: true },
    });
    if (!group?.isActive) {
      throw new BadRequestException({
        code: 'GROUP_NOT_IN_CLASS',
        message: 'Ce groupe n’est pas un groupe actif de cette classe.',
      });
    }
  }

  private assertEntries(dto: SaveGradesDto, maxScore: number) {
    for (const entry of dto.grades) {
      if (entry.status === null) continue;
      const error = gradeEntryError({ status: entry.status, score: entry.score ?? null }, maxScore);
      if (error) {
        throw new BadRequestException({
          code: 'INVALID_GRADE',
          message: error,
          studentId: entry.studentId,
        });
      }
    }
  }

  private async findPeriod(ctx: SchoolContext, id: string) {
    const period = await this.db.academicPeriod.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolYearId: true, year: { select: { schoolId: true } } },
    });
    if (!period) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, period.year.schoolId);
    return { id: period.id, schoolYearId: period.schoolYearId, schoolId: period.year.schoolId };
  }

  private async findEvaluation(ctx: SchoolContext, id: string) {
    const evaluation = await this.db.schoolEvaluation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        classId: true,
        subjectId: true,
        groupId: true,
        periodId: true,
        maxScore: true,
      },
    });
    if (!evaluation) throw new NotFoundException(NOT_FOUND);
    return { scope: await this.findClass(ctx, evaluation.classId), evaluation };
  }

  private evaluationOut<T extends { maxScore: Prisma.Decimal; coefficient: Prisma.Decimal }>(e: T) {
    return { ...e, maxScore: Number(e.maxScore), coefficient: Number(e.coefficient) };
  }

  private notAssigned() {
    return new ForbiddenException({
      code: 'TEACHER_NOT_ASSIGNED',
      message: 'Vous n’êtes pas affecté à cette matière pour cette classe ou ce groupe.',
    });
  }

  private yearClosed() {
    return new ConflictException({
      code: 'SCHOOL_YEAR_CLOSED',
      message: 'Cette année scolaire est clôturée.',
    });
  }

  private classArchived() {
    return new ConflictException({ code: 'CLASS_ARCHIVED', message: 'Cette classe est archivée.' });
  }
}

/** Identité d'un élève telle que résultats et bulletins la restituent. */
const ROSTER_SELECT = {
  id: true,
  matricule: true,
  lastName: true,
  firstName: true,
  lastNameAr: true,
  firstNameAr: true,
  birthDate: true,
} satisfies Prisma.SchoolStudentSelect;

/** Effectif modifié pendant la prise des verrous d'une validation : la transaction recommence. */
class RosterChanged extends Error {}

const EVALUATION_VIEW = {
  id: true,
  classId: true,
  periodId: true,
  groupId: true,
  kind: true,
  title: true,
  titleAr: true,
  heldOn: true,
  maxScore: true,
  coefficient: true,
  createdAt: true,
  updatedAt: true,
  subject: { select: { id: true, name: true, nameAr: true } },
  group: { select: { id: true, name: true, nameAr: true } },
} satisfies Prisma.SchoolEvaluationSelect;

/** Valeur comparable et journalisée d'une saisie. */
function gradeValue(status: SchoolGradeStatus, score: number | null, comment: string | null) {
  return { status, score, comment };
}

function studentOut(s: RosterStudent) {
  return {
    id: s.id,
    matricule: s.matricule,
    lastName: s.lastName,
    firstName: s.firstName,
    lastNameAr: s.lastNameAr,
    firstNameAr: s.firstNameAr,
    groupIds: s.groupIds,
  };
}

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}
