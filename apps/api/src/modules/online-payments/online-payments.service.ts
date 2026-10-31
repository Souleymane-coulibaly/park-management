import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@ocall/database';
import {
  addDays,
  invoiceRemaining,
  isProductBillable,
  isSubscriptionCurrent,
  localMoment,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { SubscriptionPaymentsService } from '../platform/payments.service';
import {
  type OnlineChannel,
  PAYMENT_PROVIDER,
  type OnlinePaymentProvider,
  PaymentProviderError,
  type VerifyResult,
} from './providers/payment-provider';

type Tx = Prisma.TransactionClient;
const FINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REVIEW_REQUIRED', 'REFUNDED']);

/** Ajoute des mois à une date AAAA-MM-JJ (fin de mois bornée : 31 janv. + 1 mois → 28/29 févr.). */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

const ONLINE_SELECT = {
  id: true,
  reference: true,
  provider: true,
  amount: true,
  currency: true,
  channels: true,
  status: true,
  paymentMethod: true,
  providerTransactionId: true,
  failureCode: true,
  failureMessage: true,
  confirmedAt: true,
  lastCheckedAt: true,
  createdAt: true,
  invoice: { select: { id: true, number: true, status: true, total: true } },
  organization: { select: { id: true, name: true } },
  subscriptionPaymentId: true,
} satisfies Prisma.OnlinePaymentSelect;

/**
 * Paiement en ligne des factures SaaS (Sprint 12A).
 *
 * Parcours : le client lance le paiement d'une facture → référence unique et persistante →
 * redirection vers le prestataire → notification (simple signal, authentifiée) ou retour du
 * client → VÉRIFICATION SERVEUR auprès du prestataire → contrôle de la référence, du montant, de
 * la devise et de la facture → règlement confirmé (une seule fois) → facture payée → activation
 * selon le mode figé de l'abonnement. Aucune donnée de carte ; aucun prélèvement récurrent.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger('OnlinePayments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: SubscriptionPaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: OnlinePaymentProvider | null,
  ) {}

  get available(): boolean {
    return this.provider !== null;
  }

  // ─── Espace client ───

  /** Factures Ocall de l'organisation, avec leur reste dû et la possibilité de payer en ligne. */
  async invoices(auth: TenantContext) {
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId: auth.membership.organizationId },
      orderBy: { issuedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        total: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
        product: { select: { name: true, status: true } },
        lines: { orderBy: { position: 'asc' }, select: { kind: true, label: true, amount: true } },
        payments: { select: { amount: true, status: true } },
        onlinePayments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reference: true, status: true, createdAt: true },
        },
      },
    });
    return rows.map(({ payments, onlinePayments, product, ...i }) => {
      const remaining = i.status === 'ISSUED' ? invoiceRemaining(i.total, payments) : 0;
      return {
        ...i,
        product: product.name,
        remaining,
        payableOnline:
          this.available &&
          i.status === 'ISSUED' &&
          remaining > 0 &&
          isProductBillable(product.status),
        lastOnlinePayment: onlinePayments[0] ?? null,
      };
    });
  }

  /**
   * Lance le paiement en ligne du reste dû d'une facture. Une tentative récente encore en cours
   * est réutilisée (même référence) ; sinon une nouvelle référence est créée. L'appel au
   * prestataire a lieu hors transaction.
   */
  async initiate(auth: TenantContext, invoiceId: string, channels: OnlineChannel) {
    const provider = this.requireProvider();
    const organizationId = auth.membership.organizationId;
    const prepared = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          currency: true,
          subscriptionId: true,
          product: { select: { name: true, status: true } },
          payments: { select: { amount: true, status: true } },
          organization: { select: { name: true } },
        },
      });
      if (!invoice) {
        throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'Facture introuvable.' });
      }
      if (invoice.status !== 'ISSUED') {
        throw new ConflictException({
          code: 'INVOICE_NOT_PAYABLE',
          message: 'Cette facture est déjà payée ou annulée.',
        });
      }
      if (!isProductBillable(invoice.product.status)) {
        throw new ConflictException({
          code: 'PRODUCT_NOT_AVAILABLE',
          message: 'Ce produit n’est pas commercialisé : paiement impossible.',
        });
      }
      const remaining = invoiceRemaining(invoice.total, invoice.payments);
      if (remaining <= 0) {
        throw new ConflictException({
          code: 'INVOICE_FULLY_COVERED',
          message: 'Cette facture est déjà couverte par des règlements en cours de vérification.',
        });
      }
      const ttl = this.config.onlinePayments.pendingTtlMinutes * 60_000;
      const open = await tx.onlinePayment.findFirst({
        where: { invoiceId, status: { in: ['CREATED', 'PENDING'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (open) {
        const fresh = Date.now() - open.createdAt.getTime() < ttl;
        if (fresh && open.paymentUrl && open.amount === remaining && open.channels === channels) {
          return { reuse: true as const, online: open, invoice };
        }
        if (fresh) {
          throw new ConflictException({
            code: 'ONLINE_PAYMENT_IN_PROGRESS',
            message:
              'Un paiement est déjà en cours pour cette facture. Réessayez dans quelques minutes.',
            reference: open.reference,
          });
        }
      }
      const online = await tx.onlinePayment.create({
        data: {
          reference: `OCS${randomBytes(9).toString('hex').toUpperCase()}`,
          provider: provider.name,
          organizationId,
          invoiceId,
          subscriptionId: invoice.subscriptionId,
          amount: remaining,
          currency: invoice.currency,
          channels,
          initiatedById: auth.user.id,
        },
      });
      await tx.onlinePaymentEvent.create({
        data: {
          onlinePaymentId: online.id,
          type: 'INITIATED',
          toStatus: 'CREATED',
          detail: { amount: remaining, channels },
        },
      });
      const payer = await tx.user.findUniqueOrThrow({
        where: { id: auth.user.id },
        select: { email: true },
      });
      return { reuse: false as const, online, invoice, payer };
    });
    if (prepared.reuse) {
      return { reference: prepared.online.reference, paymentUrl: prepared.online.paymentUrl! };
    }

    const { online, invoice, payer } = prepared;
    try {
      const result = await provider.initiate({
        reference: online.reference,
        amount: online.amount,
        currency: online.currency,
        description: `Facture ${invoice.number} — ${invoice.product.name}`,
        channels,
        notifyUrl: `${this.config.onlinePayments.publicApiUrl}/api/v1/online-payments/notify`,
        returnUrl: `${this.config.onlinePayments.webAppUrl}/app/abonnement/paiement/${online.reference}`,
        customer: {
          name: invoice.organization.name,
          email: payer.email,
          phone: null,
        },
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.onlinePayment.update({
          where: { id: online.id },
          data: {
            status: 'PENDING',
            paymentUrl: result.paymentUrl,
            providerTransactionId: result.providerTransactionId,
          },
        });
        await tx.onlinePaymentEvent.create({
          data: {
            onlinePaymentId: online.id,
            type: 'REDIRECTED',
            fromStatus: 'CREATED',
            toStatus: 'PENDING',
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: auth.user.id,
            action: 'billing.online_payment_initiated',
            targetType: 'OnlinePayment',
            targetId: online.id,
            metadata: { reference: online.reference, invoiceId, amount: online.amount, channels },
          },
          tx,
        );
      });
      return { reference: online.reference, paymentUrl: result.paymentUrl };
    } catch (e) {
      const message = e instanceof PaymentProviderError ? e.message : 'Prestataire indisponible.';
      await this.prisma.$transaction(async (tx) => {
        await tx.onlinePayment.update({
          where: { id: online.id },
          data: { status: 'FAILED', failureCode: 'INITIATION_FAILED', failureMessage: message },
        });
        await tx.onlinePaymentEvent.create({
          data: {
            onlinePaymentId: online.id,
            type: 'INITIATION_FAILED',
            fromStatus: 'CREATED',
            toStatus: 'FAILED',
            detail: { message },
          },
        });
      });
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        message: 'Le paiement en ligne est momentanément indisponible. Réessayez plus tard.',
      });
    }
  }

  /**
   * État d'un paiement pour le client (page de retour). Le retour du navigateur ne confirme
   * rien : un paiement encore en cours est revérifié auprès du prestataire.
   */
  async status(auth: TenantContext, reference: string) {
    const online = await this.prisma.onlinePayment.findFirst({
      where: { reference, organizationId: auth.membership.organizationId },
      select: { id: true, status: true },
    });
    if (!online) {
      throw new NotFoundException({
        code: 'ONLINE_PAYMENT_NOT_FOUND',
        message: 'Paiement introuvable.',
      });
    }
    if (!FINAL.has(online.status)) await this.verifyAndSettle(reference, 'RETURN');
    return this.view(reference);
  }

  // ─── Notifications et vérification ───

  /**
   * Notification du prestataire : authentifiée, puis toujours revérifiée. Une notification non
   * authentique est journalisée et ignorée (aucun effet). Répond vite et sans détail.
   */
  async notify(headers: Record<string, string | string[] | undefined>, body: unknown) {
    const provider = this.requireProvider();
    const reference = provider.authenticateNotification(headers, body);
    if (!reference) {
      this.logger.warn('Notification de paiement non authentique ignorée.');
      return { received: false };
    }
    const exists = await this.prisma.onlinePayment.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (!exists) {
      this.logger.warn('Notification pour une référence inconnue ignorée.');
      return { received: false };
    }
    await this.prisma.onlinePaymentEvent.create({
      data: { onlinePaymentId: exists.id, type: 'NOTIFICATION_RECEIVED' },
    });
    await this.verifyAndSettle(reference, 'NOTIFICATION');
    return { received: true };
  }

  /**
   * Vérification serveur puis règlement, idempotents : la vérification a lieu hors transaction,
   * l'application sous verrou du paiement en ligne ; un paiement déjà final n'est jamais rejoué.
   */
  async verifyAndSettle(reference: string, trigger: 'NOTIFICATION' | 'RETURN' | 'ADMIN') {
    const provider = this.requireProvider();
    const before = await this.prisma.onlinePayment.findUnique({
      where: { reference },
      select: { status: true },
    });
    if (!before || FINAL.has(before.status)) return;
    let verified: VerifyResult;
    try {
      verified = await provider.verify(reference);
    } catch (e) {
      this.logger.warn(`Vérification impossible (${reference}) : ${String(e)}`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OnlinePayment" WHERE "reference" = ${reference} FOR UPDATE`;
      const online = await tx.onlinePayment.findUniqueOrThrow({
        where: { reference },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          invoiceId: true,
          subscriptionId: true,
          organizationId: true,
          initiatedById: true,
          providerTransactionId: true,
        },
      });
      if (FINAL.has(online.status)) return; // déjà traité (notifications répétées)
      const detail = {
        trigger,
        providerStatus: verified.status,
        providerCode: verified.providerCode,
        amount: verified.amount,
        currency: verified.currency,
      };
      await tx.onlinePayment.update({
        where: { id: online.id },
        data: { lastCheckedAt: new Date() },
      });
      if (verified.status === 'PENDING') {
        await tx.onlinePaymentEvent.create({
          data: { onlinePaymentId: online.id, type: 'VERIFIED_PENDING', detail },
        });
        return;
      }
      if (verified.status === 'FAILED' || verified.status === 'CANCELLED') {
        await this.finish(tx, online.id, online.status, verified.status, detail, {
          failureCode: verified.providerCode ?? verified.status,
        });
        return;
      }
      // Succès annoncé : contrôle de cohérence avant tout encaissement.
      const mismatch =
        verified.amount !== online.amount
          ? 'AMOUNT_MISMATCH'
          : verified.currency !== online.currency
            ? 'CURRENCY_MISMATCH'
            : verified.providerTransactionId &&
                online.providerTransactionId &&
                verified.providerTransactionId !== online.providerTransactionId
              ? 'TRANSACTION_MISMATCH'
              : null;
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: online.invoiceId },
        select: {
          status: true,
          total: true,
          payments: { select: { amount: true, status: true } },
          lines: { select: { kind: true, quantity: true } },
          subscription: {
            select: { status: true, expiresAt: true, organization: { select: { timezone: true } } },
          },
        },
      });
      const invoiceProblem =
        invoice.status !== 'ISSUED'
          ? 'INVOICE_NOT_PAYABLE'
          : invoiceRemaining(invoice.total, invoice.payments) < online.amount
            ? 'INVOICE_ALREADY_COVERED'
            : null;
      const problem = mismatch ?? invoiceProblem;
      if (problem) {
        // Argent peut-être reçu mais incohérent : jamais encaissé automatiquement, à examiner.
        await this.finish(tx, online.id, online.status, 'REVIEW_REQUIRED', detail, {
          failureCode: problem,
          failureMessage: 'Paiement annoncé réussi mais incohérent : examen par Ocall.',
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: null,
            action: 'platform.online_payment_review_required',
            targetType: 'OnlinePayment',
            targetId: online.id,
            metadata: { reference, problem, announced: verified.amount, expected: online.amount },
          },
          tx,
        );
        return;
      }

      // Période couverte : à la suite de l'échéance en cours, ou à partir d'aujourd'hui.
      const months = invoice.lines
        .filter((l) => l.kind === 'MONTHLY')
        .reduce((t, l) => t + l.quantity, 0);
      const tz = invoice.subscription.organization.timezone;
      const today = localMoment(new Date(), tz).date;
      const current = isSubscriptionCurrent(invoice.subscription);
      const start =
        current && invoice.subscription.expiresAt
          ? localMoment(invoice.subscription.expiresAt, tz).date
          : today;
      const end = months > 0 ? addDays(addMonths(start, months), -1) : start;
      const method = verified.method === 'CARD' ? 'CINETPAY_CARD' : 'CINETPAY_MOBILE_MONEY';
      const sub = await tx.subscription.findUniqueOrThrow({
        where: { id: online.subscriptionId },
        select: { planId: true },
      });
      const payment = await tx.subscriptionPayment.create({
        data: {
          organizationId: online.organizationId,
          subscriptionId: online.subscriptionId,
          planId: sub.planId,
          invoiceId: online.invoiceId,
          amount: online.amount,
          currency: online.currency,
          method,
          reference,
          paidAt: new Date(),
          periodStart: new Date(`${start}T00:00:00Z`),
          periodEnd: new Date(`${end}T00:00:00Z`),
          status: 'CONFIRMED',
          validatedAt: new Date(),
          recordedById: online.initiatedById,
          note: `Paiement en ligne vérifié (${provider.name}).`,
        },
        select: { id: true },
      });
      await tx.onlinePayment.update({
        where: { id: online.id },
        data: {
          subscriptionPaymentId: payment.id,
          paymentMethod: verified.method,
          providerTransactionId: verified.providerTransactionId ?? online.providerTransactionId,
        },
      });
      await this.finish(tx, online.id, online.status, 'SUCCEEDED', detail, {});
      const settlement = await this.payments.settleConfirmedPayment(tx, payment.id, null, {
        activate: months > 0,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: null,
          action: 'platform.online_payment_confirmed',
          targetType: 'OnlinePayment',
          targetId: online.id,
          metadata: {
            reference,
            amount: online.amount,
            subscriptionPaymentId: payment.id,
            trigger,
            period: [start, end],
            invoicePaid: settlement.invoicePaid,
            activation: settlement.activation,
          },
        },
        tx,
      );
    });
  }

  private async finish(
    tx: Tx,
    id: string,
    from: string,
    to: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVIEW_REQUIRED',
    detail: Record<string, unknown>,
    extra: { failureCode?: string; failureMessage?: string },
  ) {
    await tx.onlinePayment.update({
      where: { id },
      data: {
        status: to,
        ...(to === 'SUCCEEDED' ? { confirmedAt: new Date() } : {}),
        ...(extra.failureCode ? { failureCode: extra.failureCode } : {}),
        ...(extra.failureMessage ? { failureMessage: extra.failureMessage } : {}),
      },
    });
    await tx.onlinePaymentEvent.create({
      data: {
        onlinePaymentId: id,
        type: 'VERIFIED',
        fromStatus: from as 'PENDING',
        toStatus: to,
        detail: detail as Prisma.InputJsonObject,
      },
    });
  }

  // ─── Super Admin ───

  async list(query: { status?: string; organizationId?: string }) {
    return this.prisma.onlinePayment.findMany({
      where: {
        ...(query.status ? { status: query.status as 'PENDING' } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: ONLINE_SELECT,
    });
  }

  async detail(id: string) {
    const row = await this.prisma.onlinePayment.findUnique({
      where: { id },
      select: {
        ...ONLINE_SELECT,
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            detail: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ONLINE_PAYMENT_NOT_FOUND',
        message: 'Paiement introuvable.',
      });
    }
    return row;
  }

  /** Revérification manuelle par Ocall (paiement resté en attente). */
  async recheck(id: string) {
    const row = await this.prisma.onlinePayment.findUnique({
      where: { id },
      select: { reference: true },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ONLINE_PAYMENT_NOT_FOUND',
        message: 'Paiement introuvable.',
      });
    }
    await this.verifyAndSettle(row.reference, 'ADMIN');
    return this.detail(id);
  }

  async view(reference: string) {
    const row = await this.prisma.onlinePayment.findUniqueOrThrow({
      where: { reference },
      select: {
        reference: true,
        status: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        confirmedAt: true,
        failureCode: true,
        invoice: { select: { id: true, number: true, status: true } },
        subscription: { select: { status: true, expiresAt: true } },
        subscriptionPayment: { select: { activationStatus: true } },
      },
    });
    return {
      ...row,
      activationStatus: row.subscriptionPayment?.activationStatus ?? null,
      subscriptionPayment: undefined,
    };
  }

  requireProvider(): OnlinePaymentProvider {
    if (!this.provider) {
      throw new ServiceUnavailableException({
        code: 'ONLINE_PAYMENT_DISABLED',
        message: 'Le paiement en ligne n’est pas activé.',
      });
    }
    return this.provider;
  }

  /** Contrôle d'entrée d'une référence reçue du client. */
  static assertReference(reference: string) {
    if (!/^OCS[0-9A-F]{18}$/.test(reference)) {
      throw new BadRequestException({ code: 'REFERENCE_INVALID', message: 'Référence invalide.' });
    }
  }

  /** Vrai si la référence appartient à l'organisation (contrôle d'accès des pages client). */
  async ownedBy(reference: string, organizationId: string): Promise<boolean> {
    const n = await this.prisma.onlinePayment.count({ where: { reference, organizationId } });
    return n === 1;
  }
}
