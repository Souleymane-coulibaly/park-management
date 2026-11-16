import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  PARK_APP_PRODUCT_CODES,
  activitiesOf,
  proposeParkRestaurantSplit,
  subscriptionMonthlyAmount,
  commercialAppName,
  PARK_COMMERCIAL_CODE,
  RESTAURANT_COMMERCIAL_CODE,
  isValidSwitchSplit,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import {
  MONTHLY_AMOUNT_PLAN_SELECT,
  MONTHLY_AMOUNT_SUB_SELECT,
  freezeAgreedPrices,
  recordPriceChange,
} from '../../common/subscription-billing';
import { SiteActivationService } from '../establishments/site-activation.service';
import { notifyOrganization } from '../../common/suite-notify';

type Tx = Prisma.TransactionClient;
const EXPIRY_INTERVAL_MS = 60 * 60_000;

/**
 * Actions d'administration d'un abonnement (Sprint 12A, A49) : suspendre, réactiver, résilier,
 * changer d'offre ; historique des tarifs ; passage automatique en « expiré » des abonnements
 * échus (A28). Aucune de ces actions n'encaisse ni ne prolonge quoi que ce soit : la prolongation
 * reste liée à un encaissement confirmé.
 */
@Injectable()
export class SubscriptionAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Subscriptions');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly siteActivations: SiteActivationService,
  ) {}

  onModuleInit() {
    // Hors tests : vérification horaire. Idempotente ; chaque instance peut l'exécuter.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.expireDue().catch((e: unknown) => this.logger.error(`Expiration : ${String(e)}`));
    }, EXPIRY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Abonnements actifs dont l'échéance est passée → « expiré » (A28). Transition conditionnelle :
   * deux exécutions simultanées ne journalisent chaque abonnement qu'une fois.
   */
  async expireDue(now = new Date()): Promise<{ expired: number }> {
    const due = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: { id: true, expiresAt: true },
      take: 500,
    });
    let expired = 0;
    for (const sub of due) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.subscription.updateMany({
          where: { id: sub.id, status: 'ACTIVE', expiresAt: { lt: now } },
          data: { status: 'EXPIRED' },
        });
        if (claimed.count === 0) return;
        expired += 1;
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            type: 'STATUS_CHANGED',
            fromStatus: 'ACTIVE',
            toStatus: 'EXPIRED',
            reason: `Échéance du ${sub.expiresAt!.toISOString().slice(0, 10)} dépassée.`,
          },
        });
      });
    }
    if (expired > 0) {
      await this.audit.record({
        organizationId: null,
        actorUserId: null,
        action: 'platform.subscriptions_expired',
        targetType: 'Subscription',
        targetId: null,
        metadata: { expired },
      });
    }
    return { expired };
  }

  async suspend(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      ['ACTIVE', 'PAST_DUE', 'PENDING_ACTIVATION', 'NOT_ACTIVATED', 'TRIALING'],
      () => 'SUSPENDED',
      reason,
      'platform.subscription_suspended',
    );
  }

  /**
   * Réactivation d'un abonnement suspendu : actif si son échéance n'est pas passée, sinon expiré.
   * Jamais activé : retour à l'essai s'il en a consommé un (socle S1 ; l'échéance de l'essai reste
   * calculée, donc un essai échu redevient lecture seule), jamais à l'accès complet historique.
   */
  async reactivate(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      ['SUSPENDED'],
      (s) =>
        s.expiresAt && s.expiresAt > new Date()
          ? 'ACTIVE'
          : s.startedAt
            ? 'EXPIRED'
            : s.hasTrial
              ? 'TRIALING'
              : 'NOT_ACTIVATED',
      reason,
      'platform.subscription_reactivated',
    );
  }

  /** Résiliation : définitive ; un règlement ne peut plus le réactiver. */
  async cancel(auth: AuthContext, id: string, reason: string) {
    return this.transition(
      auth,
      id,
      [
        'NOT_ACTIVATED',
        'TRIALING',
        'ACTIVE',
        'PAST_DUE',
        'EXPIRED',
        'SUSPENDED',
        'PENDING_ACTIVATION',
      ],
      () => 'CANCELED',
      reason,
      'platform.subscription_canceled',
    );
  }

  /**
   * Changement d'offre (même produit, offre active) : le tarif de la nouvelle offre devient le
   * tarif accepté (historisé) et son mode d'activation est figé. Refusé avec une activation en
   * attente (décider d'abord) ou sur un abonnement résilié.
   */
  async changePlan(auth: AuthContext, id: string, planId: string, reason: string) {
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const sub = await this.find(tx, id);
      if (sub.status === 'CANCELED') {
        throw new ConflictException({
          code: 'SUBSCRIPTION_CANCELED',
          message: 'Abonnement résilié : son offre ne peut plus être changée.',
        });
      }
      if (sub.planId === planId) {
        throw new BadRequestException({ code: 'PLAN_UNCHANGED', message: 'C’est déjà son offre.' });
      }
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.productId !== sub.productId || !plan.isActive) {
        throw new BadRequestException({
          code: 'PLAN_INVALID',
          message: 'Offre inconnue, inactive ou d’un autre produit.',
        });
      }
      const pending = await tx.subscriptionPayment.count({
        where: { subscriptionId: id, activationStatus: 'PENDING' },
      });
      if (pending > 0) {
        throw new ConflictException({
          code: 'ACTIVATION_PENDING',
          message: 'Une activation attend une décision : approuvez-la ou refusez-la d’abord.',
        });
      }
      const now = new Date();
      await tx.subscription.update({
        where: { id },
        // Étape 6 : un passage au forfait efface le décompte par site (recalculé si l'offre est par site).
        data: { planId, activationMode: plan.activationMode, billedSiteCount: null },
      });
      const agreed = await freezeAgreedPrices(tx, {
        subscriptionId: id,
        organizationId: sub.organizationId,
        productId: sub.productId,
        plan,
        actorUserId: auth.user.id,
        reason: `Changement d'offre : ${reason}`,
        at: now,
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          type: 'PLAN_CHANGED',
          fromPlanId: sub.planId,
          toPlanId: planId,
          actorUserId: auth.user.id,
          reason,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_plan_changed',
          targetType: 'Subscription',
          targetId: id,
          metadata: {
            organizationId: sub.organizationId,
            fromPlanId: sub.planId,
            toPlanId: planId,
            monthlyPrice: plan.monthlyPrice,
            pricingMode: plan.pricingMode,
            extraSitePrice: agreed.extraSitePrice,
            showcasePrice: agreed.showcasePrice,
            activationMode: plan.activationMode,
            reason,
          },
        },
        tx,
      );
      return { id, planId, activationMode: plan.activationMode };
    });
    // Étape 6 : offre par site → premier décompte des sites (hors transaction : bases des applications).
    // Indisponible : le rapprochement horaire et l'émission de la facture le referont.
    await this.siteActivations.refreshSubscription(id).catch((error: unknown) => {
      this.logger.warn(`Décompte des sites de ${id} reporté : ${String(error)}`);
    });
    return changed;
  }

  /**
   * Étape 6 : sites facturés d'un abonnement par site (décompte à jour, mensualité correspondante) ;
   * null pour une offre forfaitaire.
   */
  async sites(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        ...MONTHLY_AMOUNT_SUB_SELECT,
        plan: { select: MONTHLY_AMOUNT_PLAN_SELECT },
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Abonnement introuvable.',
      });
    }
    const refreshed = await this.siteActivations.refreshSubscription(id);
    if (!refreshed)
      return {
        pricingMode: 'FLAT' as const,
        sites: [],
        billedSites: null,
        monthlyAmount: subscriptionMonthlyAmount(sub),
      };
    return {
      pricingMode: 'PER_SITE' as const,
      sites: refreshed.sites.map((x) => ({
        siteKey: x.siteKey,
        label: x.label,
        sources: x.sources,
        startedAt: x.startedAt.toISOString(),
      })),
      billedSites: refreshed.count,
      monthlyAmount: subscriptionMonthlyAmount({ ...sub, billedSiteCount: refreshed.count }),
    };
  }

  /**
   * Étape 6 (décision D2 adaptée) : APERÇU de la séparation Parc / Restaurant des contrats Park en cours,
   * sans aucune écriture ni changement de prix. Sites comptés dans le référentiel (activités parc et
   * restaurant séparées, établissements actifs).
   */
  async parkRestaurantSplit() {
    const subs = await this.prisma.subscription.findMany({
      where: { product: { code: { in: PARK_APP_PRODUCT_CODES } }, status: { not: 'CANCELED' } },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        organizationId: true,
        organization: { select: { name: true } },
        product: { select: { code: true } },
        ...MONTHLY_AMOUNT_SUB_SELECT,
        plan: { select: { name: true, ...MONTHLY_AMOUNT_PLAN_SELECT } },
        parkCombined: { select: { status: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 2_000,
    });
    const establishments = await this.prisma.establishment.findMany({
      where: { organizationId: { in: subs.map((x) => x.organizationId) }, isActive: true },
      select: { organizationId: true, businessType: true },
    });
    const count = (organizationId: string, activity: 'PARK' | 'RESTAURANT') =>
      establishments.filter(
        (e) =>
          e.organizationId === organizationId && activitiesOf(e.businessType).includes(activity),
      ).length;
    return subs.map((x) =>
      proposeParkRestaurantSplit({
        subscriptionId: x.id,
        organizationId: x.organizationId,
        organizationName: x.organization.name,
        productCode: x.product.code,
        status: x.status,
        planName: x.plan.name,
        monthlyAmount: subscriptionMonthlyAmount(x),
        expiresAt: x.expiresAt?.toISOString() ?? null,
        parkSites: count(x.organizationId, 'PARK'),
        restaurantSites: count(x.organizationId, 'RESTAURANT'),
        contractCombined: x.parkCombined?.status === 'ACTIVE',
      }),
    );
  }

  /** Historique d'un abonnement : tarifs appliqués et évènements. */
  async history(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        activationMode: true,
        priceHistory: {
          orderBy: { effectiveFrom: 'desc' },
          select: {
            id: true,
            setupFee: true,
            monthlyPrice: true,
            currency: true,
            effectiveFrom: true,
            effectiveTo: true,
            reason: true,
            plan: { select: { name: true } },
          },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Abonnement introuvable.',
      });
    }
    return sub;
  }

  private async transition(
    auth: AuthContext,
    id: string,
    from: readonly string[],
    to: (s: { expiresAt: Date | null; startedAt: Date | null; hasTrial: boolean }) => string,
    reason: string,
    action: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const sub = await this.find(tx, id);
      if (!from.includes(sub.status)) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_STATUS_CONFLICT',
          message: `Action impossible depuis le statut ${sub.status}.`,
          status: sub.status,
        });
      }
      const trial = await tx.productTrial.findUnique({
        where: {
          organizationId_productId: {
            organizationId: sub.organizationId,
            productId: sub.productId,
          },
        },
        select: { id: true },
      });
      const target = to({ ...sub, hasTrial: trial !== null }) as 'ACTIVE';
      await tx.subscription.update({ where: { id }, data: { status: target } });
      const event = await tx.subscriptionEvent.create({
        select: { id: true },
        data: {
          subscriptionId: id,
          type: 'STATUS_CHANGED',
          fromStatus: sub.status,
          toStatus: target,
          actorUserId: auth.user.id,
          reason,
        },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action,
          targetType: 'Subscription',
          targetId: id,
          metadata: { organizationId: sub.organizationId, from: sub.status, to: target, reason },
        },
        tx,
      );
      // Sprint S2 : suspension et réactivation notifiées au client (la résiliation se traite avec lui).
      const kind =
        (target as string) === 'SUSPENDED'
          ? 'SUSPENDED'
          : sub.status === 'SUSPENDED'
            ? 'REACTIVATED'
            : null;
      if (kind) {
        const product = await tx.saasProduct.findUniqueOrThrow({
          where: { id: sub.productId },
          select: { code: true, name: true },
        });
        await notifyOrganization(tx, {
          organizationId: sub.organizationId,
          kind,
          productCode: product.code,
          params: {
            // Motif interne non transmis : le client contacte Ocall.
            productName: commercialAppName(product.code, product.name),
          },
          dedupeKey: `sub:${id}:event:${event.id}`,
        });
      }
      return { id, status: target };
    });
  }

  private async find(tx: Tx, id: string) {
    const sub = await tx.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        planId: true,
        productId: true,
        organizationId: true,
        expiresAt: true,
        startedAt: true,
      },
    });
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Abonnement introuvable.',
      });
    }
    return sub;
  }

  // ─── Sprint 7 : bascule d'un contrat combiné vers Ocall Parc + Ocall Restaurant ───

  /**
   * Bascule EXPLICITE d'un contrat Ocall Park combiné (parc et restaurant) vers deux abonnements, Ocall
   * Parc et Ocall Restaurant (décisions D1, D3, D4, D5) :
   * - montant mensuel total CONSERVÉ, réparti explicitement entre les deux applications (prix figés,
   *   historisés « repris du contrat ») ; aucune facture, aucun paiement, aucune commission réécrits ;
   * - même statut, même début et même échéance : aucun droit perdu, aucune période facturée deux fois ;
   * - aucune nouvelle mise en service (enregistrée « non due ») ;
   * - attributions des partenaires prolongées par une copie tracée vers l'application ajoutée ;
   * - refusée tant qu'une facture du contrat est ouverte, qu'une activation attend une décision, ou pour
   *   un contrat par site (total dépendant des sites).
   * Le contrat combiné est clos (droits portés par les deux nouveaux abonnements), jamais supprimé.
   */
  async switchCombined(
    auth: AuthContext,
    id: string,
    dto: { park: number; restaurant: number; reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const sub = await tx.subscription.findUnique({
        where: { id },
        select: {
          id: true,
          organizationId: true,
          productId: true,
          status: true,
          startedAt: true,
          expiresAt: true,
          agreedSetupFee: true,
          ...MONTHLY_AMOUNT_SUB_SELECT,
          product: { select: { code: true } },
          plan: { select: MONTHLY_AMOUNT_PLAN_SELECT },
          parkCombined: { select: { id: true, status: true } },
        },
      });
      if (!sub) {
        throw new NotFoundException({
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: 'Abonnement introuvable.',
        });
      }
      if (sub.parkCombined?.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'NOT_COMBINED_CONTRACT',
          message: 'Cet abonnement n’est pas un contrat Ocall Park combiné à basculer.',
        });
      }
      if (sub.status === 'CANCELED' || sub.status === 'SUSPENDED') {
        throw new ConflictException({
          code: 'SWITCH_NOT_ALLOWED',
          message: 'Contrat résilié ou suspendu : réactivez-le avant toute bascule.',
        });
      }
      if (sub.plan.pricingMode === 'PER_SITE') {
        throw new ConflictException({
          code: 'SWITCH_PER_SITE_UNSUPPORTED',
          message:
            'Contrat par site : son montant dépend des sites ; bascule à préparer avec Ocall (non automatique).',
        });
      }
      const [openInvoices, pendingActivations] = await Promise.all([
        tx.invoice.count({ where: { subscriptionId: id, status: 'ISSUED' } }),
        tx.subscriptionPayment.count({
          where: { subscriptionId: id, activationStatus: 'PENDING' },
        }),
      ]);
      if (openInvoices > 0 || pendingActivations > 0) {
        throw new ConflictException({
          code: 'SWITCH_OPEN_BILLING',
          message:
            'Une facture du contrat est ouverte ou une activation attend une décision : réglez-la d’abord.',
        });
      }
      const total = subscriptionMonthlyAmount(sub);
      const split = { park: dto.park, restaurant: dto.restaurant };
      if (!isValidSwitchSplit(total, split)) {
        throw new BadRequestException({
          code: 'SWITCH_SPLIT_INVALID',
          message: `La répartition doit être deux montants entiers positifs dont la somme est ${total} FCFA (montant mensuel actuel).`,
        });
      }
      const products = await tx.saasProduct.findMany({
        where: { code: { in: [PARK_COMMERCIAL_CODE, RESTAURANT_COMMERCIAL_CODE] } },
        select: { id: true, code: true },
      });
      const productOf = (code: string) => products.find((p) => p.code === code)!.id;
      const now = new Date();
      const reason = `Bascule du contrat Ocall Park combiné : ${dto.reason}`;
      const targets: Record<'park' | 'restaurant', string> = { park: '', restaurant: '' };
      for (const side of ['park', 'restaurant'] as const) {
        const code = side === 'park' ? PARK_COMMERCIAL_CODE : RESTAURANT_COMMERCIAL_CODE;
        const amount = split[side];
        if (sub.product.code === code) {
          // Abonnement repris pour son application : tarif refigé à sa part, historisé.
          await tx.subscription.update({
            where: { id },
            data: { agreedMonthlyPrice: amount, agreedAt: now },
          });
          await recordPriceChange(tx, {
            subscriptionId: id,
            planId: (
              await tx.subscription.findUniqueOrThrow({ where: { id }, select: { planId: true } })
            ).planId,
            setupFee: sub.agreedSetupFee ?? 0,
            monthlyPrice: amount,
            currency: 'XOF',
            actorUserId: auth.user.id,
            reason,
            at: now,
          });
          targets[side] = id;
          continue;
        }
        const productId = productOf(code);
        if (
          await tx.subscription.count({ where: { organizationId: sub.organizationId, productId } })
        ) {
          throw new ConflictException({
            code: 'SWITCH_TARGET_EXISTS',
            message: 'Un abonnement de cette application existe déjà pour l’organisation.',
          });
        }
        const plan = await tx.subscriptionPlan.findFirst({
          where: { productId, pricingMode: 'FLAT', includesShowcase: sub.plan.includesShowcase },
          orderBy: [{ isActive: 'desc' }, { monthlyPrice: 'asc' }],
          select: { id: true, activationMode: true, currency: true },
        });
        if (!plan) {
          throw new ConflictException({
            code: 'SWITCH_PLAN_MISSING',
            message: 'Aucune offre forfaitaire de cette application : créez-la avant la bascule.',
          });
        }
        const created = await tx.subscription.create({
          data: {
            organizationId: sub.organizationId,
            productId,
            planId: plan.id,
            status: sub.status,
            startedAt: sub.startedAt,
            expiresAt: sub.expiresAt,
            activationMode: plan.activationMode,
            agreedMonthlyPrice: amount,
            agreedSetupFee: 0,
            agreedAt: now,
          },
          select: { id: true },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: created.id,
            type: 'CREATED',
            toPlanId: plan.id,
            toStatus: sub.status,
            actorUserId: auth.user.id,
            reason,
          },
        });
        await recordPriceChange(tx, {
          subscriptionId: created.id,
          planId: plan.id,
          setupFee: 0,
          monthlyPrice: amount,
          currency: plan.currency,
          actorUserId: auth.user.id,
          reason,
          at: now,
        });
        // Essai en cours : même échéance d'essai pour la nouvelle application (aucun droit perdu).
        if (sub.status === 'TRIALING') {
          const trial = await tx.productTrial.findUnique({
            where: {
              organizationId_productId: {
                organizationId: sub.organizationId,
                productId: sub.productId,
              },
            },
            select: { startedAt: true, endsAt: true },
          });
          if (trial) {
            await tx.productTrial.upsert({
              where: {
                organizationId_productId: { organizationId: sub.organizationId, productId },
              },
              create: {
                organizationId: sub.organizationId,
                productId,
                startedAt: trial.startedAt,
                endsAt: trial.endsAt,
                startedByUserId: auth.user.id,
                startedByOcall: true,
              },
              update: {},
            });
          }
        }
        // Décision D4 : aucune nouvelle mise en service à la bascule.
        await tx.productSetupFee.upsert({
          where: { organizationId_productId: { organizationId: sub.organizationId, productId } },
          create: { organizationId: sub.organizationId, productId, amount: 0, status: 'WAIVED' },
          update: {},
        });
        targets[side] = created.id;
      }
      // Contrat combiné d'un autre produit (historique « Parc + Restaurant ») : clos, droits portés par
      // les deux nouveaux abonnements. Jamais supprimé, factures et paiements conservés.
      if (targets.park !== id && targets.restaurant !== id) {
        await tx.subscription.update({ where: { id }, data: { status: 'CANCELED' } });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: id,
            type: 'STATUS_CHANGED',
            fromStatus: sub.status,
            toStatus: 'CANCELED',
            actorUserId: auth.user.id,
            reason,
          },
        });
      }
      await tx.parkCombinedContract.update({
        where: { id: sub.parkCombined.id },
        data: {
          status: 'SWITCHED',
          switchedAt: now,
          switchedById: auth.user.id,
          switchReason: dto.reason,
          parkSubscriptionId: targets.park,
          restaurantSubscriptionId: targets.restaurant,
          split: { total, park: split.park, restaurant: split.restaurant, basis: 'explicit' },
        },
      });
      const copied = await this.extendAttributions(tx, {
        organizationId: sub.organizationId,
        targetProductIds: [targets.park, targets.restaurant]
          .filter((t) => t !== id)
          .map((t) =>
            t === targets.park
              ? productOf(PARK_COMMERCIAL_CODE)
              : productOf(RESTAURANT_COMMERCIAL_CODE),
          ),
        actorUserId: auth.user.id,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.park_restaurant_switched',
          targetType: 'Subscription',
          targetId: id,
          metadata: {
            organizationId: sub.organizationId,
            total,
            split,
            parkSubscriptionId: targets.park,
            restaurantSubscriptionId: targets.restaurant,
            attributionsCopied: copied,
            reason: dto.reason,
          },
        },
        tx,
      );
      return {
        total,
        split,
        parkSubscriptionId: targets.park,
        restaurantSubscriptionId: targets.restaurant,
        attributionsCopied: copied,
      };
    });
  }

  /**
   * Décision D5 : chaque attribution confirmée du contrat combiné (application Ocall Park) est prolongée
   * vers l'application ajoutée par une copie tracée (même partenaire, même règle figée, même date de
   * confirmation, `derivedFromId`). Aucune copie si l'application a déjà une attribution confirmée (une
   * seule par organisation et application) : jamais de commission en double.
   */
  private async extendAttributions(
    tx: Tx,
    input: {
      organizationId: string;
      targetProductIds: string[];
      actorUserId: string;
    },
  ): Promise<number> {
    const family = await tx.saasProduct.findMany({
      where: { code: { in: [...PARK_APP_PRODUCT_CODES] } },
      select: { id: true },
    });
    const sources = await tx.attribution.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'CONFIRMED',
        productId: { in: family.map((f) => f.id) },
      },
      orderBy: { confirmedAt: 'asc' },
    });
    let copied = 0;
    for (const productId of input.targetProductIds) {
      for (const a of sources) {
        if (a.productId === productId) continue;
        const exists = await tx.attribution.count({
          where: { organizationId: input.organizationId, productId, status: 'CONFIRMED' },
        });
        if (exists > 0) continue;
        await tx.attribution.create({
          data: {
            organizationId: input.organizationId,
            productId,
            partnerId: a.partnerId,
            prospectId: a.prospectId,
            source: 'ADMIN',
            status: 'CONFIRMED',
            ruleId: a.ruleId,
            confirmedById: a.confirmedById,
            confirmedAt: a.confirmedAt,
            derivedFromId: a.id,
            createdById: input.actorUserId,
          },
        });
        copied += 1;
      }
    }
    return copied;
  }
}
