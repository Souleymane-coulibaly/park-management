import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type CommercialDashboard,
  type InvoiceLineInput,
  PARK_APP_PRODUCT_CODES,
  type PlatformRoleName,
  SAAS_RENEWAL_WINDOW_DAYS,
  assignablePlatformRoles,
  computeInvoiceLines,
  effectivePlatformRole,
  type SaasProductStatus,
  canSubscribeToProduct,
  formatInvoiceNumber,
  isProductBillable,
  isProductCode,
  zonedMidnight,
} from '@ocall/shared';
import { recordPriceChange } from '../../common/subscription-billing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { PasswordService } from '../../common/security/password.service';
import { SessionService } from '../../common/security/session.service';
import { nextPlatformSequence } from '../../common/platform-counter';
import { PLATFORM_TIMEZONE, platformPeriod } from './platform-period';
import { generateTemporaryPassword } from '../../common/security/tokens';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const INVOICE_DUE_DAYS = 15;

/**
 * Plateforme Ocall Suite (Sprint 11A) : catalogue de produits, abonnements multi-produits, factures
 * à tarif figé, tableau de bord commercial, comptes internes. Tous les paiements restent manuels :
 * aucune facture n'est réglée, aucun abonnement activé ou renouvelé sans action du Super Admin.
 */
/** Vue d'un produit (types explicites : les champs JSON de Prisma ne sont pas exportables tels quels). */
export interface ProductView {
  id: string;
  code: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: SaasProductStatus;
  listed: boolean;
  appUrl: string | null;
  availableAt: string | null;
  features: string[];
  billing: Record<string, unknown>;
  sortOrder: number;
}

function productView(
  p: Omit<ProductView, 'billing' | 'availableAt'> & { billing: unknown; availableAt: Date | null },
): ProductView {
  return {
    id: p.id,
    code: p.code,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    status: p.status,
    listed: p.listed,
    appUrl: p.appUrl,
    availableAt: p.availableAt ? p.availableAt.toISOString().slice(0, 10) : null,
    features: p.features,
    billing: (p.billing ?? {}) as Record<string, unknown>,
    sortOrder: p.sortOrder,
  };
}

/** Champs publics modifiables d'un produit (Sprint 12A). */
interface ProductPublicFields {
  slug?: string;
  tagline?: string;
  listed?: boolean;
  appUrl?: string | null;
  availableAt?: string | null;
}

function productPublicData(dto: ProductPublicFields) {
  return {
    ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
    ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
    ...(dto.listed !== undefined ? { listed: dto.listed } : {}),
    ...(dto.appUrl !== undefined ? { appUrl: dto.appUrl } : {}),
    ...(dto.availableAt !== undefined
      ? { availableAt: dto.availableAt ? new Date(`${dto.availableAt}T00:00:00Z`) : null }
      : {}),
  };
}

const slugFromCode = (code: string) => code.toLowerCase().replace(/_/g, '-');

export interface AuditEntryView {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
  actor: string | null;
}

@Injectable()
export class SuiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  // ─── Catalogue de produits ───

  async products() {
    const rows = await this.prisma.saasProduct.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        plans: {
          select: {
            id: true,
            name: true,
            monthlyPrice: true,
            setupFee: true,
            isActive: true,
            businessType: true,
          },
        },
        _count: { select: { subscriptions: true } },
      },
    });
    return rows.map(({ plans, _count, ...p }) => ({
      ...productView(p),
      plans,
      subscriptions: _count.subscriptions,
    }));
  }

  async createProduct(
    auth: AuthContext,
    dto: {
      code: string;
      name: string;
      description?: string;
      status: SaasProductStatus;
      features?: string[];
    } & ProductPublicFields,
  ) {
    // Un nouveau produit n'a aucune offre : il ne peut pas être créé directement commercialisé.
    if (isProductBillable(dto.status)) {
      throw new ConflictException({
        code: 'PRODUCT_WITHOUT_PLAN',
        message:
          'Aucune offre : créez le produit non commercialisé, ajoutez une offre, puis activez-le.',
      });
    }
    if (!isProductCode(dto.code)) {
      throw new BadRequestException({
        code: 'PRODUCT_CODE_INVALID',
        message: 'Code produit : majuscules, chiffres et soulignés (ex. OCALL_SCHOOL).',
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.saasProduct.create({
          data: {
            code: dto.code,
            name: dto.name,
            description: dto.description ?? '',
            status: dto.status,
            features: dto.features ?? [],
            ...productPublicData(dto),
            slug: dto.slug ?? slugFromCode(dto.code),
          },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'platform.product_created',
            targetType: 'SaasProduct',
            targetId: product.id,
            metadata: { code: dto.code, status: dto.status },
          },
          tx,
        );
        return productView(product);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'PRODUCT_CODE_TAKEN',
          message: 'Ce code ou cet identifiant public existe déjà.',
        });
      }
      throw e;
    }
  }

  /**
   * Offre d'un produit hors famille Ocall Park (ex. Ocall School) : condition pour le rendre
   * commercialisable. Les offres Ocall Park, liées au métier de l'organisation et utilisées à
   * l'inscription, se modifient seulement (une seule offre par métier).
   */
  async createPlan(
    auth: AuthContext,
    productId: string,
    dto: {
      name: string;
      monthlyPrice: number;
      setupFee?: number;
      activationMode?: 'AUTO' | 'ADMIN_APPROVAL';
    },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.saasProduct.findUnique({
          where: { id: productId },
          select: { id: true, code: true },
        });
        if (!product)
          throw new NotFoundException({
            code: 'PRODUCT_NOT_FOUND',
            message: 'Produit introuvable.',
          });
        if (PARK_APP_PRODUCT_CODES.includes(product.code)) {
          throw new ConflictException({
            code: 'PARK_PLAN_FIXED',
            message:
              'Les offres Ocall Park existent déjà : modifiez-les dans « Abonnements et offres ».',
          });
        }
        const plan = await tx.subscriptionPlan.create({
          data: {
            productId,
            businessType: null,
            name: dto.name,
            monthlyPrice: dto.monthlyPrice,
            setupFee: dto.setupFee ?? 0,
            ...(dto.activationMode ? { activationMode: dto.activationMode } : {}),
          },
          select: {
            id: true,
            name: true,
            monthlyPrice: true,
            setupFee: true,
            isActive: true,
            businessType: true,
          },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'platform.plan_created',
            targetType: 'SubscriptionPlan',
            targetId: plan.id,
            metadata: {
              product: product.code,
              name: plan.name,
              monthlyPrice: plan.monthlyPrice,
              setupFee: plan.setupFee,
            },
          },
          tx,
        );
        return plan;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'PLAN_NAME_TAKEN',
          message: 'Une offre de ce nom existe déjà pour ce produit.',
        });
      }
      throw e;
    }
  }

  async updateProduct(
    auth: AuthContext,
    id: string,
    dto: {
      name?: string;
      description?: string;
      status?: SaasProductStatus;
      features?: string[];
    } & ProductPublicFields,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.saasProduct.findUnique({ where: { id } });
      if (!before)
        throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
      // Un produit sans offre (ex. Ocall School) ne peut pas être commercialisé : tarifs à valider.
      if (dto.status && isProductBillable(dto.status) && !isProductBillable(before.status)) {
        const plans = await tx.subscriptionPlan.count({ where: { productId: id, isActive: true } });
        if (plans === 0) {
          throw new ConflictException({
            code: 'PRODUCT_WITHOUT_PLAN',
            message: 'Aucune offre active : le produit ne peut pas être commercialisé.',
          });
        }
      }
      const { slug, tagline, listed, appUrl, availableAt, ...core } = dto;
      const product = await tx.saasProduct.update({
        where: { id },
        data: { ...core, ...productPublicData({ slug, tagline, listed, appUrl, availableAt }) },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.product_updated',
          targetType: 'SaasProduct',
          targetId: id,
          metadata: {
            before: {
              name: before.name,
              status: before.status,
              features: before.features,
              slug: before.slug,
              listed: before.listed,
            },
            after: { ...dto },
          },
        },
        tx,
      );
      return productView(product);
    });
  }

  // ─── Abonnements multi-produits ───

  /** Organisation, établissements, abonnements, factures et règlements (métadonnées uniquement). */
  async organization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        businessType: true,
        countryCode: true,
        status: true,
        createdAt: true,
        establishments: {
          select: {
            id: true,
            name: true,
            businessType: true,
            city: true,
            isActive: true,
            publicSite: { select: { slug: true, isOnline: true } },
          },
          orderBy: { name: 'asc' },
        },
        subscriptions: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            expiresAt: true,
            agreedSetupFee: true,
            agreedMonthlyPrice: true,
            agreedAt: true,
            activationMode: true,
            product: { select: { id: true, code: true, name: true, status: true } },
            plan: { select: { id: true, name: true, setupFee: true, monthlyPrice: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        invoices: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            issuedAt: true,
            dueAt: true,
            paidAt: true,
            product: { select: { code: true } },
          },
          orderBy: { issuedAt: 'desc' },
          take: 50,
        },
        subscriptionPayments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            paidAt: true,
            invoiceId: true,
          },
          orderBy: { paidAt: 'desc' },
          take: 50,
        },
        _count: { select: { memberships: true } },
      },
    });
    if (!org)
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation introuvable.',
      });
    return org;
  }

  /** Souscription d'une organisation à un produit commercialisé (non activée : activation manuelle). */
  async subscribe(
    auth: AuthContext,
    organizationId: string,
    dto: { productId: string; planId: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [org, product, plan] = await Promise.all([
        tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
        tx.saasProduct.findUnique({ where: { id: dto.productId } }),
        tx.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
      ]);
      if (!org)
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organisation introuvable.',
        });
      if (!product)
        throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
      if (!canSubscribeToProduct(product.status, 'ocall')) {
        throw new ConflictException({
          code: 'PRODUCT_NOT_AVAILABLE',
          message: 'Ce produit n’est pas commercialisé.',
        });
      }
      if (!plan || plan.productId !== product.id || !plan.isActive) {
        throw new BadRequestException({
          code: 'PLAN_INVALID',
          message: 'Offre inconnue ou d’un autre produit.',
        });
      }
      // Au plus un produit de la famille Ocall Park (lié au métier de l'organisation).
      if (PARK_APP_PRODUCT_CODES.includes(product.code)) {
        const park = await tx.subscription.count({
          where: { organizationId, product: { code: { in: [...PARK_APP_PRODUCT_CODES] } } },
        });
        if (park > 0) {
          throw new ConflictException({
            code: 'PARK_PRODUCT_EXISTS',
            message:
              'Cette organisation a déjà un abonnement Ocall Park : changez son métier plutôt.',
          });
        }
      }
      try {
        const sub = await tx.subscription.create({
          data: {
            organizationId,
            productId: product.id,
            planId: plan.id,
            status: 'NOT_ACTIVATED',
            // Mode d'activation figé : un changement ultérieur de l'offre n'est pas rétroactif.
            activationMode: plan.activationMode,
          },
        });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            type: 'CREATED',
            toPlanId: plan.id,
            toStatus: 'NOT_ACTIVATED',
            actorUserId: auth.user.id,
          },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'platform.subscription_created',
            targetType: 'Subscription',
            targetId: sub.id,
            metadata: {
              organizationId,
              product: product.code,
              planId: plan.id,
              activationMode: plan.activationMode,
            },
          },
          tx,
        );
        return sub;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({
            code: 'SUBSCRIPTION_EXISTS',
            message: 'Cette organisation est déjà abonnée à ce produit.',
          });
        }
        throw e;
      }
    });
  }

  /** Fige le tarif accepté s'il ne l'est pas encore (première facture ou première activation). */
  private async agreedPrices(tx: Tx, subscriptionId: string) {
    const s = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: {
        id: true,
        organizationId: true,
        productId: true,
        planId: true,
        agreedSetupFee: true,
        agreedMonthlyPrice: true,
        plan: { select: { setupFee: true, monthlyPrice: true, currency: true } },
        product: { select: { status: true, code: true } },
      },
    });
    if (s.agreedMonthlyPrice !== null && s.agreedSetupFee !== null) {
      return { sub: s, setupFee: s.agreedSetupFee, monthlyPrice: s.agreedMonthlyPrice };
    }
    await tx.subscription.update({
      where: { id: s.id },
      data: {
        agreedSetupFee: s.plan.setupFee,
        agreedMonthlyPrice: s.plan.monthlyPrice,
        agreedAt: new Date(),
      },
    });
    await recordPriceChange(tx, {
      subscriptionId: s.id,
      planId: s.planId,
      setupFee: s.plan.setupFee,
      monthlyPrice: s.plan.monthlyPrice,
      currency: s.plan.currency,
      actorUserId: null,
      reason: 'Tarif accepté à la première facture',
    });
    return { sub: s, setupFee: s.plan.setupFee, monthlyPrice: s.plan.monthlyPrice };
  }

  // ─── Factures ───

  async invoices(filters: {
    status?: 'ISSUED' | 'PAID' | 'CANCELLED';
    organizationId?: string;
    productCode?: string;
  }) {
    return this.prisma.invoice.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        ...(filters.productCode ? { product: { code: filters.productCode } } : {}),
      },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        cancelledAt: true,
        cancelReason: true,
        organization: { select: { id: true, name: true } },
        product: { select: { code: true, name: true } },
        lines: {
          select: {
            kind: true,
            label: true,
            quantity: true,
            unitAmount: true,
            amount: true,
            reason: true,
          },
          orderBy: { position: 'asc' },
        },
        payments: {
          select: { id: true, amount: true, status: true },
          where: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
        },
      },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Émission d'une facture : montants calculés par le serveur à partir du tarif ACCEPTÉ (figé),
   * numéro séquentiel par année, clé d'idempotence (une nouvelle tentative renvoie la même facture).
   */
  async issueInvoice(
    auth: AuthContext,
    dto: {
      subscriptionId: string;
      lines: InvoiceLineInput[];
      dueAt?: string;
      notes?: string;
      idempotencyKey: string;
    },
  ) {
    const existing = await this.prisma.invoice.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: { id: true, subscriptionId: true },
    });
    if (existing) {
      if (existing.subscriptionId !== dto.subscriptionId) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Clé déjà utilisée pour une autre facture.',
        });
      }
      return (await this.invoices({})).find((i) => i.id === existing.id) ?? existing;
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const exists = await tx.subscription.findUnique({
        where: { id: dto.subscriptionId },
        select: { id: true },
      });
      if (!exists)
        throw new NotFoundException({
          code: 'SUBSCRIPTION_NOT_FOUND',
          message: 'Abonnement introuvable.',
        });
      const agreed = await this.agreedPrices(tx, dto.subscriptionId);
      if (!isProductBillable(agreed.sub.product.status)) {
        throw new ConflictException({
          code: 'PRODUCT_NOT_AVAILABLE',
          message: 'Produit non commercialisable : aucune facture possible.',
        });
      }
      const computed = computeInvoiceLines(dto.lines, {
        setupFee: agreed.setupFee,
        monthlyPrice: agreed.monthlyPrice,
      });
      if ('error' in computed)
        throw new BadRequestException({ code: 'INVOICE_LINES_INVALID', message: computed.error });
      const { year, sequence } = await nextPlatformSequence(tx, 'invoice');
      const issuedAt = new Date();
      const dueAt = dto.dueAt
        ? zonedMidnight(dto.dueAt, PLATFORM_TIMEZONE)
        : new Date(issuedAt.getTime() + INVOICE_DUE_DAYS * DAY_MS);
      const invoice = await tx.invoice.create({
        data: {
          number: formatInvoiceNumber(year, sequence),
          organizationId: agreed.sub.organizationId,
          subscriptionId: agreed.sub.id,
          productId: agreed.sub.productId,
          total: computed.total,
          issuedAt,
          dueAt,
          notes: dto.notes ?? null,
          createdById: auth.user.id,
          idempotencyKey: dto.idempotencyKey,
          lines: { create: computed.lines.map((l, position) => ({ ...l, position })) },
        },
        select: { id: true, number: true, total: true },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.invoice_issued',
          targetType: 'Invoice',
          targetId: invoice.id,
          metadata: {
            number: invoice.number,
            organizationId: agreed.sub.organizationId,
            total: invoice.total,
            lines: computed.lines.map((l) => ({ kind: l.kind, amount: l.amount })),
          },
        },
        tx,
      );
      return invoice.id;
    });
    return (await this.invoices({})).find((i) => i.id === id)!;
  }

  /** Annulation motivée ; impossible si un règlement est en attente ou validé. */
  async cancelInvoice(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({
        where: { id },
        select: {
          status: true,
          number: true,
          // Règlements encore engagés (déclarés, à vérifier, confirmés) : annulation impossible.
          payments: {
            where: { status: { in: ['DECLARED', 'PENDING_VERIFICATION', 'CONFIRMED'] } },
            select: { id: true },
          },
        },
      });
      if (!invoice)
        throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Facture introuvable.' });
      if (invoice.status !== 'ISSUED')
        throw new ConflictException({
          code: 'INVOICE_NOT_CANCELLABLE',
          message: 'Seule une facture émise et non payée peut être annulée.',
        });
      if (invoice.payments.length > 0)
        throw new ConflictException({
          code: 'INVOICE_HAS_PAYMENTS',
          message: 'Un règlement est rattaché à cette facture : rejetez-le d’abord.',
        });
      await tx.invoice.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.invoice_cancelled',
          targetType: 'Invoice',
          targetId: id,
          metadata: { number: invoice.number, reason },
        },
        tx,
      );
      return { id, status: 'CANCELLED' as const };
    });
  }

  // ─── Tableau de bord commercial ───

  /**
   * Encaissé (règlements validés, par date de règlement), facturé (factures émises non annulées),
   * MRR contractuel théorique (tarifs acceptés des abonnements actifs) et impayés : quatre notions
   * distinctes, jamais mélangées aux recettes des établissements clients.
   */
  async commercial(
    filters: { productCode?: string; from?: string; to?: string },
    now = new Date(),
  ): Promise<CommercialDashboard> {
    const { from, to, range } = platformPeriod(filters, now);
    const productWhere = filters.productCode ? { product: { code: filters.productCode } } : {};
    const orgWhere: Prisma.OrganizationWhereInput = filters.productCode
      ? { subscriptions: { some: productWhere } }
      : {};

    const [
      orgs,
      establishments,
      products,
      subs,
      payments,
      invoiced,
      active,
      unpaidInvoices,
      renewals,
      refunded,
      pendingActivations,
      demoNew,
      demoReceived,
    ] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], where: orgWhere, _count: { _all: true } }),
      this.prisma.establishment.count({ where: { organization: orgWhere } }),
      this.prisma.saasProduct.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          code: true,
          name: true,
          status: true,
          subscriptions: { select: { status: true } },
        },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        where: productWhere,
        _count: { _all: true },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { status: 'CONFIRMED', paidAt: range, subscription: productWhere },
        select: {
          amount: true,
          method: true,
          invoice: { select: { total: true, lines: { select: { kind: true, amount: true } } } },
        },
      }),
      this.prisma.invoice.aggregate({
        where: { status: { not: 'CANCELLED' }, issuedAt: range, ...productWhere },
        _sum: { total: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE', ...productWhere },
        select: { agreedMonthlyPrice: true, plan: { select: { monthlyPrice: true } } },
      }),
      this.prisma.invoice.findMany({
        where: { status: 'ISSUED', ...productWhere },
        select: {
          total: true,
          dueAt: true,
          payments: { where: { status: 'CONFIRMED' }, select: { amount: true } },
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: 'ACTIVE',
          expiresAt: { gte: now, lt: new Date(now.getTime() + SAAS_RENEWAL_WINDOW_DAYS * DAY_MS) },
          ...productWhere,
        },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: { status: 'REFUNDED', refundedAt: range, subscription: productWhere },
        _sum: { amount: true },
      }),
      this.prisma.subscriptionPayment.count({
        where: { status: 'CONFIRMED', activationStatus: 'PENDING', subscription: productWhere },
      }),
      this.prisma.demoRequest.count({
        where: {
          status: 'NEW',
          anonymizedAt: null,
          ...(filters.productCode ? { product: { code: filters.productCode } } : {}),
        },
      }),
      this.prisma.demoRequest.count({
        where: {
          createdAt: range,
          ...(filters.productCode ? { product: { code: filters.productCode } } : {}),
        },
      }),
    ]);
    const suspended = await this.prisma.organization.count({
      where: { ...orgWhere, status: 'SUSPENDED' },
    });

    // Ventilation par nature de ligne, au prorata du règlement (paiements partiels, Sprint 12A) ;
    // l'arrondi est porté par la dernière ligne pour que la somme soit exacte.
    const collected = {
      setup: 0,
      monthly: 0,
      adjustments: 0,
      unallocated: 0,
      total: 0,
      online: 0,
      cash: 0,
      transfer: 0,
    };
    for (const p of payments) {
      collected.total += p.amount;
      if (p.method === 'CINETPAY_CARD' || p.method === 'CINETPAY_MOBILE_MONEY')
        collected.online += p.amount;
      else if (p.method === 'CASH') collected.cash += p.amount;
      else collected.transfer += p.amount;
      if (!p.invoice || p.invoice.total <= 0) {
        collected.unallocated += p.amount;
        continue;
      }
      let allocated = 0;
      p.invoice.lines.forEach((l, i, all) => {
        const share =
          i === all.length - 1
            ? p.amount - allocated
            : Math.round((p.amount * l.amount) / p.invoice!.total);
        allocated += share;
        if (l.kind === 'SETUP') collected.setup += share;
        else if (l.kind === 'MONTHLY') collected.monthly += share;
        else collected.adjustments += share;
      });
    }
    const count = (status: string) => subs.find((s) => s.status === status)?._count._all ?? 0;
    const outstanding = unpaidInvoices.map((i) => ({
      amount: i.total - i.payments.reduce((t, x) => t + x.amount, 0),
      overdue: !!i.dueAt && i.dueAt < now,
    }));
    return {
      generatedAt: now.toISOString(),
      filters: { product: filters.productCode ?? null, from, to },
      organizations: {
        total: orgs.reduce((t, o) => t + o._count._all, 0),
        active: orgs.filter((o) => o.status === 'ACTIVE').reduce((t, o) => t + o._count._all, 0),
        suspended,
      },
      establishments,
      byProduct: products
        .filter((p) => !filters.productCode || p.code === filters.productCode)
        .map((p) => ({
          code: p.code,
          name: p.name,
          status: p.status,
          subscriptions: p.subscriptions.length,
          active: p.subscriptions.filter((s) => s.status === 'ACTIVE').length,
        })),
      subscriptions: {
        active: count('ACTIVE'),
        expired: count('EXPIRED'),
        pastDue: count('PAST_DUE'),
        notActivated: count('NOT_ACTIVATED'),
        canceled: count('CANCELED'),
        suspendedOrganizations: suspended,
        suspended: count('SUSPENDED'),
        pendingActivation: count('PENDING_ACTIVATION'),
      },
      collected,
      refunded: refunded._sum.amount ?? 0,
      pendingActivations,
      demoRequests: { new: demoNew, received: demoReceived },
      invoiced: invoiced._sum.total ?? 0,
      theoreticalMrr: active.reduce((t, s) => t + (s.agreedMonthlyPrice ?? s.plan.monthlyPrice), 0),
      unpaid: {
        amount: outstanding.reduce((t, o) => t + o.amount, 0),
        overdueAmount: outstanding.filter((o) => o.overdue).reduce((t, o) => t + o.amount, 0),
        invoices: outstanding.length,
      },
      renewalsNext30Days: renewals,
    };
  }

  // ─── Comptes internes Ocall ───

  async users() {
    const rows = await this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        loginId: true,
        platformRole: true,
        isActive: true,
        mfaEnabledAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((u) => ({
      ...u,
      role: effectivePlatformRole(u.platformRole),
      mfaEnabled: u.mfaEnabledAt !== null,
    }));
  }

  private assertCanManage(auth: AuthContext, target?: { id: string; platformRole: string | null }) {
    if (target) {
      if (target.id === auth.user.id) {
        throw new ForbiddenException({
          code: 'SELF_MANAGEMENT_FORBIDDEN',
          message: 'Vous ne pouvez pas modifier votre propre compte interne.',
        });
      }
      if (effectivePlatformRole(target.platformRole as never) === 'PLATFORM_OWNER') {
        throw new ForbiddenException({
          code: 'OWNER_PROTECTED',
          message: 'Le compte propriétaire ne se gère que par procédure serveur.',
        });
      }
    }
  }

  private assertAssignable(auth: AuthContext, role: PlatformRoleName) {
    if (!assignablePlatformRoles(auth.user.platformRole).includes(role)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_ASSIGNABLE',
        message: 'Ce rôle ne peut pas être attribué.',
      });
    }
  }

  /** Création d'un compte interne nominatif : mot de passe temporaire affiché une seule fois. */
  async createUser(
    auth: AuthContext,
    dto: { firstName: string; lastName: string; email: string; role: PlatformRoleName },
  ) {
    this.assertAssignable(auth, dto.role);
    if (await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Un compte existe déjà avec cette adresse.',
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          loginId: dto.email.toUpperCase(),
          passwordHash: await this.passwords.hash(temporaryPassword),
          mustChangePassword: true,
          platformRole: dto.role,
        },
        select: { id: true, email: true, platformRole: true },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.user_created',
          targetType: 'User',
          targetId: created.id,
          metadata: { email: dto.email, role: dto.role },
        },
        tx,
      );
      return created;
    });
    return { user, temporaryPassword };
  }

  async changeUserRole(auth: AuthContext, id: string, role: PlatformRoleName) {
    this.assertAssignable(auth, role);
    return this.updateUser(auth, id, 'platform.user_role_changed', { platformRole: role });
  }

  async setUserActive(auth: AuthContext, id: string, isActive: boolean) {
    return this.updateUser(
      auth,
      id,
      isActive ? 'platform.user_reactivated' : 'platform.user_deactivated',
      { isActive },
    );
  }

  /** Réinitialisation du second facteur d'un compte (perte du téléphone) : réenrôlement obligatoire. */
  async resetUserMfa(auth: AuthContext, id: string) {
    return this.updateUser(auth, id, 'platform.user_mfa_reset', {
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnabledAt: null,
      mfaRecoveryCodes: [],
      mfaLastStep: null,
    });
  }

  private async updateUser(
    auth: AuthContext,
    id: string,
    action: string,
    data: Prisma.UserUpdateInput,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, platformRole: true, email: true },
    });
    if (!target || !target.platformRole)
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Compte interne introuvable.',
      });
    this.assertCanManage(auth, target);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data });
      // Droits modifiés : les sessions en cours sont fermées.
      await this.sessions.revokeAllForUser(id, undefined, tx);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action,
          targetType: 'User',
          targetId: id,
          metadata: { email: target.email, from: target.platformRole, change: Object.keys(data) },
        },
        tx,
      );
    });
    return (await this.users()).find((u) => u.id === id)!;
  }

  // ─── Audit ───

  /** Journal des actions de la plateforme et des événements de sécurité des comptes internes. */
  async auditLog(limit = 100): Promise<AuditEntryView[]> {
    const internal = await this.prisma.user.findMany({
      where: { platformRole: { not: null } },
      select: { id: true },
    });
    const rows = await this.prisma.auditLog.findMany({
      where: { OR: [{ organizationId: null }, { actorUserId: { in: internal.map((u) => u.id) } }] },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        actorUserId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    const actors = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))] },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const name = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata as unknown,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      actor: r.actorUserId ? (name.get(r.actorUserId) ?? null) : null,
    }));
  }
}
