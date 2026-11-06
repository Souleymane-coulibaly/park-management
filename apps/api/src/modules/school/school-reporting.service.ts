import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  REPORT_MAX_CLASS_PERIODS,
  SCHOOL_REPORT_FILTERS,
  type SchoolReportKind,
  type SchoolAttendanceStatus,
  type SchoolCurrency,
  SchoolPermission,
  averageDistribution,
  attendanceStatsFromCounts,
  hasSchoolPermission,
  insufficientSample,
  meanOf,
  passRate,
  rateOf,
  trendOf,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolPaymentsService } from './school-payments.service';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { buildReportDocument } from './school-report-builders';
import { type ReportLocale, reportCsv, reportPdf, reportXlsx } from './school-report-export';
import type {
  AuditQueryDto,
  CreateReportViewDto,
  ReportExportQueryDto,
  ReportFiltersDto,
} from './school-reporting.dto';
import { SchoolImportsService } from './school-imports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const VIEW_SELECT = { id: true, name: true, kind: true, filters: true, createdAt: true } as const;

/** Identité commune d'un rapport : établissement, année, période couverte et filtres appliqués. */
export interface ReportHeader {
  school: { id: string; name: string; nameAr: string | null; defaultLocale: string };
  year: { id: string; label: string; startsOn: string; endsOn: string };
  from: string;
  to: string;
  filters: { classId: string | null; periodId: string | null };
  filterNames: {
    class: { name: string; nameAr: string | null } | null;
    period: { label: string; labelAr: string | null } | null;
  };
  generatedOn: string;
  /** Vrai avant le premier jour de l'année : indicateurs de préparation, aucune donnée de suivi. */
  yearNotStarted: boolean;
}

/**
 * Reporting d'Ocall School (Sprint 8). Un seul point de calcul des indicateurs, réutilisé par les écrans,
 * les exports et les outils de l'IA (Sprint 8, Ocall School AI) : aucun second système de reporting.
 *
 * - Les moyennes viennent du moteur de notes du Sprint 4 (`SchoolAssessmentService.compute`, résultats
 *   figés quand ils sont validés) : aucune règle de calcul n'est réinterprétée ici.
 * - Les finances viennent du tableau de bord du Sprint 5 (frais scolaires, jamais les abonnements SaaS).
 * - Les présences sont agrégées par la base (une ligne par classe et statut), sans nom d'élève.
 * - Chaque lecture passe par `findYear` (organisation et périmètre d'établissements de l'utilisateur) ;
 *   le bloc financier n'est calculé que pour un rôle qui a la permission des rapports financiers.
 */
@Injectable()
export class SchoolReportingService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly assessment: SchoolAssessmentService,
    private readonly payments: SchoolPaymentsService,
    private readonly exports: SchoolImportsService,
    private readonly core: PrismaService,
  ) {}

  /** Année contrôlée (organisation et périmètre), établissement et bornes de dates du rapport. */
  async header(
    ctx: SchoolContext,
    q: ReportFiltersDto,
    kind: SchoolReportKind,
  ): Promise<ReportHeader> {
    // Filtre inapplicable à ce rapport : refusé plutôt qu'affiché sans effet.
    const allowed = SCHOOL_REPORT_FILTERS[kind];
    const unsupported = (['classId', 'periodId', 'from', 'to'] as const).filter(
      (key) => q[key] !== undefined && !allowed.includes(key),
    );
    if (unsupported.length) {
      throw new UnprocessableEntityException({
        code: 'REPORT_FILTER_UNSUPPORTED',
        message: `Filtre non applicable à ce rapport : ${unsupported.join(', ')}.`,
      });
    }
    const year = await this.school.findYear(ctx, q.schoolYearId);
    const school = await this.db.school.findUniqueOrThrow({
      where: { id: year.schoolId },
      select: { id: true, name: true, nameAr: true, defaultLocale: true, timezone: true },
    });
    const now = today(school.timezone);
    const yearEnd = day(year.endsOn);
    const yearStart = day(year.startsOn);
    // Année pas encore commencée (activée à l'avance) : sans borne saisie, la période se réduit au premier
    // jour de l'année ; les indicateurs disponibles (classes, inscriptions préparées) restent servis.
    const yearNotStarted = now < yearStart;
    const from = q.from ?? yearStart;
    const to = q.to ?? (yearNotStarted ? (q.from ?? yearStart) : now < yearEnd ? now : yearEnd);
    // Erreur réservée aux bornes incohérentes saisies par l'utilisateur.
    if (from > to) {
      throw new UnprocessableEntityException({
        code: 'REPORT_INVALID_RANGE',
        message: 'La date de début doit précéder la date de fin.',
      });
    }
    const cls = q.classId ? await this.assertClassInYear(ctx, q.classId, year.id) : null;
    const period = q.periodId
      ? await this.db.academicPeriod.findFirst({
          where: { id: q.periodId, organizationId: ctx.organizationId, schoolYearId: year.id },
          select: { label: true, labelAr: true },
        })
      : null;
    if (q.periodId && !period) {
      throw new UnprocessableEntityException({
        code: 'REPORT_PERIOD_OUTSIDE_YEAR',
        message: 'Cette période n’appartient pas à l’année choisie.',
      });
    }
    return {
      school: {
        id: school.id,
        name: school.name,
        nameAr: school.nameAr,
        defaultLocale: school.defaultLocale,
      },
      year: { id: year.id, label: year.label, startsOn: day(year.startsOn), endsOn: yearEnd },
      from,
      to,
      filters: { classId: q.classId ?? null, periodId: q.periodId ?? null },
      // Libellés des filtres, tirés des seuls objets autorisés ci-dessus (exports).
      filterNames: {
        class: cls ? { name: cls.name, nameAr: cls.nameAr } : null,
        period: period ? { label: period.label, labelAr: period.labelAr } : null,
      },
      generatedOn: now,
      yearNotStarted,
    };
  }

  // ─── Tableau de bord de direction ───

  /**
   * Indicateurs d'une année : élèves actifs, classes, enseignants, répartition par classe, assiduité,
   * résultats de la dernière période commencée et, si le rôle le permet, frais facturés, encaissés et
   * impayés. Toutes les données viennent des tables existantes.
   */
  async overview(ctx: SchoolContext, q: ReportFiltersDto) {
    const header = await this.header(ctx, q, 'overview');
    const yearId = header.year.id;
    const { classes, students, teachers } = await this.students.snapshot(async (tx) => {
      const classRows = await tx.schoolClass.findMany({
        where: { organizationId: ctx.organizationId, schoolYearId: yearId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, nameAr: true, capacity: true },
      });
      const placed = await tx.schoolEnrollment.groupBy({
        by: ['classId'],
        where: { organizationId: ctx.organizationId, schoolYearId: yearId, status: 'VALIDATED' },
        _count: { _all: true },
      });
      const active = await tx.schoolEnrollment.count({
        where: { organizationId: ctx.organizationId, schoolYearId: yearId, status: 'VALIDATED' },
      });
      const teaching = await tx.schoolTeachingAssignment.findMany({
        where: {
          organizationId: ctx.organizationId,
          endedAt: null,
          class: { schoolYearId: yearId },
        },
        distinct: ['memberId'],
        select: { memberId: true },
      });
      const count = new Map(placed.map((p) => [p.classId, p._count._all]));
      return {
        classes: classRows.map((c) => ({ ...c, students: count.get(c.id) ?? 0 })),
        students: { active, unplaced: count.get(null) ?? 0 },
        teachers: teaching.length,
      };
    });
    const attendance = await this.attendanceTotals(ctx, header);
    const results = await this.latestResults(ctx, header);
    const finance = hasSchoolPermission(ctx.role, SchoolPermission.FINANCE_REPORTS)
      ? await this.financeSummary(ctx, header)
      : null;
    return {
      ...header,
      students,
      classCount: classes.length,
      teachers,
      byClass: classes,
      attendance,
      results,
      finance,
    };
  }

  // ─── Reporting pédagogique ───

  /**
   * Résultats par classe, matière et période : moyenne de classe, taux de réussite, répartition des
   * moyennes générales, évolution d'une période à l'autre ; puis les mêmes indicateurs pour l'établissement
   * (moyenne des moyennes de classe). Une statistique sur moins de 3 élèves est signalée insuffisante.
   */
  async pedagogy(ctx: SchoolContext, q: ReportFiltersDto) {
    const header = await this.header(ctx, q, 'pedagogy');
    const periods = await this.db.academicPeriod.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: header.year.id,
        ...(q.periodId ? { id: q.periodId } : {}),
      },
      orderBy: { position: 'asc' },
      select: { id: true, label: true, labelAr: true, startsOn: true, endsOn: true },
    });
    const classes = await this.db.schoolClass.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: header.year.id,
        isActive: true,
        ...(q.classId ? { id: q.classId } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    this.assertComputable(classes.length * periods.length);
    // Périmètres lus avant la transaction : aucune lecture hors transaction pendant l'instantané.
    const scopes = await this.scopesOf(ctx, classes);
    const computed = await this.students.snapshot(async (tx) => {
      const out = [];
      for (const scope of scopes) {
        const rows = [];
        for (const p of periods) rows.push(await this.assessment.compute(tx, ctx, scope, p.id));
        out.push({ scope, rows });
      }
      return out;
    });
    const periodViews = periods.map((p) => ({
      id: p.id,
      label: p.label,
      labelAr: p.labelAr,
      startsOn: day(p.startsOn),
      endsOn: day(p.endsOn),
    }));
    const classViews = computed.map(({ scope, rows }) => {
      const byPeriod = rows.map((r) => {
        const averages = r.results.students.map((s) => s.generalAverage);
        const graded = averages.filter((a) => a !== null).length;
        const names = new Map(r.subjects.map((s) => [s.id, s]));
        return {
          periodId: r.period.id,
          scale: r.rules.scale,
          passMark: r.rules.passMark,
          validated: r.validation !== null,
          students: r.roster.length,
          graded,
          insufficient: insufficientSample(graded),
          classAverage: r.results.classAverage,
          passRate: passRate(r.results.students.map((s) => s.passed)),
          admitted: r.results.students.filter((s) => s.passed === true).length,
          withResult: r.results.students.filter((s) => s.passed !== null).length,
          distribution: averageDistribution(averages, r.rules.scale),
          subjects: r.results.subjects.map((s) => {
            // Élèves ayant une moyenne dans la matière (résultats du moteur du Sprint 4, sans recalcul).
            const subjectGraded = r.results.students.filter((st) =>
              st.subjects.some((x) => x.subjectId === s.subjectId && x.average !== null),
            ).length;
            return {
              subjectId: s.subjectId,
              name: names.get(s.subjectId)?.name ?? '',
              nameAr: names.get(s.subjectId)?.nameAr ?? null,
              classAverage: s.classAverage,
              min: s.min,
              max: s.max,
              graded: subjectGraded,
              insufficient: insufficientSample(subjectGraded),
            };
          }),
        };
      });
      const scale = byPeriod[0]?.scale ?? 20;
      // Barème différent d'une période à l'autre (60/100 puis 12/20) : aucune tendance ni écart, les
      // moyennes du moteur du Sprint 4 ne sont pas comparables et ne sont jamais renormalisées ici.
      const scaleChanged = new Set(byPeriod.map((p) => p.scale)).size > 1;
      return {
        id: scope.id,
        name: scope.name,
        nameAr: scope.nameAr,
        periods: byPeriod,
        scaleChanged,
        trend: scaleChanged
          ? { direction: 'INSUFFICIENT' as const, delta: null, from: null, to: null }
          : trendOf(
              byPeriod.map((p) => ({ key: p.periodId, value: p.classAverage })),
              scale,
            ),
      };
    });
    // Matières de l'établissement : moyenne des moyennes de classe, par période, puis tendance.
    const subjectIndex = new Map<string, { name: string; nameAr: string | null }>();
    for (const c of classViews)
      for (const p of c.periods)
        for (const s of p.subjects)
          subjectIndex.set(s.subjectId, { name: s.name, nameAr: s.nameAr });
    const scales = new Set(classViews.flatMap((c) => c.periods.map((p) => p.scale)));
    const commonScale = scales.size === 1 ? [...scales][0]! : null;
    const subjects = [...subjectIndex].map(([subjectId, names]) => {
      const byPeriod = periodViews.map((p) => {
        const agg = meanOnCommonScale(
          classViews.flatMap((c) =>
            c.periods
              .filter((x) => x.periodId === p.id)
              .flatMap((x) =>
                x.subjects
                  .filter((s) => s.subjectId === subjectId)
                  .map((s) => ({ value: s.classAverage, scale: x.scale, graded: s.graded })),
              ),
          ),
        );
        // Effectif de la matière sur la période (toutes classes) : réserve sous 3 élèves notés.
        const graded = classViews
          .flatMap((c) => c.periods.filter((x) => x.periodId === p.id))
          .flatMap((x) => x.subjects.filter((s) => s.subjectId === subjectId))
          .reduce((n, s) => n + s.graded, 0);
        return { periodId: p.id, ...agg, graded, insufficient: insufficientSample(graded) };
      });
      return {
        subjectId,
        ...names,
        byPeriod,
        trend: commonScale
          ? trendOf(
              byPeriod.map((v) => ({ key: v.periodId, value: v.average })),
              commonScale,
            )
          : null,
      };
    });
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    const schoolByPeriod = periodViews.map((p) => {
      const rows = classViews.flatMap((c) => c.periods.filter((x) => x.periodId === p.id));
      const graded = rows.reduce((s, r) => s + r.graded, 0);
      // Moyenne d'établissement : seulement entre classes notées sur le même barème.
      const agg = meanOnCommonScale(rows.map((r) => ({ value: r.classAverage, scale: r.scale })));
      return {
        periodId: p.id,
        average: agg.average,
        scale: agg.scale,
        scaleMixed: agg.scaleMixed,
        graded,
        insufficient: insufficientSample(graded),
        passRate: passRateOfRows(rows),
      };
    });
    return {
      ...header,
      scale: commonScale,
      // Plusieurs barèmes (classes ou périodes) : tendances et écarts d'établissement suspendus.
      scaleMixed: scales.size > 1,
      periods: periodViews,
      school: header.school,
      schoolByPeriod,
      schoolTrend: commonScale
        ? trendOf(
            schoolByPeriod.map((p) => ({ key: p.periodId, value: p.average })),
            commonScale,
          )
        : null,
      classes: classViews,
      subjects,
    };
  }

  // ─── Assiduité ───

  /**
   * Présences, absences et retards sur la période : par classe (taux d'absence, minutes de retard), par
   * mois, et classe la plus touchée. Agrégats seulement : aucun nom d'élève.
   */
  async attendance(ctx: SchoolContext, q: ReportFiltersDto) {
    const header = await this.header(ctx, q, 'attendance');
    const byClassStatus = await this.db.$queryRaw<
      { classId: string; status: SchoolAttendanceStatus; n: number; late: number }[]
    >`
      SELECT s."classId", r."status", COUNT(*)::int AS "n",
        COALESCE(SUM(r."minutesLate"), 0)::int AS "late"
      FROM "SchoolAttendanceRecord" r
      JOIN "SchoolAttendanceSession" s ON s."id" = r."sessionId"
      WHERE r."organizationId" = ${ctx.organizationId}::uuid
        AND s."schoolYearId" = ${header.year.id}::uuid
        AND s."date" BETWEEN ${header.from}::date AND ${header.to}::date
        AND (${q.classId ?? null}::uuid IS NULL OR s."classId" = ${q.classId ?? null}::uuid)
      GROUP BY s."classId", r."status"`;
    const byMonthStatus = await this.db.$queryRaw<
      { month: string; status: SchoolAttendanceStatus; n: number }[]
    >`
      SELECT to_char(s."date", 'YYYY-MM') AS "month", r."status", COUNT(*)::int AS "n"
      FROM "SchoolAttendanceRecord" r
      JOIN "SchoolAttendanceSession" s ON s."id" = r."sessionId"
      WHERE r."organizationId" = ${ctx.organizationId}::uuid
        AND s."schoolYearId" = ${header.year.id}::uuid
        AND s."date" BETWEEN ${header.from}::date AND ${header.to}::date
        AND (${q.classId ?? null}::uuid IS NULL OR s."classId" = ${q.classId ?? null}::uuid)
      GROUP BY 1, r."status"
      ORDER BY 1`;
    const sessions = await this.db.schoolAttendanceSession.groupBy({
      by: ['classId'],
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: header.year.id,
        date: { gte: toDate(header.from), lte: toDate(header.to) },
        ...(q.classId ? { classId: q.classId } : {}),
      },
      _count: { _all: true },
    });
    const classes = await this.db.schoolClass.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: header.year.id,
        ...(q.classId ? { id: q.classId } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nameAr: true },
    });
    const sessionCount = new Map(sessions.map((s) => [s.classId, s._count._all]));
    const byClass = classes.map((c) => {
      const rows = byClassStatus.filter((r) => r.classId === c.id);
      const stats = attendanceStatsFromCounts(Object.fromEntries(rows.map((r) => [r.status, r.n])));
      return {
        id: c.id,
        name: c.name,
        nameAr: c.nameAr,
        ...stats,
        // `records` : relevés élève × appel ; `sessions` : appels faits dans la classe.
        records: stats.sessions,
        sessions: sessionCount.get(c.id) ?? 0,
        absenceRate: rateOf(stats.absent + stats.excused, stats.sessions),
        lateRate: rateOf(stats.late, stats.sessions),
        minutesLate: rows.reduce((s, r) => s + r.late, 0),
      };
    });
    const months = [...new Set(byMonthStatus.map((r) => r.month))];
    const totalCounts: Partial<Record<SchoolAttendanceStatus, number>> = {};
    for (const r of byClassStatus) totalCounts[r.status] = (totalCounts[r.status] ?? 0) + r.n;
    const total = attendanceStatsFromCounts(totalCounts);
    const ranked = byClass
      .filter((c) => c.absenceRate !== null)
      .sort((a, b) => b.absenceRate! - a.absenceRate! || a.name.localeCompare(b.name));
    return {
      ...header,
      total: {
        ...total,
        absenceRate: rateOf(total.absent + total.excused, total.sessions),
        lateRate: rateOf(total.late, total.sessions),
      },
      byClass,
      byMonth: months.map((month) => {
        const stats = attendanceStatsFromCounts(
          Object.fromEntries(
            byMonthStatus.filter((r) => r.month === month).map((r) => [r.status, r.n]),
          ),
        );
        return {
          month,
          ...stats,
          absenceRate: rateOf(stats.absent + stats.excused, stats.sessions),
        };
      }),
      mostAbsent: ranked[0]
        ? { id: ranked[0].id, name: ranked[0].name, absenceRate: ranked[0].absenceRate }
        : null,
      insufficient: total.sessions === 0,
    };
  }

  // ─── Finances (Sprint 5, frais scolaires) ───

  /** Tableau de bord financier du Sprint 5, avec l'identité commune des rapports. */
  async finance(ctx: SchoolContext, q: ReportFiltersDto) {
    this.assertFinance(ctx);
    const header = await this.header(ctx, q, 'finance');
    // Filtre de dates actif : le calcul reçoit les bornes résolues et AFFICHÉES par l'en-tête (une seule
    // borne saisie est complétée par le début ou la fin de l'année), jamais une borne ouverte.
    const dated = Boolean(q.from || q.to);
    const dashboard = (await this.payments.dashboard(ctx, {
      schoolYearId: header.year.id,
      classId: q.classId,
      ...(dated ? { from: header.from, to: header.to } : {}),
    })) as FinanceDashboard;
    return { ...header, ...dashboard };
  }

  // ─── Exports ───

  /**
   * Export d'un rapport autorisé, filtres actifs compris : PDF, XLSX ou CSV, avec le nom de l'école, le
   * titre et la période. Le financier exige la permission des rapports financiers. Les exports passent par
   * les créneaux d'export partagés (mémoire bornée) et sont journalisés sans contenu.
   */
  async export(ctx: SchoolContext, q: ReportExportQueryDto) {
    if (q.kind === 'finance') this.assertFinance(ctx);
    const result = await this.exports.exportSlot(async () => {
      const data =
        q.kind === 'overview'
          ? await this.overview(ctx, q)
          : q.kind === 'pedagogy'
            ? await this.pedagogy(ctx, q)
            : q.kind === 'attendance'
              ? await this.attendance(ctx, q)
              : await this.finance(ctx, q);
      const locale: ReportLocale = data.school.defaultLocale === 'AR' ? 'AR' : 'FR';
      const doc = buildReportDocument(
        q.kind,
        data,
        locale,
        this.filterLabels(data.filterNames, locale),
      );
      this.exports.assertExportSize(doc.sections.reduce((n, s) => n + s.table.rows.length, 0));
      const name = `rapport-${q.kind}-${data.year.label}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const file =
        q.format === 'pdf'
          ? { body: await reportPdf(doc, locale, data.generatedOn), mimeType: 'application/pdf' }
          : q.format === 'xlsx'
            ? {
                body: await reportXlsx(doc, locale),
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }
            : { body: reportCsv(doc, locale), mimeType: 'text/csv; charset=utf-8' };
      return { ...file, fileName: `${name}.${q.format}`, yearId: data.year.id };
    });
    await this.school.log(ctx, 'school.report_exported', 'SchoolYear', result.yearId, {
      kind: q.kind,
      format: q.format,
      classId: q.classId ?? null,
      periodId: q.periodId ?? null,
    });
    return result;
  }

  /** Rapports financiers : permission vérifiée par le serveur, pour tout point d'entrée. */
  assertFinance(ctx: SchoolContext) {
    if (!hasSchoolPermission(ctx.role, SchoolPermission.FINANCE_REPORTS)) {
      throw new ForbiddenException({
        code: 'SCHOOL_FORBIDDEN',
        message: 'Les rapports financiers ne sont pas accessibles à votre rôle.',
      });
    }
  }

  /** Filtres lisibles (classe, période scolaire), dans la langue de l'export. */
  private filterLabels(names: ReportHeader['filterNames'], locale: ReportLocale): string[] {
    const labels: string[] = [];
    if (names.class)
      labels.push(locale === 'AR' ? names.class.nameAr || names.class.name : names.class.name);
    if (names.period) {
      labels.push(
        locale === 'AR' ? names.period.labelAr || names.period.label : names.period.label,
      );
    }
    return labels;
  }

  // ─── Vues de reporting enregistrées ───

  /** Vues de l'utilisateur pour un établissement de son périmètre. */
  async views(ctx: SchoolContext, schoolId: string): Promise<ReportViewRow[]> {
    await this.school.assertSchool(ctx, schoolId);
    return this.db.schoolReportView.findMany({
      where: { organizationId: ctx.organizationId, schoolId, ownerUserId: ctx.userId },
      orderBy: { name: 'asc' },
      select: VIEW_SELECT,
    });
  }

  async createView(ctx: SchoolContext, dto: CreateReportViewDto): Promise<ReportViewRow> {
    await this.school.assertSchool(ctx, dto.schoolId);
    if (dto.kind === 'finance') this.assertFinance(ctx);
    // Seuls les filtres applicables à ce rapport sont conservés : identifiants et dates, en texte court.
    const filters: Record<string, string> = {};
    const allowed = SCHOOL_REPORT_FILTERS[dto.kind];
    for (const key of ['classId', 'periodId'] as const) {
      if (!allowed.includes(key)) continue;
      const v = dto.filters[key];
      if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) filters[key] = v.toLowerCase();
    }
    for (const key of ['from', 'to'] as const) {
      if (!allowed.includes(key)) continue;
      const v = dto.filters[key];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) filters[key] = v;
    }
    const count = await this.db.schoolReportView.count({
      where: { organizationId: ctx.organizationId, ownerUserId: ctx.userId },
    });
    if (count >= 50) {
      throw new UnprocessableEntityException({
        code: 'REPORT_VIEWS_LIMIT',
        message: 'Vous avez atteint 50 vues enregistrées : supprimez-en une.',
      });
    }
    return this.db.schoolReportView.create({
      data: {
        organizationId: ctx.organizationId,
        schoolId: dto.schoolId,
        ownerUserId: ctx.userId,
        name: dto.name.trim(),
        kind: dto.kind,
        filters,
      },
      select: VIEW_SELECT,
    });
  }

  async deleteView(ctx: SchoolContext, id: string) {
    const deleted = await this.db.schoolReportView.deleteMany({
      where: { id, organizationId: ctx.organizationId, ownerUserId: ctx.userId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException({
        code: 'SCHOOL_RESOURCE_NOT_FOUND',
        message: 'Élément introuvable.',
      });
    }
    return { ok: true };
  }

  // ─── Historique des opérations sensibles ───

  /**
   * Journal d'audit School du client (actions « school.* »), paginé par 50, du plus récent au plus ancien.
   * Il couvre tous les établissements : la permission n'est donnée qu'à la direction du groupe. Les
   * métadonnées journalisées ne contiennent jamais de contenu sensible (identifiants et compteurs).
   */
  async audit(ctx: SchoolContext, q: AuditQueryDto): Promise<AuditPage> {
    const page = q.page ?? 1;
    const where = {
      organizationId: ctx.organizationId,
      action: { startsWith: q.action ?? 'school.' },
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: toDate(q.from) } : {}),
              ...(q.to ? { lt: new Date(toDate(q.to).getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.core.auditLog.count({ where }),
      this.core.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 50,
        take: 50,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          actorUserId: true,
          createdAt: true,
        },
      }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.core.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const name = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim()]));
    return {
      page,
      pageSize: 50,
      total,
      items: rows.map((r) => ({
        ...r,
        actor: r.actorUserId ? (name.get(r.actorUserId) ?? null) : null,
      })),
    };
  }

  // ─── Outils ───

  private async assertClassInYear(ctx: SchoolContext, classId: string, yearId: string) {
    const scope = await this.assessment.findClass(ctx, classId);
    if (scope.schoolYearId !== yearId) {
      throw new UnprocessableEntityException({
        code: 'REPORT_CLASS_OUTSIDE_YEAR',
        message: 'Cette classe n’appartient pas à l’année choisie.',
      });
    }
    return scope;
  }

  /** Périmètres des classes (organisation et établissements de l'utilisateur), hors transaction. */
  private async scopesOf(ctx: SchoolContext, classes: readonly { id: string }[]) {
    const scopes = [];
    for (const c of classes) scopes.push(await this.assessment.findClass(ctx, c.id));
    return scopes;
  }

  private assertComputable(count: number) {
    if (count > REPORT_MAX_CLASS_PERIODS) {
      throw new UnprocessableEntityException({
        code: 'REPORT_TOO_LARGE',
        message: 'Rapport trop volumineux : choisissez une classe ou une période.',
      });
    }
  }

  private async attendanceTotals(ctx: SchoolContext, header: ReportHeader) {
    const counts = await this.db.$queryRaw<{ status: SchoolAttendanceStatus; n: number }[]>`
      SELECT r."status", COUNT(*)::int AS "n"
      FROM "SchoolAttendanceRecord" r
      JOIN "SchoolAttendanceSession" s ON s."id" = r."sessionId"
      WHERE r."organizationId" = ${ctx.organizationId}::uuid
        AND s."schoolYearId" = ${header.year.id}::uuid
        AND s."date" BETWEEN ${header.from}::date AND ${header.to}::date
      GROUP BY r."status"`;
    const stats = attendanceStatsFromCounts(Object.fromEntries(counts.map((c) => [c.status, c.n])));
    return { ...stats, absenceRate: rateOf(stats.absent + stats.excused, stats.sessions) };
  }

  /** Résultats de la dernière période commencée : moyenne et réussite par classe, puis de l'école. */
  private async latestResults(ctx: SchoolContext, header: ReportHeader) {
    const period = await this.db.academicPeriod.findFirst({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: header.year.id,
        startsOn: { lte: toDate(header.generatedOn) },
      },
      orderBy: { position: 'desc' },
      select: { id: true, label: true, labelAr: true },
    });
    if (!period) return null;
    const classes = await this.db.schoolClass.findMany({
      where: { organizationId: ctx.organizationId, schoolYearId: header.year.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    this.assertComputable(classes.length);
    const scopes = await this.scopesOf(ctx, classes);
    const rows = await this.students.snapshot(async (tx) => {
      const out = [];
      for (const scope of scopes) {
        const r = await this.assessment.compute(tx, ctx, scope, period.id);
        const graded = r.results.students.filter((s) => s.generalAverage !== null).length;
        out.push({
          id: scope.id,
          name: scope.name,
          nameAr: scope.nameAr,
          classAverage: r.results.classAverage,
          scale: r.rules.scale,
          passRate: passRate(r.results.students.map((s) => s.passed)),
          graded,
          insufficient: graded > 0 && insufficientSample(graded),
          admitted: r.results.students.filter((s) => s.passed === true).length,
          withResult: r.results.students.filter((s) => s.passed !== null).length,
        });
      }
      return out;
    });
    const agg = meanOnCommonScale(rows.map((r) => ({ value: r.classAverage, scale: r.scale })));
    const graded = rows.reduce((s, r) => s + r.graded, 0);
    return {
      period,
      // Barèmes différents entre classes : moyenne d'établissement indisponible (jamais mélangée).
      average: agg.average,
      scale: agg.scale,
      scaleMixed: agg.scaleMixed,
      passRate: passRateOfRows(rows),
      graded,
      // Moins de 3 élèves notés (période notée) : réserve, comme dans le rapport pédagogique.
      insufficient: graded > 0 && insufficientSample(graded),
      byClass: rows,
    };
  }

  private async financeSummary(ctx: SchoolContext, header: ReportHeader) {
    const d = (await this.payments.dashboard(ctx, {
      schoolYearId: header.year.id,
    })) as FinanceDashboard;
    return {
      currency: d.currency,
      expected: d.expected,
      collected: d.collected,
      balance: d.balance,
      overdueAmount: d.overdueAmount,
      overdueCharges: d.overdueCharges,
      studentsInArrears: d.studentsInArrears,
    };
  }
}

/** Forme du tableau de bord financier du Sprint 5 (`SchoolPaymentsService.dashboard`). */
export interface FinanceDashboard {
  currency: SchoolCurrency;
  today: string;
  expected: number;
  collected: number;
  periodCollected: number | null;
  balance: number;
  discounts: number;
  overdueCharges: number;
  overdueAmount: number;
  studentsInArrears: number;
  collectionsByMonth: { month: string; amount: number }[];
  collectionsByMethod: { method: string; amount: number }[];
  byClass: {
    classId: string | null;
    className: string;
    levelName: string;
    expected: number;
    collected: number;
    balance: number;
    periodCollected: number | null;
  }[];
}

/** Réussite globale : élèves admis sur élèves ayant un résultat, toutes classes confondues. */
/**
 * Moyenne de moyennes notées sur un même barème. Barèmes différents (60/100 et 12/20) : moyenne
 * indisponible et `scaleMixed`, jamais un mélange ni une renormalisation des résultats du Sprint 4.
 */
function meanOnCommonScale(items: readonly { value: number | null; scale: number }[]): {
  average: number | null;
  scale: number | null;
  scaleMixed: boolean;
} {
  const known = items.filter((i) => i.value !== null);
  const scales = new Set(known.map((i) => i.scale));
  if (scales.size > 1) return { average: null, scale: null, scaleMixed: true };
  return {
    average: meanOf(known.map((i) => i.value)),
    scale: scales.size === 1 ? [...scales][0]! : null,
    scaleMixed: false,
  };
}

function passRateOfRows(rows: readonly { admitted: number; withResult: number }[]) {
  return rateOf(
    rows.reduce((s, r) => s + r.admitted, 0),
    rows.reduce((s, r) => s + r.withResult, 0),
  );
}

export interface ReportViewRow {
  id: string;
  name: string;
  kind: string;
  filters: unknown;
  createdAt: Date;
}

export interface AuditPage {
  page: number;
  pageSize: number;
  total: number;
  items: {
    id: string;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: unknown;
    actorUserId: string | null;
    createdAt: Date;
    actor: string | null;
  }[];
}
