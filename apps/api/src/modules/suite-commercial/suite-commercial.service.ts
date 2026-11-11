import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  PARK_APP_PRODUCT_CODES,
  FACTURE_PRODUCT_CODE,
  PARK_PRODUCT_CODE,
  SCHOOL_PRODUCT_CODE,
  type ProductAccess,
  type SaasProductStatus,
  type SetupFeeStatus,
  type SuitePortalApp,
  type SuiteRequestKind,
  activitiesOf,
  canStartTrial,
  commercialState,
  hasPermission,
  isPublicProductStatus,
  quoteSubscription,
  trialDaysRemaining,
  trialEndsAt,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext, TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { loadAppAccess } from '../../common/app-access';
import { loadParkAccess } from '../../common/park-access';
import { notifyOrganization } from '../../common/suite-notify';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';

type Tx = Prisma.TransactionClient;
const APP_HREF: Record<string, string> = {
  OCALL_PARK: '/app',
  OCALL_SCHOOL: '/school',
  OCALL_FACTURE: '/facture',
};

const NOT_FOUND = { code: 'PRODUCT_NOT_FOUND', message: 'Application introuvable.' };
const DAY_MS = 86_400_000;

/** Nom présenté au client (la famille Park historique s'affiche « Ocall Park »). */
function displayName(product: { code: string; name: string }): string {
  return PARK_APP_PRODUCT_CODES.includes(product.code) ? 'Ocall Park' : product.name;
}

/**
 * Socle commercial Ocall Suite (Sprint S1) : essais gratuits, vue du portail client, contrat d'une
 * application, demandes d'activation payante, suivi par le Super Admin. Le paiement reste hors
 * plateforme : seul Ocall confirme un règlement et active un abonnement (parcours de règlement
 * existant). Toutes les décisions sont prises par le serveur ; l'organisation vient toujours de la
 * session (jamais de la requête) côté client.
 */
@Injectable()
export class SuiteCommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contracts: SuiteContractsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Essai gratuit ───

  /**
   * Démarre l'essai de 14 jours d'une application, une seule fois par organisation et application
   * (unicité en base : une seconde tentative, même simultanée, échoue). Dates calculées en UTC.
   * À appeler dans la transaction de l'appelant (provisionnement, client, Super Admin).
   */
  async startTrialTx(
    tx: Tx,
    input: {
      organizationId: string;
      productCode: string;
      by: 'customer' | 'ocall';
      actorUserId: string | null;
      now?: Date;
    },
  ) {
    const now = input.now ?? new Date();
    const product = await tx.saasProduct.findUnique({
      where: { code: input.productCode },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!product) throw new NotFoundException(NOT_FOUND);
    if (!canStartTrial(product.status as SaasProductStatus, input.by)) {
      throw new ConflictException({
        code: 'TRIAL_NOT_AVAILABLE',
        message:
          product.status === 'PREPRODUCTION' || product.status === 'PILOT'
            ? 'Cette application est en préproduction : l’essai est activé par Ocall sur demande.'
            : 'Cette application n’est pas encore commercialisée : aucun essai possible.',
      });
    }
    // Ocall Park : une seule application de la famille Park par organisation (abonnements historiques).
    if (product.code === PARK_PRODUCT_CODE) {
      const legacy = await tx.subscription.findFirst({
        where: {
          organizationId: input.organizationId,
          product: { code: { in: PARK_APP_PRODUCT_CODES.filter((c) => c !== PARK_PRODUCT_CODE) } },
        },
        select: { id: true },
      });
      if (legacy) throw this.trialNotAllowed();
    }
    const plan = await tx.subscriptionPlan.findFirst({
      where: { productId: product.id, isActive: true },
      orderBy: [{ includesShowcase: 'asc' }, { monthlyPrice: 'asc' }],
      select: { id: true, trialDays: true },
    });
    if (!plan) {
      throw new ConflictException({
        code: 'PLAN_NOT_FOUND',
        message: 'Aucune offre en vigueur pour cette application.',
      });
    }
    const endsAt = trialEndsAt(now, plan.trialDays);
    try {
      await tx.productTrial.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          startedAt: now,
          endsAt,
          startedByUserId: input.actorUserId,
          startedByOcall: input.by === 'ocall',
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'TRIAL_ALREADY_USED',
          message:
            'L’essai gratuit de cette application a déjà été utilisé par votre organisation.',
        });
      }
      throw e;
    }
    const existing = await tx.subscription.findUnique({
      where: {
        organizationId_productId: { organizationId: input.organizationId, productId: product.id },
      },
      select: { id: true, status: true },
    });
    let subscriptionId: string;
    if (existing) {
      // Seul un abonnement jamais activé peut passer en essai (jamais un abonnement payé ou clos).
      const moved = await tx.subscription.updateMany({
        where: { id: existing.id, status: 'NOT_ACTIVATED' },
        data: { status: 'TRIALING', planId: plan.id },
      });
      if (moved.count === 0) throw this.trialNotAllowed();
      subscriptionId = existing.id;
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          type: 'STATUS_CHANGED',
          fromStatus: 'NOT_ACTIVATED',
          toStatus: 'TRIALING',
          actorUserId: input.actorUserId,
          reason: `Essai gratuit de ${plan.trialDays} jours.`,
        },
      });
    } else {
      const sub = await tx.subscription.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          planId: plan.id,
          status: 'TRIALING',
        },
        select: { id: true },
      });
      subscriptionId = sub.id;
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          type: 'CREATED',
          toPlanId: plan.id,
          toStatus: 'TRIALING',
          actorUserId: input.actorUserId,
          reason: `Essai gratuit de ${plan.trialDays} jours.`,
        },
      });
    }
    // Ocall School : l'accès passe par un contrat (périmètre) ; contrat d'essai jusqu'à la fin de
    // l'essai, puis lecture seule automatique (aucune donnée supprimée). Les contrats sont datés au
    // jour (UTC, dernier jour entier) : le dernier jour est celui de l'échéance de l'essai, pour ne
    // jamais couper l'accès avant l'instant annoncé (`ProductTrial.endsAt`).
    if (product.code === SCHOOL_PRODUCT_CODE) {
      if (!input.actorUserId)
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Auteur requis.' });
      await tx.suiteContract.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          reference: `ESSAI-${subscriptionId.slice(0, 8).toUpperCase()}`,
          status: 'ACTIVE',
          startsOn: new Date(now.toISOString().slice(0, 10)),
          endsOn: new Date(endsAt.toISOString().slice(0, 10)),
          modules: [],
          limits: { tier: 'TRIAL' },
          createdById: input.actorUserId,
        },
      });
    }
    await this.audit.record(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.by === 'ocall' ? 'platform.trial_started' : 'suite.trial_started',
        targetType: 'Subscription',
        targetId: subscriptionId,
        metadata: { product: product.code, endsAt: endsAt.toISOString(), by: input.by },
      },
      tx,
    );
    await notifyOrganization(tx, {
      organizationId: input.organizationId,
      kind: 'TRIAL_STARTED',
      productCode: product.code,
      params: { productName: displayName(product), endsAt: endsAt.toISOString() },
      dedupeKey: `trial-start:${subscriptionId}`,
    });
    return {
      subscriptionId,
      productCode: product.code,
      startedAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  }

  async customerStartTrial(auth: TenantContext, productCode: string) {
    return this.prisma.$transaction((tx) =>
      this.startTrialTx(tx, {
        organizationId: auth.membership.organizationId,
        productCode,
        by: 'customer',
        actorUserId: auth.user.id,
      }),
    );
  }

  async platformStartTrial(auth: AuthContext, organizationId: string, productCode: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation introuvable.',
      });
    return this.prisma.$transaction((tx) =>
      this.startTrialTx(tx, {
        organizationId,
        productCode,
        by: 'ocall',
        actorUserId: auth.user.id,
      }),
    );
  }

  // ─── Portail client ───

  /** Vue du portail : applications du catalogue, abonnement, essai, droits, offres et setup. */
  async overview(auth: TenantContext, now: Date = new Date()): Promise<SuitePortalApp[]> {
    const organizationId = auth.membership.organizationId;
    const canSeeBilling = hasPermission(auth.membership.role, 'subscription.read');
    const [products, subs, trials, fees, pending] = await Promise.all([
      this.prisma.saasProduct.findMany({
        where: { listed: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          code: true,
          slug: true,
          name: true,
          tagline: true,
          status: true,
          plans: {
            where: { isActive: true },
            orderBy: [{ includesShowcase: 'asc' }, { monthlyPrice: 'asc' }],
            select: {
              id: true,
              name: true,
              monthlyPrice: true,
              setupFee: true,
              includesShowcase: true,
            },
          },
        },
      }),
      this.prisma.subscription.findMany({
        where: { organizationId },
        select: {
          productId: true,
          planId: true,
          status: true,
          startedAt: true,
          expiresAt: true,
          agreedMonthlyPrice: true,
          product: { select: { code: true } },
          plan: { select: { name: true, monthlyPrice: true, includesShowcase: true } },
        },
      }),
      this.prisma.productTrial.findMany({ where: { organizationId } }),
      this.prisma.productSetupFee.findMany({
        where: { organizationId },
        select: { productId: true, status: true },
      }),
      this.prisma.activationRequest.findMany({
        where: { organizationId, status: 'PENDING' },
        select: { productId: true, kind: true, createdAt: true },
      }),
    ]);
    const parkAccess = await this.parkAccessFor(auth, now);
    const schoolAccess = await this.schoolAccess(organizationId);
    // Ocall Facture : abonnement et essai (socle S1), application activée par configuration.
    const factureAccess: ProductAccess = this.config.facture.enabled
      ? await loadAppAccess(this.prisma, organizationId, FACTURE_PRODUCT_CODE, now)
      : 'none';
    const out: SuitePortalApp[] = [];
    for (const p of products) {
      const status = p.status as SaasProductStatus;
      if (!isPublicProductStatus(status) && status !== 'SUSPENDED') continue;
      const isPark = p.code === PARK_PRODUCT_CODE;
      // Ocall Park : l'abonnement peut être historique (Restaurant, Parc + Restaurant).
      const sub = isPark
        ? subs.find((s) => PARK_APP_PRODUCT_CODES.includes(s.product.code))
        : subs.find((s) => s.productId === p.id);
      const trial = trials.find((t) => t.productId === (sub?.productId ?? p.id)) ?? null;
      const access: ProductAccess = isPark
        ? parkAccess
        : p.code === SCHOOL_PRODUCT_CODE
          ? schoolAccess
          : p.code === FACTURE_PRODUCT_CODE
            ? factureAccess
            : 'none';
      const trialUsed = trials.some((t) => t.productId === p.id);
      const fee = fees.find((f) => f.productId === (sub?.productId ?? p.id));
      const pendingRequest = pending.find((r) => r.productId === p.id) ?? null;
      const canRequest =
        canSeeBilling &&
        hasPermission(auth.membership.role, 'subscription.pay') &&
        (status === 'ACTIVE' || status === 'PREPRODUCTION') &&
        !pendingRequest &&
        sub?.status !== 'CANCELED' &&
        // Suspendu (essai compris) : aucune demande, comme le refuse l'API.
        sub?.status !== 'SUSPENDED';
      // Abonnement déjà payé une fois : renouvellement (tarif contractuel) ou changement d'offre ;
      // sinon activation. Un abonnement suspendu se règle avec Ocall (exclu de canRequest).
      const requestKinds: SuiteRequestKind[] = !canRequest
        ? []
        : sub?.startedAt
          ? ['RENEWAL', ...(p.plans.length > 1 ? (['PLAN_CHANGE'] as const) : [])]
          : ['ACTIVATION'];
      out.push({
        code: p.code,
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        productStatus: status,
        href: access !== 'none' ? (APP_HREF[p.code] ?? null) : null,
        access,
        subscription:
          sub && canSeeBilling
            ? {
                state: commercialState(
                  {
                    status: sub.status,
                    expiresAt: sub.expiresAt,
                    trialEndsAt: trial?.endsAt ?? null,
                  },
                  now,
                ),
                planId: sub.planId,
                planName: sub.plan.name,
                monthlyPrice: sub.agreedMonthlyPrice ?? sub.plan.monthlyPrice,
                includesShowcase: sub.plan.includesShowcase,
                expiresAt: sub.expiresAt?.toISOString() ?? null,
                daysRemaining: sub.expiresAt
                  ? Math.ceil((sub.expiresAt.getTime() - now.getTime()) / DAY_MS)
                  : null,
              }
            : null,
        trial: trial
          ? {
              startedAt: trial.startedAt.toISOString(),
              endsAt: trial.endsAt.toISOString(),
              daysRemaining: trialDaysRemaining(trial.endsAt, now),
              active: trial.endsAt.getTime() > now.getTime(),
            }
          : null,
        canStartTrial:
          canSeeBilling &&
          hasPermission(auth.membership.role, 'subscription.pay') &&
          canStartTrial(status, 'customer') &&
          !trialUsed &&
          (!sub || sub.status === 'NOT_ACTIVATED'),
        canRequestActivation: requestKinds.includes('ACTIVATION'),
        plans: canSeeBilling && (status === 'ACTIVE' || status === 'PREPRODUCTION') ? p.plans : [],
        setupFeeStatus: canSeeBilling
          ? ((fee?.status as SetupFeeStatus | undefined) ?? null)
          : null,
        pendingRequest:
          canSeeBilling && pendingRequest
            ? { kind: pendingRequest.kind, createdAt: pendingRequest.createdAt.toISOString() }
            : null,
        requestKinds,
      });
    }
    return out;
  }

  /** Contrat d'une application de l'organisation (abonnement, offre, tarifs figés, historique). */
  async contract(auth: TenantContext, productCode: string) {
    const organizationId = auth.membership.organizationId;
    const codes = productCode === PARK_PRODUCT_CODE ? [...PARK_APP_PRODUCT_CODES] : [productCode];
    const sub = await this.prisma.subscription.findFirst({
      where: { organizationId, product: { code: { in: codes } } },
      select: {
        id: true,
        status: true,
        startedAt: true,
        expiresAt: true,
        agreedSetupFee: true,
        agreedMonthlyPrice: true,
        agreedAt: true,
        productId: true,
        product: { select: { code: true, name: true } },
        plan: {
          select: { name: true, monthlyPrice: true, setupFee: true, includesShowcase: true },
        },
        priceHistory: {
          orderBy: { effectiveFrom: 'desc' },
          take: 24,
          select: { setupFee: true, monthlyPrice: true, effectiveFrom: true, effectiveTo: true },
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { type: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
        },
      },
    });
    if (!sub)
      throw new NotFoundException({
        code: 'CONTRACT_NOT_FOUND',
        message: 'Aucun contrat pour cette application.',
      });
    const [trial, fee] = await Promise.all([
      this.prisma.productTrial.findUnique({
        where: { organizationId_productId: { organizationId, productId: sub.productId } },
        select: { startedAt: true, endsAt: true },
      }),
      this.prisma.productSetupFee.findUnique({
        where: { organizationId_productId: { organizationId, productId: sub.productId } },
        select: { status: true, amount: true, invoicedAt: true, paidAt: true },
      }),
    ]);
    return {
      ...sub,
      state: commercialState({
        status: sub.status,
        expiresAt: sub.expiresAt,
        trialEndsAt: trial?.endsAt ?? null,
      }),
      trial: trial ? { ...trial, daysRemaining: trialDaysRemaining(trial.endsAt) } : null,
      setupFee: fee,
    };
  }

  /**
   * Demande d'activation payante, de renouvellement ou de changement d'offre. Le client voit le montant
   * indicatif ; Ocall vérifie ensuite le règlement hors plateforme et applique (aucun paiement en ligne).
   * Une seule demande en attente par application, tous types confondus (index unique partiel).
   * - Activation : offre choisie, tarif en vigueur.
   * - Renouvellement : abonnement déjà payé une fois ; offre en cours, tarif contractuel figé (tarif
   *   historique conservé, jamais le tarif du jour).
   * - Changement d'offre : autre offre active de l'application, à son tarif en vigueur.
   */
  async requestActivation(
    auth: TenantContext,
    productCode: string,
    planId: string,
    kind: SuiteRequestKind = 'ACTIVATION',
  ) {
    return this.createRequest({
      organizationId: auth.membership.organizationId,
      actorUserId: auth.user.id,
      productCode,
      planId,
      kind,
      partnerId: null,
    });
  }

  /**
   * Création d'une demande (activation, renouvellement, changement d'offre) pour une organisation :
   * par un membre du client, ou par le revendeur attribué (Sprint S3, `partnerId`). Mêmes règles dans
   * les deux cas ; le revendeur ne confirme ni paiement ni activation.
   */
  async createRequest(input: {
    organizationId: string;
    actorUserId: string;
    productCode: string;
    planId: string;
    kind: SuiteRequestKind;
    partnerId: string | null;
  }) {
    const { organizationId, productCode, planId, kind } = input;
    const product = await this.prisma.saasProduct.findUnique({
      where: { code: productCode },
      select: { id: true, code: true, name: true, status: true },
    });
    if (!product) throw new NotFoundException(NOT_FOUND);
    if (product.status !== 'ACTIVE' && product.status !== 'PREPRODUCTION') {
      throw new ConflictException({
        code: 'PRODUCT_NOT_AVAILABLE',
        message: 'Cette application n’est pas commercialisée : aucune activation possible.',
      });
    }
    const subProductIds =
      product.code === PARK_PRODUCT_CODE
        ? (
            await this.prisma.saasProduct.findMany({
              where: { code: { in: [...PARK_APP_PRODUCT_CODES] } },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [product.id];
    const sub = await this.prisma.subscription.findFirst({
      where: { organizationId, productId: { in: subProductIds } },
      select: {
        status: true,
        productId: true,
        planId: true,
        startedAt: true,
        agreedMonthlyPrice: true,
        plan: { select: { id: true, name: true, monthlyPrice: true, setupFee: true } },
      },
    });
    if (sub?.status === 'CANCELED') {
      throw new ConflictException({
        code: 'SUBSCRIPTION_CANCELED',
        message: 'Abonnement résilié : contactez Ocall pour une nouvelle souscription.',
      });
    }
    // Quel que soit le type demandé : un abonnement suspendu se règle avec Ocall.
    if (sub?.status === 'SUSPENDED') {
      throw new ConflictException({
        code: 'SUBSCRIPTION_SUSPENDED',
        message: 'Abonnement suspendu : contactez Ocall pour le réactiver.',
      });
    }
    if (kind === 'ACTIVATION' && sub?.startedAt) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_ALREADY_STARTED',
        message: 'Abonnement déjà activé : demandez un renouvellement ou un changement d’offre.',
      });
    }
    if (kind !== 'ACTIVATION' && !sub?.startedAt) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_NOT_STARTED',
        message: 'Aucun abonnement payant à renouveler : demandez d’abord l’activation.',
      });
    }
    let plan: { id: string; name: string; monthlyPrice: number; setupFee: number } | null;
    if (kind === 'RENEWAL') {
      // Offre contractuelle de l'abonnement, même retirée du catalogue ou historique (famille Park).
      if (planId !== sub!.planId) {
        throw new ConflictException({
          code: 'RENEWAL_PLAN_MISMATCH',
          message: 'Le renouvellement porte sur l’offre en cours ; demandez un changement d’offre.',
        });
      }
      plan = sub!.plan;
    } else {
      plan = await this.prisma.subscriptionPlan.findFirst({
        where: { id: planId, productId: product.id, isActive: true },
        select: { id: true, name: true, monthlyPrice: true, setupFee: true },
      });
      if (!plan)
        throw new NotFoundException({
          code: 'PLAN_NOT_FOUND',
          message: 'Offre introuvable pour cette application.',
        });
      if (kind === 'PLAN_CHANGE' && plan.id === sub!.planId) {
        throw new ConflictException({
          code: 'PLAN_UNCHANGED',
          message: 'Cette offre est déjà celle de votre abonnement.',
        });
      }
    }
    const fee = await this.prisma.productSetupFee.findUnique({
      where: {
        organizationId_productId: { organizationId, productId: sub?.productId ?? product.id },
      },
      select: { status: true },
    });
    // Renouvellement : devis entier au tarif contractuel figé (tarif historique), jamais le tarif du jour.
    const quote = quoteSubscription(
      kind === 'RENEWAL' && sub?.agreedMonthlyPrice != null
        ? { ...plan, monthlyPrice: sub.agreedMonthlyPrice }
        : plan,
      fee?.status as SetupFeeStatus | undefined,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.activationRequest.create({
          data: {
            organizationId,
            productId: product.id,
            planId: plan.id,
            kind,
            quotedSetupFee: quote.setupFee,
            quotedMonthly: quote.monthlyPrice,
            requestedByUserId: input.actorUserId,
            partnerId: input.partnerId,
          },
          select: { id: true, status: true, kind: true, createdAt: true },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: input.actorUserId,
            action: input.partnerId
              ? 'partner.subscription_request_prepared'
              : kind === 'RENEWAL'
                ? 'suite.renewal_requested'
                : kind === 'PLAN_CHANGE'
                  ? 'suite.plan_change_requested'
                  : 'suite.activation_requested',
            targetType: 'ActivationRequest',
            targetId: request.id,
            metadata: { product: product.code, plan: plan.name, kind, ...quote },
          },
          tx,
        );
        await notifyOrganization(tx, {
          organizationId,
          kind: 'REQUEST_RECEIVED',
          productCode: product.code,
          params: { productName: displayName(product), requestKind: kind },
          dedupeKey: `request:${request.id}:received`,
        });
        return { ...request, plan: plan.name, quote };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'ACTIVATION_ALREADY_REQUESTED',
          message: 'Une demande est déjà en cours pour cette application.',
        });
      }
      throw e;
    }
  }

  /** Historique des demandes de l'organisation pour une application (plus récentes d'abord). */
  async requests(auth: TenantContext, productCode: string) {
    const product = await this.prisma.saasProduct.findUnique({
      where: { code: productCode },
      select: { id: true },
    });
    if (!product) throw new NotFoundException(NOT_FOUND);
    const rows = await this.prisma.activationRequest.findMany({
      where: { organizationId: auth.membership.organizationId, productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        status: true,
        planId: true,
        quotedSetupFee: true,
        quotedMonthly: true,
        createdAt: true,
        handledAt: true,
        note: true,
      },
    });
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.planId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(plans.map((p) => [p.id, p.name]));
    // La note de traitement d'Ocall n'est montrée qu'en cas de refus (motif) : une référence de
    // règlement interne reste côté Ocall.
    return rows.map(({ note, planId, ...r }) => ({
      ...r,
      planName: names.get(planId) ?? '—',
      reason: r.status === 'CANCELLED' ? note : null,
    }));
  }

  // ─── Super Admin ───

  async trials() {
    return this.prisma.productTrial.findMany({
      orderBy: { startedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        startedAt: true,
        endsAt: true,
        startedByOcall: true,
        organization: { select: { id: true, name: true, code: true } },
        product: { select: { code: true, name: true } },
      },
    });
  }

  async setupFees() {
    return this.prisma.productSetupFee.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        amount: true,
        status: true,
        invoiceId: true,
        invoicedAt: true,
        paidAt: true,
        organization: { select: { id: true, name: true, code: true } },
        product: { select: { code: true, name: true } },
      },
    });
  }

  async activationRequests(
    status: 'PENDING' | 'HANDLED' | 'CANCELLED' = 'PENDING',
    filter: { kind?: SuiteRequestKind; productCode?: string; organizationId?: string } = {},
  ) {
    return this.prisma.activationRequest.findMany({
      where: {
        status,
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.productCode ? { product: { code: filter.productCode } } : {}),
      },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
      select: {
        id: true,
        kind: true,
        status: true,
        quotedSetupFee: true,
        quotedMonthly: true,
        planId: true,
        note: true,
        createdAt: true,
        handledAt: true,
        organization: { select: { id: true, name: true, code: true } },
        product: { select: { code: true, name: true } },
      },
    });
  }

  /** Clôture d'une demande (après règlement vérifié et activation, ou refus motivé). Idempotente. */
  async closeActivationRequest(
    auth: AuthContext,
    id: string,
    outcome: 'HANDLED' | 'CANCELLED',
    note: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.activationRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: outcome, handledAt: new Date(), handledByUserId: auth.user.id, note },
      });
      const request = await tx.activationRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          kind: true,
          organizationId: true,
          product: { select: { code: true, name: true } },
        },
      });
      if (!request)
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Demande introuvable.' });
      if (closed.count === 1) {
        // Le client est prévenu ; seul un refus montre la note (motif), jamais une référence interne.
        await notifyOrganization(tx, {
          organizationId: request.organizationId,
          kind: outcome === 'HANDLED' ? 'REQUEST_HANDLED' : 'REQUEST_REFUSED',
          productCode: request.product.code,
          params: {
            productName: displayName(request.product),
            requestKind: request.kind,
            ...(outcome === 'CANCELLED' ? { note } : {}),
          },
          dedupeKey: `request:${id}:closed`,
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action:
              outcome === 'HANDLED'
                ? 'platform.activation_request_handled'
                : 'platform.activation_request_cancelled',
            targetType: 'ActivationRequest',
            targetId: id,
            metadata: { organizationId: request.organizationId, note },
          },
          tx,
        );
      }
      return { id: request.id, status: request.status };
    });
  }

  // ─── Droits ───

  private async parkAccessFor(auth: TenantContext, now: Date): Promise<ProductAccess> {
    if (
      activitiesOf(auth.membership.businessType).length === 0 ||
      auth.membership.role === 'PRODUCT_USER'
    ) {
      return 'none';
    }
    return loadParkAccess(this.prisma, auth.membership.organizationId, now);
  }

  private async schoolAccess(organizationId: string): Promise<ProductAccess> {
    if (!this.config.school.enabled) return 'none';
    return (await this.contracts.entitlement(organizationId, SCHOOL_PRODUCT_CODE)).access;
  }

  private trialNotAllowed() {
    return new ForbiddenException({
      code: 'TRIAL_NOT_ALLOWED',
      message:
        'Un abonnement existe déjà pour cette application : l’essai gratuit n’est pas disponible.',
    });
  }
}
