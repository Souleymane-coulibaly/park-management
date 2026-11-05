import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE,
  type SchoolCurrency,
  chargeBalance,
  chargeDue,
  guardianChargeView,
  quranModuleActive,
  quranProgressSummary,
  quranSurahStates,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { SchoolAnnouncementsService } from './school-announcements.service';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAttendanceService } from './school-attendance.service';
import { type PortalScope, SchoolNotificationsService } from './school-notifications.service';
import { SchoolPaymentsService } from './school-payments.service';
import { type PortalChild, SchoolPortalAccountsService } from './school-portal-accounts.service';
import type { GuardianJustificationDto } from './school-portal.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolPublicationsService } from './school-publications.service';
import { renderReportCards } from './school-report-card.pdf';
import { SchoolReportCardsService, today } from './school-report-cards.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const RECENT_DAYS = 30;

/**
 * Portail parents (Sprint 6), lecture seule sauf le motif d'absence : chaque route vérifie d'abord le lien
 * parent-enfant autorisé (sinon introuvable). Résultats : uniquement des publications actives (jamais un
 * brouillon ni des résultats non validés). Finances : situation et reçus, sans aucune écriture.
 */
@Injectable()
export class SchoolPortalService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly accounts: SchoolPortalAccountsService,
    private readonly attendance: SchoolAttendanceService,
    private readonly publications: SchoolPublicationsService,
    private readonly assessment: SchoolAssessmentService,
    private readonly reportCards: SchoolReportCardsService,
    private readonly payments: SchoolPaymentsService,
    private readonly announcements: SchoolAnnouncementsService,
    private readonly notifications: SchoolNotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Enfants autorisés, avec la disponibilité du module coranique de leur établissement. */
  async children(userId: string) {
    const children = await this.accounts.children(userId);
    const settings = await this.db.schoolQuranSettings.findMany({
      where: { schoolId: { in: [...new Set(children.map((c) => c.schoolId))] } },
      select: { schoolId: true, enabled: true },
    });
    const enabled = new Map(settings.map((s) => [s.schoolId, s.enabled]));
    return children.map((c) => ({
      ...publicChild(c),
      quranAvailable: quranModuleActive(c.school.defaultLocale, enabled.get(c.schoolId) ?? false),
    }));
  }

  /** Tableau de bord : par enfant, présences récentes, derniers résultats, bulletins, finances. */
  async dashboard(userId: string) {
    const children = await this.accounts.children(userId);
    const scope = await this.scopeOf(children);
    const [cards, announcements, unread] = await Promise.all([
      Promise.all(children.map((c) => this.childSummary(c))),
      this.announcements.visibleFor(children, 5),
      this.notifications.unreadCount(userId, scope),
    ]);
    return { children: cards, announcements, unreadNotifications: unread };
  }

  async attendanceOf(userId: string, studentId: string, from?: string, to?: string) {
    const child = await this.accounts.child(userId, studentId);
    return this.attendance.studentRecords(child.organizationId, child.id, from, to);
  }

  /** Motif d'absence transmis par le responsable : en attente de validation par l'établissement. */
  async justify(userId: string, studentId: string, dto: GuardianJustificationDto) {
    const child = await this.accounts.child(userId, studentId);
    if (child.access !== 'full') {
      throw new ForbiddenException({
        code: 'CONTRACT_READ_ONLY',
        message: 'L’établissement ne permet plus que la consultation.',
      });
    }
    const created = await this.attendance.submitByGuardian(
      child.organizationId,
      child.schoolId,
      child.id,
      userId,
      dto,
    );
    await this.audit.record({
      organizationId: child.organizationId,
      actorUserId: userId,
      action: 'school.portal_justification_submitted',
      targetType: 'SchoolStudent',
      targetId: child.id,
      metadata: { justificationId: created.id },
    });
    return created;
  }

  /**
   * Résultats publiés : moyennes par matière, moyenne générale (rang si l'établissement l'affiche) et
   * notes des évaluations de chaque période publiée, telles que validées. Publication, validation et
   * notes sont lues dans un même instantané : une réouverture suivie d'une correction, validées après le
   * début de la lecture, n'y figurent pas (les notes ne changent pas tant que la validation est active).
   */
  async results(userId: string, studentId: string) {
    const child = await this.accounts.child(userId, studentId);
    return this.db.$transaction((tx) => this.publishedResults(tx, child), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async publishedResults(tx: Prisma.TransactionClient, child: PortalChild) {
    const published = await this.publications.activeFor(child.organizationId, child.id, tx);
    const periods = [];
    for (const p of published) {
      const full = await this.assessment.frozenResults(
        tx,
        child.organizationId,
        p.scope,
        { id: p.periodId, label: p.period.label, labelAr: p.period.labelAr, endsOn: new Date(0) },
        p.validation,
      );
      const mine = full.results.students.find((s) => s.studentId === child.id);
      const subjectResults = new Map((mine?.subjects ?? []).map((s) => [s.subjectId, s]));
      const classAverages = new Map(
        full.results.subjects.map((s) => [s.subjectId, s.classAverage]),
      );
      const evaluations = await tx.schoolEvaluation.findMany({
        where: { organizationId: child.organizationId, classId: p.scope.id, periodId: p.periodId },
        orderBy: [{ heldOn: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          subjectId: true,
          kind: true,
          title: true,
          titleAr: true,
          heldOn: true,
          maxScore: true,
          coefficient: true,
          grades: {
            where: { studentId: child.id },
            select: { status: true, score: true, comment: true },
          },
        },
      });
      periods.push({
        publicationId: p.id,
        publishedAt: p.publishedAt,
        period: { id: p.periodId, label: p.period.label, labelAr: p.period.labelAr },
        class: { id: p.scope.id, name: p.scope.name, nameAr: p.scope.nameAr },
        scale: full.rules.scale,
        decimals: full.rules.decimals,
        generalAverage: mine?.generalAverage ?? null,
        classAverage: full.results.classAverage,
        rank: full.results.rankingEnabled ? (mine?.rank ?? null) : null,
        rankedCount: full.results.rankingEnabled
          ? full.results.students.filter((s) => s.rank !== null).length
          : null,
        passed: mine?.passed ?? null,
        subjects: full.subjects.map((s) => ({
          id: s.id,
          name: s.name,
          nameAr: s.nameAr,
          coefficient: s.coefficient,
          average: subjectResults.get(s.id)?.average ?? null,
          classAverage: classAverages.get(s.id) ?? null,
          evaluations: evaluations
            .filter((e) => e.subjectId === s.id && e.grades.length > 0)
            .map((e) => ({
              id: e.id,
              kind: e.kind,
              title: e.title,
              titleAr: e.titleAr,
              heldOn: day(e.heldOn),
              maxScore: Number(e.maxScore),
              coefficient: Number(e.coefficient),
              status: e.grades[0]!.status,
              score: e.grades[0]!.score === null ? null : Number(e.grades[0]!.score),
              comment: e.grades[0]!.comment,
            })),
        })),
      });
    }
    return { periods };
  }

  /** Bulletin PDF d'une publication active, pour cet enfant seulement ; consultation journalisée. */
  async reportCard(userId: string, studentId: string, publicationId: string) {
    const child = await this.accounts.child(userId, studentId);
    const views = await this.db.$transaction(
      async (tx) => {
        // Publication relue dans l'instantané des appréciations restituées.
        const p = (await this.publications.activeFor(child.organizationId, child.id, tx)).find(
          (x) => x.id === publicationId,
        );
        if (!p) throw new NotFoundException(NOT_FOUND);
        const full = await this.assessment.frozenResults(
          tx,
          child.organizationId,
          p.scope,
          { id: p.periodId, label: p.period.label, labelAr: p.period.labelAr, endsOn: new Date(0) },
          p.validation,
        );
        const roster = full.roster.filter((s) => s.id === child.id);
        if (roster.length === 0) throw new NotFoundException(NOT_FOUND);
        return this.reportCards.views(tx, child.organizationId, p.scope, p.periodId, full, roster);
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const file = await renderReportCards(views);
    await this.audit.record({
      organizationId: child.organizationId,
      actorUserId: userId,
      action: 'school.portal_report_card_viewed',
      targetType: 'SchoolStudent',
      targetId: child.id,
      metadata: { publicationId },
    });
    return {
      file,
      filename: `bulletin-${child.matricule.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
    };
  }

  /** Situation financière : échéances (sans motif interne), encaissements et totaux, en lecture seule. */
  async finance(userId: string, studentId: string, schoolYearId?: string) {
    const child = await this.accounts.child(userId, studentId);
    const years = await this.db.schoolYear.findMany({
      where: {
        organizationId: child.organizationId,
        schoolId: child.schoolId,
        charges: { some: { studentId: child.id } },
      },
      orderBy: { startsOn: 'desc' },
      select: { id: true, label: true, status: true },
    });
    const year =
      years.find((y) => y.id === schoolYearId) ??
      years.find((y) => y.status === 'ACTIVE') ??
      years[0];
    const settings = await this.db.schoolFinanceSettings.findUnique({
      where: { schoolId: child.schoolId },
      select: { currency: true },
    });
    if (!year) {
      return {
        years,
        year: null,
        currency: settings?.currency ?? 'XOF',
        charges: [],
        payments: [],
        totals: null,
      };
    }
    const now = today(child.school.timezone);
    const [charges, payments] = await Promise.all([
      this.db.schoolCharge.findMany({
        where: { organizationId: child.organizationId, studentId: child.id, schoolYearId: year.id },
        orderBy: [{ dueOn: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      }),
      this.db.schoolPayment.findMany({
        where: {
          organizationId: child.organizationId,
          studentId: child.id,
          schoolYearId: year.id,
          kind: 'PAYMENT',
        },
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          paidAt: true,
          status: true,
          verification: true,
          receiptNumber: true,
        },
      }),
    ]);
    const views = charges.map((c) => ({
      id: c.id,
      ...guardianChargeView(
        { ...c, dueOn: day(c.dueOn)!, currency: c.currency as SchoolCurrency },
        now,
      ),
    }));
    return {
      years,
      year: { id: year.id, label: year.label },
      currency: settings?.currency ?? charges[0]?.currency ?? 'XOF',
      charges: views,
      payments,
      totals: {
        due: charges.reduce((s, c) => s + chargeDue(c), 0),
        paid: charges.reduce((s, c) => s + c.paid, 0),
        balance: charges.reduce((s, c) => s + chargeBalance(c), 0),
        overdue: views.filter((c) => c.status === 'OVERDUE').reduce((s, c) => s + c.balance, 0),
      },
    };
  }

  /** Reçu PDF d'un encaissement de cet enfant (jamais une contrepassation) ; consultation journalisée. */
  async receipt(userId: string, studentId: string, paymentId: string) {
    const child = await this.accounts.child(userId, studentId);
    const payment = await this.db.schoolPayment.findFirst({
      where: {
        id: paymentId,
        organizationId: child.organizationId,
        studentId: child.id,
        kind: 'PAYMENT',
        receiptNumber: { not: null },
      },
      select: { id: true },
    });
    if (!payment) throw new NotFoundException(NOT_FOUND);
    const receipt = await this.payments.receiptFile(payment.id);
    await this.audit.record({
      organizationId: child.organizationId,
      actorUserId: userId,
      action: 'school.portal_receipt_viewed',
      targetType: 'SchoolPayment',
      targetId: payment.id,
    });
    return receipt;
  }

  /**
   * Mémorisation du Coran : seulement si le module est actif pour l'établissement ; sinon introuvable,
   * comme pour une école non éligible. Observations des enseignants : seulement celles autorisées.
   */
  async quran(userId: string, studentId: string) {
    const child = await this.accounts.child(userId, studentId);
    const settings = await this.db.schoolQuranSettings.findUnique({
      where: { schoolId: child.schoolId },
      select: { enabled: true },
    });
    if (!quranModuleActive(child.school.defaultLocale, settings?.enabled ?? false)) {
      throw new NotFoundException(NOT_FOUND);
    }
    const [progress, evaluations] = await Promise.all([
      this.db.schoolQuranProgress.findMany({
        where: { organizationId: child.organizationId, studentId: child.id },
        select: { surah: true, status: true, memorizedOn: true, lastReviewedOn: true },
      }),
      this.db.schoolQuranEvaluation.findMany({
        where: { organizationId: child.organizationId, studentId: child.id },
        orderBy: [{ evaluatedOn: 'desc' }, { sequence: 'desc' }],
        take: 100,
        select: {
          id: true,
          surah: true,
          status: true,
          evaluatedOn: true,
          remark: true,
          remarkShared: true,
        },
      }),
    ]);
    const states = progress.map((p) => ({
      surah: p.surah,
      status: p.status,
      memorizedOn: day(p.memorizedOn),
      lastReviewedOn: day(p.lastReviewedOn),
    }));
    return {
      summary: quranProgressSummary(states),
      surahs: quranSurahStates(states),
      evaluations: evaluations.map(({ remark, remarkShared, ...e }) => ({
        ...e,
        evaluatedOn: day(e.evaluatedOn),
        remark: remarkShared ? remark : null,
      })),
    };
  }

  /** Annonces visibles, 50 par page : les plus anciennes restent accessibles par les pages suivantes. */
  async announcementsFor(userId: string, page = 0) {
    return this.announcements.visibleFor(
      await this.accounts.children(userId),
      SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE,
      page * SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE,
    );
  }

  /** Périmètre des notifications : enfants autorisés et annonces qui les visent aujourd'hui. */
  async scope(userId: string): Promise<PortalScope> {
    return this.scopeOf(await this.accounts.children(userId));
  }

  private async scopeOf(children: PortalChild[]): Promise<PortalScope> {
    return {
      studentIds: children.map((c) => c.id),
      announcementIds: await this.announcements.visibleIds(children),
    };
  }

  private async childSummary(child: PortalChild) {
    const now = today(child.school.timezone);
    const since = new Date(Date.parse(`${now}T00:00:00.000Z`) - RECENT_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [attendance, published, charges, quranSettings] = await Promise.all([
      this.attendance.studentRecords(child.organizationId, child.id, since, now),
      this.publications.activeFor(child.organizationId, child.id),
      this.db.schoolCharge.findMany({
        where: {
          organizationId: child.organizationId,
          studentId: child.id,
          year: { status: 'ACTIVE' },
        },
      }),
      this.db.schoolQuranSettings.findUnique({
        where: { schoolId: child.schoolId },
        select: { enabled: true },
      }),
    ]);
    const latest = published[0];
    let latestResult: {
      period: string;
      periodAr: string | null;
      generalAverage: number | null;
      scale: number;
    } | null = null;
    if (latest) {
      const frozen = latest.validation.results as unknown as {
        rules: { scale: number };
        results: { students: { studentId: string; generalAverage: number | null }[] };
      };
      latestResult = {
        period: latest.period.label,
        periodAr: latest.period.labelAr,
        generalAverage:
          frozen.results.students.find((s) => s.studentId === child.id)?.generalAverage ?? null,
        scale: frozen.rules.scale,
      };
    }
    const views = charges.map((c) =>
      guardianChargeView(
        { ...c, dueOn: day(c.dueOn)!, currency: c.currency as SchoolCurrency },
        now,
      ),
    );
    return {
      ...publicChild(child),
      attendance: {
        stats: attendance.stats,
        recent: attendance.records.filter((r) => r.status !== 'PRESENT').slice(0, 5),
      },
      latestResult,
      reportCards: published.length,
      finance: {
        currency: charges[0]?.currency ?? null,
        balance: views.reduce((s, c) => s + c.balance, 0),
        overdue: views.filter((c) => c.status === 'OVERDUE').reduce((s, c) => s + c.balance, 0),
      },
      quranAvailable: quranModuleActive(
        child.school.defaultLocale,
        quranSettings?.enabled ?? false,
      ),
    };
  }
}

/** Enfant tel que renvoyé au portail : sans les identifiants internes de ciblage. */
function publicChild(c: PortalChild) {
  const { guardianIds: _guardians, ...rest } = c;
  return rest;
}
