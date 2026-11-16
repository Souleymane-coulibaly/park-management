import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type Activity,
  PARK_PRODUCT_CODE,
  activitiesOf,
  formatMoneyLabel,
  hasPermission,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { loadParkAccess } from '../../common/park-access';
import {
  type OrgReportBlockData,
  type OrgReportQuery,
  OrganizationReportingRegistry,
  orgMetric,
} from '../../common/integration/organization-reporting';
import { AnalyticsService } from './analytics.service';
import { type AnalyticsScope, resolveAnalyticsScope } from './analytics-scope';

/** Code du bloc Restaurant (activité de l'application Ocall Park, abonnement commun). */
export const RESTAURANT_REPORT_CODE = 'OCALL_PARK_RESTAURANT';

/**
 * Ocall Suite étape 5 : blocs Park (billetterie) et Restaurant du tableau de bord de l'organisation.
 * Mêmes calculs et même périmètre que les analyses (`/analytics`) : encaissements (date d'encaissement),
 * établissements visibles par le membre, heure locale de chaque établissement. Droit exigé : celui des
 * analyses (`analytics.read`) dans une organisation dont l'application Park est ouverte.
 */
@Injectable()
export class AnalyticsReportConnector implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly registry: OrganizationReportingRegistry,
  ) {}

  onModuleInit() {
    this.registry.register({
      product: PARK_PRODUCT_CODE,
      label: 'Parc — billetterie',
      order: 10,
      href: '/app/analytics/parc',
      report: (q) => this.report(q, 'PARK'),
    });
    this.registry.register({
      product: RESTAURANT_REPORT_CODE,
      label: 'Restaurant',
      order: 20,
      href: '/app/analytics/restaurant',
      report: (q) => this.report(q, 'RESTAURANT'),
    });
  }

  async report(q: OrgReportQuery, activity: Activity): Promise<OrgReportBlockData | null> {
    const scope = await this.scope(q, activity);
    if (!scope) return null;
    if (scope.establishmentIds.length === 0) {
      return {
        metrics: this.metrics(activity, q, null, null),
        siteMetrics: [],
        bySite: [],
        message:
          activity === 'PARK'
            ? 'Aucun parc dans ce périmètre.'
            : 'Aucun restaurant dans ce périmètre.',
        // Les analyses ne connaissent que les établissements Park : lien sans filtre.
        detailParams: { establishmentId: null },
      };
    }
    const [overview, sites] = await Promise.all([
      this.analytics.overview(scope),
      this.analytics.establishments(scope),
    ]);
    const counter = activity === 'PARK' ? 'visitors' : 'orders';
    return {
      metrics: this.metrics(activity, q, overview, sites.consolidated.averageBasket),
      siteMetrics: ['collected', counter],
      bySite: sites.rows.map((r) => ({
        establishmentId: r.establishmentId,
        values: {
          collected: r.revenueByActivity[activity] ?? 0,
          [counter]: (activity === 'PARK' ? r.visitors : r.orders) ?? 0,
        },
      })),
    };
  }

  /**
   * Périmètre des analyses pour cette activité, réduit au filtre du tableau de bord ; null si le bloc
   * n'a pas lieu d'être (application Park fermée, activité non couverte, droit des analyses absent).
   */
  private async scope(q: OrgReportQuery, activity: Activity): Promise<AnalyticsScope | null> {
    const { membership } = q.auth;
    if (membership.role === 'PRODUCT_USER') return null;
    if (!hasPermission(membership.role, 'analytics.read')) return null;
    if (!activitiesOf(membership.businessType).includes(activity)) return null;
    if ((await loadParkAccess(this.prisma, membership.organizationId, q.now)) === 'none')
      return null;
    let scope: AnalyticsScope;
    try {
      scope = await resolveAnalyticsScope(
        this.prisma,
        q.auth,
        { period: q.period.period, from: q.days.from, to: q.days.to },
        { activity, now: q.now },
      );
    } catch (error) {
      if (error instanceof BadRequestException) return null;
      throw error;
    }
    // Filtre du tableau de bord : un établissement précis, ou aucun (« Non rattaché » : tout lieu Park
    // est un établissement, rien n'y est donc « non rattaché »).
    const establishments =
      q.establishmentIds === null
        ? scope.establishments
        : scope.establishments.filter((e) => q.establishmentIds!.includes(e.id));
    return { ...scope, establishments, establishmentIds: establishments.map((e) => e.id) };
  }

  private metrics(
    activity: Activity,
    q: OrgReportQuery,
    overview: Awaited<ReturnType<AnalyticsService['overview']>> | null,
    averageBasket: number | null,
  ) {
    const money = { nature: 'collected' as const, currency: q.currency };
    const metrics = [
      orgMetric({
        id: 'collected',
        label: activity === 'PARK' ? 'Billetterie encaissée' : 'Ventes encaissées',
        ...money,
        value: overview?.revenue.current ?? 0,
        previous: overview?.revenue.previous ?? null,
        hint:
          activity === 'RESTAURANT' && averageBasket !== null
            ? `Panier moyen : ${formatMoneyLabel(averageBasket, q.currency)}`
            : null,
      }),
      orgMetric({
        id: 'paidSales',
        label: 'Ventes payées',
        nature: 'count',
        value: overview?.paidSales.current ?? 0,
        previous: overview?.paidSales.previous ?? null,
      }),
    ];
    if (activity === 'PARK') {
      metrics.push(
        orgMetric({
          id: 'visitors',
          label: 'Entrées contrôlées',
          nature: 'count',
          value: overview?.visitors?.current ?? 0,
          previous: overview?.visitors?.previous ?? null,
        }),
      );
    } else {
      metrics.push(
        orgMetric({
          id: 'orders',
          label: 'Commandes',
          nature: 'count',
          value: overview?.orders?.current ?? 0,
          previous: overview?.orders?.previous ?? null,
        }),
      );
    }
    return metrics;
  }
}
