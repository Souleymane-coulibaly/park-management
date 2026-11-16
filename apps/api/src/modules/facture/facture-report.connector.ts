import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { FACTURE_PRODUCT_CODE, formatMoneyLabel } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  type OrgReportBlockData,
  type OrgReportQuery,
  OrganizationReportingRegistry,
  orgMetric,
} from '../../common/integration/organization-reporting';
import { resolveFactureContext } from './facture-access';
import { FactureBillingService, type FactureEstablishmentFilter } from './facture-billing.service';
import { FacturePrismaService } from './facture-prisma.service';

/** Devise des documents Ocall Facture (fixée par l'identité de l'entreprise). */
const FACTURE_CURRENCY = 'XOF';

/**
 * Ocall Suite étape 5 : bloc Facture du tableau de bord de l'organisation. Mêmes calculs que le tableau
 * de bord Facture, même droit (`facture.documents.read`) et même contrôle d'accès que la garde des
 * routes. Le facturé (date d'émission) et l'encaissé (date de règlement) sont deux indicateurs distincts ;
 * les factures de ventes Ocall Stock sont isolées (« dont ventes Stock ») pour ne pas compter deux fois
 * une vente déjà présente dans le bloc Stock.
 */
@Injectable()
export class FactureReportConnector implements OnModuleInit {
  constructor(
    private readonly core: PrismaService,
    private readonly db: FacturePrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly billing: FactureBillingService,
    private readonly registry: OrganizationReportingRegistry,
  ) {}

  onModuleInit() {
    this.registry.register({
      product: FACTURE_PRODUCT_CODE,
      label: 'Facture',
      order: 30,
      href: '/facture',
      report: (q) => this.report(q),
    });
  }

  async report(q: OrgReportQuery): Promise<OrgReportBlockData | null> {
    let ctx;
    try {
      ctx = await resolveFactureContext(
        { core: this.core, db: this.db, config: this.config },
        q.auth,
        'GET',
        ['facture.documents.read'],
      );
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return null;
      throw error;
    }
    const establishments = factureFilter(q);
    const [current, previous, sites] = await Promise.all([
      this.billing.dashboard(ctx, { ...q.days, timezone: q.timezone, establishments }, q.now),
      q.previousDays
        ? this.billing.dashboard(
            ctx,
            { ...q.previousDays, timezone: q.timezone, establishments },
            q.now,
          )
        : null,
      this.billing.byEstablishment(ctx, q.days, establishments),
    ]);
    const money = { currency: FACTURE_CURRENCY };
    const stock = (amount: number) =>
      amount ? `dont ventes Stock : ${formatMoneyLabel(amount, FACTURE_CURRENCY)}` : null;
    return {
      metrics: [
        orgMetric({
          id: 'invoiced',
          label: 'Facturé TTC (net des avoirs)',
          nature: 'invoiced',
          ...money,
          value: current.invoiced.netTtc,
          previous: previous?.invoiced.netTtc ?? null,
          hint: stock(current.invoiced.fromStockSales.netTtc),
        }),
        orgMetric({
          id: 'collected',
          label: 'Encaissé',
          nature: 'collected',
          ...money,
          value: current.collected.amount,
          previous: previous?.collected.amount ?? null,
          hint: stock(current.collected.fromStockSales),
        }),
        orgMetric({
          id: 'outstanding',
          label: 'Reste à encaisser (à ce jour)',
          nature: 'outstanding',
          ...money,
          value: current.outstanding.amount,
          hint: `${current.outstanding.count} facture(s) ouverte(s)`,
        }),
        orgMetric({
          id: 'overdue',
          label: 'En retard (à ce jour)',
          nature: 'overdue',
          ...money,
          value: current.overdue.amount,
          hint: `${current.overdue.count} facture(s)`,
        }),
      ],
      siteMetrics: ['invoiced', 'collected'],
      bySite: sites.map((s) => ({
        establishmentId: s.establishmentId,
        values: { invoiced: s.invoicedTtc, collected: s.collected },
      })),
      notes: [
        'Facturé : date d’émission ; encaissé : date de règlement. Les deux ne s’additionnent pas.',
        'Les factures de ventes en caisse Ocall Stock sont déjà comptées dans le bloc Stock.',
      ],
    };
  }
}

/** Filtre du tableau de bord traduit pour Facture ; absent = toute l'organisation. */
export function factureFilter(q: OrgReportQuery): FactureEstablishmentFilter | undefined {
  if (q.establishmentIds === null && q.unassigned) return undefined;
  return { ids: q.establishmentIds, unassigned: q.unassigned };
}
