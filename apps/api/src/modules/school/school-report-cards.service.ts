import { Injectable, NotFoundException } from '@nestjs/common';
import type { SchoolContext } from './school-access';
import type { ClassPeriodQueryDto, ReportCardQueryDto } from './school-assessment.dto';
import {
  type ClassPeriodResults,
  type ClassScope,
  SchoolAssessmentService,
} from './school-assessment.service';
import type { Prisma } from '@ocall/school-database';
import { type ReportCardView, renderReportCards } from './school-report-card.pdf';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

/**
 * Bulletins scolaires (Sprint 4). Le PDF est produit à la demande, derrière la garde d'accès et la
 * permission « bulletins », pour le périmètre de l'utilisateur : il n'est jamais stocké et n'a donc
 * aucune adresse directe. Chaque édition est journalisée. Avant validation, il porte « Provisoire ».
 */
@Injectable()
export class SchoolReportCardsService {
  constructor(
    private readonly school: SchoolService,
    private readonly assessment: SchoolAssessmentService,
    private readonly students: SchoolStudentsService,
  ) {}

  /** Élèves de la classe avec leurs résultats, pour l'écran des bulletins et des classements. */
  async overview(ctx: SchoolContext, q: ClassPeriodQueryDto) {
    const scope = await this.assessment.findClass(ctx, q.classId);
    await this.assessment.findClassPeriod(ctx, scope, q.periodId);
    return this.students.snapshot(async (tx) => {
      const full = await this.assessment.compute(tx, ctx, scope, q.periodId);
      const comments = await tx.schoolReportComment.findMany({
        where: { organizationId: ctx.organizationId, classId: scope.id, periodId: q.periodId },
        select: { studentId: true, text: true, textAr: true },
      });
      const byStudent = new Map(full.results.students.map((r) => [r.studentId, r]));
      const comment = new Map(comments.map((c) => [c.studentId, c]));
      return {
        validation: full.validation,
        rules: full.rules,
        rankingEnabled: full.results.rankingEnabled,
        classAverage: full.results.classAverage,
        students: full.roster.map((s) => {
          const r = byStudent.get(s.id);
          return {
            id: s.id,
            matricule: s.matricule,
            lastName: s.lastName,
            firstName: s.firstName,
            lastNameAr: s.lastNameAr,
            firstNameAr: s.firstNameAr,
            generalAverage: r?.generalAverage ?? null,
            rank: r?.rank ?? null,
            tied: r?.tied ?? false,
            passed: r?.passed ?? null,
            comment: comment.get(s.id) ?? null,
          };
        }),
      };
    });
  }

  /** PDF d'un élève ou de toute la classe (une page par élève). */
  async pdf(
    ctx: SchoolContext,
    q: ReportCardQueryDto,
  ): Promise<{ file: Buffer; filename: string }> {
    const scope = await this.assessment.findClass(ctx, q.classId);
    await this.assessment.findClassPeriod(ctx, scope, q.periodId);
    const views = await this.students.snapshot(async (tx) => {
      const full = await this.assessment.compute(tx, ctx, scope, q.periodId);
      const roster = q.studentId ? full.roster.filter((s) => s.id === q.studentId) : full.roster;
      if (q.studentId && roster.length === 0) throw new NotFoundException(NOT_FOUND);
      return this.views(tx, ctx.organizationId, scope, q.periodId, full, roster);
    });
    const file = await renderReportCards(views);
    await this.school.log(ctx, 'school.report_cards_generated', 'SchoolClass', scope.id, {
      periodId: q.periodId,
      count: views.length,
      studentId: q.studentId ?? null,
    });
    const base = q.studentId
      ? `bulletin-${views[0]?.student.matricule ?? 'eleve'}`
      : 'bulletins-classe';
    return { file, filename: `${base.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
  }

  /**
   * Contenu des bulletins d'élèves d'une classe pour une période, à partir de résultats déjà calculés
   * (figés s'ils sont validés). Partagé par l'édition du personnel et le portail parents (Sprint 6).
   */
  async views(
    tx: Tx,
    organizationId: string,
    scope: ClassScope,
    periodId: string,
    full: ClassPeriodResults,
    roster: ClassPeriodResults['roster'],
  ): Promise<ReportCardView[]> {
    const school = await tx.school.findUniqueOrThrow({
      where: { id: scope.schoolId },
      select: {
        name: true,
        nameAr: true,
        address: true,
        phone: true,
        email: true,
        timezone: true,
        defaultLocale: true,
      },
    });
    const year = await tx.schoolYear.findUniqueOrThrow({
      where: { id: scope.schoolYearId },
      select: { label: true },
    });
    const appreciations = await tx.schoolAppreciation.findMany({
      where: { organizationId: organizationId, classId: scope.id, periodId: periodId },
      select: { subjectId: true, studentId: true, text: true, textAr: true },
    });
    const comments = await tx.schoolReportComment.findMany({
      where: { organizationId: organizationId, classId: scope.id, periodId: periodId },
      select: { studentId: true, text: true, textAr: true },
    });
    const appreciation = new Map(appreciations.map((a) => [`${a.subjectId}:${a.studentId}`, a]));
    const comment = new Map(comments.map((c) => [c.studentId, c]));
    const results = new Map(full.results.students.map((r) => [r.studentId, r]));
    const classAverages = new Map(full.results.subjects.map((s) => [s.subjectId, s.classAverage]));
    const ranked = full.results.students.filter((s) => s.rank !== null).length;
    const issuedOn = today(school.timezone);
    return roster.map((student): ReportCardView => {
      const r = results.get(student.id);
      const subjectResults = new Map((r?.subjects ?? []).map((s) => [s.subjectId, s]));
      return {
        locale: school.defaultLocale,
        school: {
          name: school.name,
          nameAr: school.nameAr,
          address: school.address,
          phone: school.phone,
          email: school.email,
        },
        yearLabel: year.label,
        period: { label: full.period.label, labelAr: full.period.labelAr },
        student: {
          lastName: student.lastName,
          firstName: student.firstName,
          lastNameAr: student.lastNameAr,
          firstNameAr: student.firstNameAr,
          matricule: student.matricule,
          birthDate: student.birthDate.toISOString().slice(0, 10),
        },
        class: { name: scope.name, nameAr: scope.nameAr, size: full.roster.length },
        scale: full.rules.scale,
        decimals: full.rules.decimals,
        subjects: full.subjects.map((s) => {
          const a = appreciation.get(`${s.id}:${student.id}`);
          return {
            name: s.name,
            nameAr: s.nameAr,
            coefficient: s.coefficient,
            average: subjectResults.get(s.id)?.average ?? null,
            classAverage: classAverages.get(s.id) ?? null,
            appreciation: a?.text || null,
            appreciationAr: a?.textAr ?? null,
          };
        }),
        generalAverage: r?.generalAverage ?? null,
        classAverage: full.results.classAverage,
        rankingEnabled: full.results.rankingEnabled,
        rank: r?.rank ?? null,
        tied: r?.tied ?? false,
        rankedCount: ranked,
        directionComment: comment.get(student.id)?.text || null,
        directionCommentAr: comment.get(student.id)?.textAr ?? null,
        issuedOn,
        provisional: !full.validation,
      };
    });
  }
}

/** Date du jour AAAA-MM-JJ dans le fuseau de l'établissement. */
export function today(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
