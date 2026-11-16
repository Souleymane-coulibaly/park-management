import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { SCHOOL_PRODUCT_CODE } from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  type OrgReportBlockData,
  type OrgReportQuery,
  OrganizationReportingRegistry,
  orgMetric,
  orgReportKeeps,
} from '../../common/integration/organization-reporting';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';
import { resolveSchoolContext } from './school-access';
import type { ReportQueryDto } from './school-finance.dto';
import { SchoolPaymentsService } from './school-payments.service';
import { SchoolPrismaService } from './school-prisma.service';

/** Droit du tableau de bord financier School. */
const FINANCE_REPORTS = 'school.finance.reports';

/**
 * Ocall Suite étape 5 : bloc School du tableau de bord de l'organisation. Pour chaque école visible par
 * le membre (rôle ∩ contrats, même contrôle que la garde School) et retenue par le filtre (rattachement
 * explicite de l'école au référentiel, sinon « Non rattaché ») : année scolaire en cours, encaissements de
 * la période (fuseau de l'école), reste à percevoir et élèves inscrits. Chaque école a sa devise : les
 * montants sont regroupés par devise, jamais additionnés entre devises.
 */
@Injectable()
export class SchoolReportConnector implements OnModuleInit {
  constructor(
    private readonly contracts: SuiteContractsService,
    private readonly db: SchoolPrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: SchoolPaymentsService,
    private readonly registry: OrganizationReportingRegistry,
  ) {}

  onModuleInit() {
    this.registry.register({
      product: SCHOOL_PRODUCT_CODE,
      label: 'School',
      order: 50,
      href: '/school/rapports',
      report: (q) => this.report(q),
    });
  }

  async report(q: OrgReportQuery): Promise<OrgReportBlockData | null> {
    let ctx;
    try {
      ctx = await resolveSchoolContext(
        { contracts: this.contracts, db: this.db, config: this.config },
        q.auth,
        { method: 'GET', permission: FINANCE_REPORTS },
      );
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return null;
      throw error;
    }
    const schools = (
      await this.db.school.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(ctx.schoolIds ? { id: { in: ctx.schoolIds } } : {}),
        },
        select: { id: true, name: true, establishmentId: true },
        orderBy: { name: 'asc' },
      })
    ).filter((s) => orgReportKeeps(q, s.establishmentId));

    const results = await Promise.all(
      schools.map(async (school) => {
        const year = await this.db.schoolYear.findFirst({
          where: { organizationId: ctx.organizationId, schoolId: school.id, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!year) return { school, year: null, finance: null, students: 0 };
        const [finance, students] = await Promise.all([
          this.payments.dashboard(ctx, {
            schoolYearId: year.id,
            from: q.days.from,
            to: q.days.to,
          } as ReportQueryDto),
          this.db.schoolEnrollment.count({
            where: {
              organizationId: ctx.organizationId,
              schoolYearId: year.id,
              status: 'VALIDATED',
            },
          }),
        ]);
        return { school, year, finance, students };
      }),
    );

    const currencies = [
      ...new Set(results.flatMap((r) => (r.finance ? [r.finance.currency] : []))),
    ].sort();
    const suffix = (c: string) => (currencies.length > 1 ? `.${c}` : '');
    const metrics = currencies.flatMap((c) => {
      const inCurrency = results.filter((r) => r.finance?.currency === c);
      const label = currencies.length > 1 ? ` (${c})` : '';
      return [
        orgMetric({
          id: `collected${suffix(c)}`,
          label: `Encaissé${label}`,
          nature: 'collected',
          currency: c,
          value: inCurrency.reduce((s, r) => s + (r.finance?.periodCollected ?? 0), 0),
        }),
        orgMetric({
          id: `outstanding${suffix(c)}`,
          label: `Reste à percevoir${label} (année en cours)`,
          nature: 'outstanding',
          currency: c,
          value: inCurrency.reduce((s, r) => s + (r.finance?.balance ?? 0), 0),
        }),
      ];
    });
    metrics.push(
      orgMetric({
        id: 'students',
        label: 'Élèves inscrits (année en cours)',
        nature: 'count',
        value: results.reduce((s, r) => s + r.students, 0),
      }),
    );

    const byEstablishment = new Map<string | null, Record<string, number>>();
    for (const r of results) {
      const row = byEstablishment.get(r.school.establishmentId) ?? {};
      if (r.finance) {
        const key = `collected${suffix(r.finance.currency)}`;
        row[key] = (row[key] ?? 0) + (r.finance.periodCollected ?? 0);
      }
      row.students = (row.students ?? 0) + r.students;
      byEstablishment.set(r.school.establishmentId, row);
    }
    const withoutYear = results.filter((r) => !r.year).length;
    return {
      metrics,
      siteMetrics: [...currencies.map((c) => `collected${suffix(c)}`), 'students'],
      bySite: [...byEstablishment].map(([establishmentId, values]) => ({
        establishmentId,
        values,
      })),
      notes: [
        ...(currencies.length > 1
          ? ['Écoles en plusieurs devises : montants présentés par devise, jamais additionnés.']
          : []),
        ...(withoutYear ? [`${withoutYear} école(s) sans année scolaire en cours.`] : []),
      ],
      message: schools.length === 0 ? 'Aucune école dans ce périmètre.' : null,
      // Rapports School : par école et par année scolaire (choix dans l'écran).
      detailParams: { period: null, from: null, to: null, establishmentId: null },
    };
  }
}
