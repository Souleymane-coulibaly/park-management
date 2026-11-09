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
  PARK_PRODUCT_CODE,
  SCHOOL_PRODUCT_CODE,
  type ProductAccess,
  type SaasProductStatus,
  type SetupFeeStatus,
  type SuitePortalApp,
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
import { loadParkAccess } from '../../common/park-access';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const APP_HREF: Record<string, string> = { OCALL_PARK: '/app', OCALL_SCHOOL: '/school' };

const NOT_FOUND = { code: 'PRODUCT_NOT_FOUND', message: 'Application introuvable.' };

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
    // l'essai, puis lecture seule automatique (aucune donnée supprimée).
    if (product.code === SCHOOL_PRODUCT_CODE) {
      if (!input.actorUserId)
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Auteur requis.' });
      const lastDay = new Date(endsAt.getTime() - DAY_MS);
      await tx.suiteContract.create({
        data: {
          organizationId: input.organizationId,
          productId: product.id,
          reference: `ESSAI-${subscriptionId.slice(0, 8).toUpperCase()}`,
          status: 'ACTIVE',
          startsOn: new Date(now.toISOString().slice(0, 10)),
          endsOn: new Date(lastDay.toISOString().slice(0, 10)),
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
          status: true,
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
        select: { productId: true },
      }),
    ]);
    const parkAccess = await this.parkAccessFor(auth, now);
    const schoolAccess = await this.schoolAccess(organizationId);
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
          : 'none';
      const trialUsed = trials.some((t) => t.productId === p.id);
      const fee = fees.find((f) => f.productId === (sub?.productId ?? p.id));
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
                planName: sub.plan.name,
                monthlyPrice: sub.agreedMonthlyPrice ?? sub.plan.monthlyPrice,
                includesShowcase: sub.plan.includesShowcase,
                expiresAt: sub.expiresAt?.toISOString() ?? null,
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
        canRequestActivation:
          canSeeBilling &&
          hasPermission(auth.membership.role, 'subscription.pay') &&
          (status === 'ACTIVE' || status === 'PREPRODUCTION') &&
          !pending.some((r) => r.productId === p.id) &&
          sub?.status !== 'CANCELED',
        plans: canSeeBilling && (status === 'ACTIVE' || status === 'PREPRODUCTION') ? p.plans : [],
        setupFeeStatus: canSeeBilling
          ? ((fee?.status as SetupFeeStatus | undefined) ?? null)
          : null,
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
   * Demande d'activation payante : le client choisit son offre (avec ou sans vitrine) et voit le
   * montant ; Ocall vérifie ensuite le règlement hors plateforme et active. Aucun paiement n'est
   * déclaré ici ; une seule demande en attente par application (index unique partiel).
   */
  async requestActivation(auth: TenantContext, productCode: string, planId: string) {
    const organizationId = auth.membership.organizationId;
    const product = await this.prisma.saasProduct.findUnique({
      where: { code: productCode },
      select: { id: true, code: true, status: true },
    });
    if (!product) throw new NotFoundException(NOT_FOUND);
    if (product.status !== 'ACTIVE' && product.status !== 'PREPRODUCTION') {
      throw new ConflictException({
        code: 'PRODUCT_NOT_AVAILABLE',
        message: 'Cette application n’est pas commercialisée : aucune activation possible.',
      });
    }
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, productId: product.id, isActive: true },
      select: { id: true, name: true, monthlyPrice: true, setupFee: true },
    });
    if (!plan)
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: 'Offre introuvable pour cette application.',
      });
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
      select: { status: true, productId: true },
    });
    if (sub?.status === 'CANCELED') {
      throw new ConflictException({
        code: 'SUBSCRIPTION_CANCELED',
        message: 'Abonnement résilié : contactez Ocall pour une nouvelle souscription.',
      });
    }
    const fee = await this.prisma.productSetupFee.findUnique({
      where: {
        organizationId_productId: { organizationId, productId: sub?.productId ?? product.id },
      },
      select: { status: true },
    });
    const quote = quoteSubscription(plan, fee?.status as SetupFeeStatus | undefined);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const request = await tx.activationRequest.create({
          data: {
            organizationId,
            productId: product.id,
            planId: plan.id,
            quotedSetupFee: quote.setupFee,
            quotedMonthly: quote.monthlyPrice,
            requestedByUserId: auth.user.id,
          },
          select: { id: true, status: true, createdAt: true },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'suite.activation_requested',
            targetType: 'ActivationRequest',
            targetId: request.id,
            metadata: { product: product.code, plan: plan.name, ...quote },
          },
          tx,
        );
        return { ...request, plan: plan.name, quote };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'ACTIVATION_ALREADY_REQUESTED',
          message: 'Une demande d’activation est déjà en cours pour cette application.',
        });
      }
      throw e;
    }
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

  async activationRequests(status: 'PENDING' | 'HANDLED' | 'CANCELLED' = 'PENDING') {
    return this.prisma.activationRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
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
        select: { id: true, status: true, organizationId: true },
      });
      if (!request)
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Demande introuvable.' });
      if (closed.count === 1) {
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
