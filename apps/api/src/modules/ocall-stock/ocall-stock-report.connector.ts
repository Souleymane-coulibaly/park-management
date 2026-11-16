import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { STOCK_PRODUCT_CODE, type StockPermission, formatMoneyLabel } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { loadAppAccess } from '../../common/app-access';
import {
  type OrgReportBlockData,
  type OrgReportQuery,
  OrganizationReportingRegistry,
  orgMetric,
  orgReportKeeps,
} from '../../common/integration/organization-reporting';
import { type StockContext, stockMemberRights } from './ocall-stock-access';
import { OcallStockPrismaService } from './ocall-stock-prisma.service';
import { OcallStockReportsService } from './ocall-stock-reports.service';

/** Droits du tableau de bord Stock : l'un d'eux suffit, chaque section garde le sien. */
const DASHBOARD_PERMISSIONS: StockPermission[] = [
  'stock.sales.read',
  'stock.levels.read',
  'stock.purchases.read',
  'stock.movements.read',
];

/**
 * Ocall Suite étape 5 : bloc Stock du tableau de bord de l'organisation. Mêmes calculs et mêmes droits
 * que le tableau de bord Stock (rôle Stock, rôle par boutique, sections masquées sans leur droit) ; une
 * application non ouverte (dont `COMING_SOON` sans essai) ne produit aucun bloc. Une boutique compte pour
 * l'établissement auquel elle est rattachée, sinon dans « Non rattaché ».
 */
@Injectable()
export class OcallStockReportConnector implements OnModuleInit {
  constructor(
    private readonly core: PrismaService,
    private readonly db: OcallStockPrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reports: OcallStockReportsService,
    private readonly registry: OrganizationReportingRegistry,
  ) {}

  onModuleInit() {
    this.registry.register({
      product: STOCK_PRODUCT_CODE,
      label: 'Stock',
      order: 40,
      href: '/stock',
      report: (q) => this.report(q),
    });
  }

  /** Contexte Stock du membre, comme la garde de la route du tableau de bord ; null sans droit. */
  async context(q: OrgReportQuery): Promise<StockContext | null> {
    if (!this.config.stock.enabled) return null;
    const organizationId = q.auth.membership.organizationId;
    const access = await loadAppAccess(this.core, organizationId, STOCK_PRODUCT_CODE, q.now);
    if (access === 'none') return null;
    const rights = await stockMemberRights(
      this.db,
      organizationId,
      q.auth.user.id,
      q.auth.membership.role,
      DASHBOARD_PERMISSIONS,
    );
    if (!rights || !DASHBOARD_PERMISSIONS.some((p) => rights.permissions.includes(p))) return null;
    return { organizationId, userId: q.auth.user.id, access, ...rights };
  }

  async report(q: OrgReportQuery): Promise<OrgReportBlockData | null> {
    const ctx = await this.context(q);
    if (!ctx) return null;
    // Boutiques retenues par le filtre (rattachement explicite au référentiel, jamais déduit).
    let siteIds: string[] | undefined;
    if (!(q.establishmentIds === null && q.unassigned)) {
      const sites = await this.db.stockSite.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, establishmentId: true },
      });
      siteIds = sites.filter((s) => orgReportKeeps(q, s.establishmentId)).map((s) => s.id);
    }
    const dashboard = await this.reports.dashboard(
      ctx,
      { from: q.days.from, to: q.days.to, siteIds },
      { timezone: q.timezone, now: q.now },
    );
    const money = { currency: q.currency };
    const metrics = [];
    const siteMetrics: string[] = [];
    if (dashboard.sales) {
      metrics.push(
        orgMetric({
          id: 'collected',
          label: 'Ventes en caisse encaissées',
          nature: 'collected',
          ...money,
          value: dashboard.sales.revenue,
          hint: dashboard.sales.refunds
            ? `Retours remboursés : ${formatMoneyLabel(dashboard.sales.refunds, q.currency)} — net ${formatMoneyLabel(dashboard.sales.netRevenue, q.currency)}`
            : null,
        }),
        orgMetric({ id: 'sales', label: 'Ventes', nature: 'count', value: dashboard.sales.count }),
      );
      siteMetrics.push('collected', 'sales');
    }
    if (dashboard.stock && dashboard.stock.value !== null) {
      metrics.push(
        orgMetric({
          id: 'stockValue',
          label: 'Valeur du stock (à ce jour)',
          nature: 'stock_value',
          ...money,
          value: dashboard.stock.value,
        }),
      );
      siteMetrics.push('stockValue');
    }
    if (dashboard.alerts) {
      metrics.push(
        orgMetric({
          id: 'alerts',
          label: 'Ruptures et stocks bas',
          nature: 'count',
          value: dashboard.alerts.outOfStock + dashboard.alerts.low,
        }),
      );
    }
    const byEstablishment = new Map<string | null, Record<string, number>>();
    for (const site of dashboard.sites) {
      const row = byEstablishment.get(site.establishmentId) ?? {};
      if (site.revenue !== null) row.collected = (row.collected ?? 0) + site.revenue;
      if (site.salesCount !== null) row.sales = (row.sales ?? 0) + site.salesCount;
      if (siteMetrics.includes('stockValue') && site.stockValue !== null) {
        row.stockValue = (row.stockValue ?? 0) + site.stockValue;
      }
      byEstablishment.set(site.establishmentId, row);
    }
    return {
      metrics,
      siteMetrics,
      bySite: [...byEstablishment].map(([establishmentId, values]) => ({
        establishmentId,
        values,
      })),
      notes: ['Ventes en caisse Ocall Stock ; leur facture éventuelle figure aussi dans Facture.'],
      message: siteIds && siteIds.length === 0 ? 'Aucune boutique dans ce périmètre.' : null,
    };
  }
}
