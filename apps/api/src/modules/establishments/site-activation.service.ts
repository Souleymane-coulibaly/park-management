import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { billedSiteCount, billedSiteSources } from '@ocall/shared';
import {
  type BillableSite,
  SITE_REGISTRY,
  type SiteRegistry,
} from '../../common/integration/site-registry';
import { PrismaService } from '../../prisma/prisma.service';

/** Rapprochement horaire des activations des abonnements par site (hors tests). */
const SYNC_INTERVAL_MS = 60 * 60_000;

/** Site facturé d'un abonnement : une clé, ses applications sources, sa première activation ouverte. */
export interface BilledSite {
  siteKey: string;
  label: string;
  sources: string[];
  startedAt: Date;
}

/**
 * Ocall Suite étape 6 : activations des applications sur les sites (base du décompte facturé et du
 * prorata). Les sites facturables sont lus dans chaque application par le référentiel commun ; une
 * activation s'ouvre quand un site apparaît, se ferme quand il disparaît (jamais supprimée). Le décompte
 * d'un abonnement réunit ses applications sources (Ocall Park couvre parc et restaurant tant que la
 * séparation commerciale n'est pas activée) ; un même établissement n'y compte qu'une fois.
 */
@Injectable()
export class SiteActivationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SiteActivations');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SITE_REGISTRY) private readonly registry: SiteRegistry,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.syncPerSiteOrganizations().catch((e: unknown) =>
        this.logger.error(`Rapprochement des sites : ${String(e)}`),
      );
    }, SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Rapproche les activations ouvertes d'une application source avec ses sites facturables : ouvre les
   * nouveaux, ferme ceux qui ont disparu. Lecture impossible d'une application : erreur 503, rien n'est
   * fermé (jamais de décompte sous-estimé).
   */
  async sync(organizationId: string, source: string, now = new Date()): Promise<void> {
    const current = await this.read(organizationId, source);
    const keys = new Set(current.map((s) => s.siteKey));
    // Colonnes « timestamp » sans fuseau, en UTC comme celles écrites par Prisma : jamais l'heure de session.
    const at = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    await this.prisma.$transaction(async (tx) => {
      await tx.siteActivation.updateMany({
        where: {
          organizationId,
          productCode: source,
          endedAt: null,
          siteKey: { notIn: [...keys] },
        },
        data: { endedAt: now },
      });
      for (const site of current) {
        // Index unique partiel : une seule activation ouverte par site, même en concurrence.
        await tx.$executeRaw`
          INSERT INTO "SiteActivation"
            ("id", "organizationId", "productCode", "siteKey", "establishmentId", "label", "startedAt", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${organizationId}::uuid, ${source}, ${site.siteKey},
                  ${site.establishmentId}::uuid, ${site.label}, ${at}, ${at}, ${at})
          ON CONFLICT ("organizationId", "productCode", "siteKey") WHERE "endedAt" IS NULL
          DO UPDATE SET "label" = EXCLUDED."label", "updatedAt" = EXCLUDED."updatedAt"
          WHERE "SiteActivation"."label" IS DISTINCT FROM EXCLUDED."label"`;
      }
    });
  }

  /**
   * Nombre de sites qui seraient facturés aujourd'hui pour le produit (au moins un), sans rien
   * enregistrer : devis du portail et des demandes d'activation.
   */
  async countLive(organizationId: string, productCode: string): Promise<number> {
    const keys = new Set<string>();
    for (const source of billedSiteSources(productCode)) {
      for (const site of await this.read(organizationId, source)) keys.add(site.siteKey);
    }
    return billedSiteCount(keys);
  }

  /** Sites facturables d'une application source ; lecture impossible : 503 (jamais sous-estimé). */
  private async read(organizationId: string, source: string): Promise<BillableSite[]> {
    try {
      return await this.registry.billableSites(organizationId, source);
    } catch (error) {
      this.logger.warn(`Sites ${source} illisibles : ${String(error)}`);
      throw new ServiceUnavailableException({
        code: 'SITE_COUNT_UNAVAILABLE',
        message: 'Décompte des sites indisponible : réessayez dans quelques instants.',
      });
    }
  }

  /** Sites facturés d'un abonnement au produit `productCode`, après rapprochement de ses sources. */
  async billedSites(
    organizationId: string,
    productCode: string,
    now = new Date(),
  ): Promise<BilledSite[]> {
    const sources = billedSiteSources(productCode);
    for (const source of sources) await this.sync(organizationId, source, now);
    const open = await this.prisma.siteActivation.findMany({
      where: { organizationId, productCode: { in: sources }, endedAt: null },
      select: { siteKey: true, label: true, productCode: true, startedAt: true },
      orderBy: [{ startedAt: 'asc' }, { siteKey: 'asc' }],
    });
    const out = new Map<string, BilledSite>();
    for (const a of open) {
      const site = out.get(a.siteKey);
      if (site) site.sources.push(a.productCode);
      else
        out.set(a.siteKey, {
          siteKey: a.siteKey,
          label: a.label,
          sources: [a.productCode],
          startedAt: a.startedAt,
        });
    }
    return [...out.values()];
  }

  /**
   * Décompte d'un abonnement par site, enregistré sur l'abonnement (revenu mensuel des écrans Ocall).
   * Retourne les sites facturés.
   */
  async refreshSubscription(
    subscriptionId: string,
    now = new Date(),
  ): Promise<{ sites: BilledSite[]; count: number } | null> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        organizationId: true,
        product: { select: { code: true } },
        plan: { select: { pricingMode: true } },
      },
    });
    if (!sub || sub.plan.pricingMode !== 'PER_SITE') return null;
    const sites = await this.billedSites(sub.organizationId, sub.product.code, now);
    const count = billedSiteCount(sites.map((s) => s.siteKey));
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { billedSiteCount: count },
    });
    return { sites, count };
  }

  /** Rapprochement horaire : abonnements par site en cours (les offres forfaitaires ne comptent rien). */
  async syncPerSiteOrganizations(now = new Date()): Promise<{ synced: number; failed: number }> {
    const subs = await this.prisma.subscription.findMany({
      where: { plan: { pricingMode: 'PER_SITE' }, status: { not: 'CANCELED' } },
      select: { id: true },
      take: 2_000,
    });
    let synced = 0;
    let failed = 0;
    for (const s of subs) {
      try {
        await this.refreshSubscription(s.id, now);
        synced += 1;
      } catch (error) {
        failed += 1;
        if (!(error instanceof ServiceUnavailableException)) {
          this.logger.error(`Abonnement ${s.id} : ${String(error)}`);
        }
      }
    }
    return { synced, failed };
  }
}
