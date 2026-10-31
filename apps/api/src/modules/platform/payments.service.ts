import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  OPEN_PAYMENT_STATUSES,
  SUBSCRIPTION_PAYMENT_MAX_PERIOD_DAYS,
  type SubscriptionPaymentView,
  addDays,
  canConfirmPayment,
  formatReceiptNumber,
  formatRemittanceNumber,
  invoiceRemaining,
  isSubscriptionCurrent,
  localMoment,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { PLATFORM_TIMEZONE, nextPlatformSequence } from '../../common/platform-counter';
import { extendSubscription, markInvoicePaidIfSettled } from '../../common/subscription-billing';
import type {
  DeclareRemittanceDto,
  DeclareSubscriptionPaymentDto,
  PaymentsQueryDto,
  ReconciliationQueryDto,
} from './payments.dto';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const isRealDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

const PERSON = { select: { firstName: true, lastName: true } } as const;
const fullName = (u: { firstName: string; lastName: string } | null) =>
  u ? `${u.firstName} ${u.lastName}` : null;

export const PAYMENT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  method: true,
  reference: true,
  paidAt: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  note: true,
  validatedAt: true,
  rejectionReason: true,
  subscriptionExtended: true,
  createdAt: true,
  recordedById: true,
  collectedById: true,
  receiptNumber: true,
  receiptReference: true,
  activationStatus: true,
  activationDecisionReason: true,
  refundedAt: true,
  refundReason: true,
  organization: { select: { id: true, name: true } },
  plan: { select: { id: true, name: true } },
  invoice: { select: { id: true, number: true } },
  recordedBy: PERSON,
  validatedBy: PERSON,
  collectedBy: PERSON,
  remittance: { select: { number: true } },
} satisfies Prisma.SubscriptionPaymentSelect;

type PaymentRow = Prisma.SubscriptionPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export function paymentView(p: PaymentRow): SubscriptionPaymentView {
  return {
    id: p.id,
    organization: p.organization,
    plan: p.plan,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    reference: p.reference,
    paidAt: dateOnly(p.paidAt),
    periodStart: dateOnly(p.periodStart),
    periodEnd: dateOnly(p.periodEnd),
    status: p.status,
    note: p.note,
    recordedBy: fullName(p.recordedBy) ?? '',
    validatedBy: fullName(p.validatedBy),
    validatedAt: p.validatedAt?.toISOString() ?? null,
    rejectionReason: p.rejectionReason,
    subscriptionExtended: p.subscriptionExtended,
    createdAt: p.createdAt.toISOString(),
    invoice: p.invoice,
    recordedById: p.recordedById,
    collectedById: p.collectedById,
    collectedBy: fullName(p.collectedBy),
    receiptNumber: p.receiptNumber,
    receiptReference: p.receiptReference,
    activationStatus: p.activationStatus,
    activationDecisionReason: p.activationDecisionReason,
    refundedAt: p.refundedAt?.toISOString() ?? null,
    refundReason: p.refundReason,
    remittanceNumber: p.remittance?.number ?? null,
  };
}

export type ActivationOutcome = {
  mode: 'AUTO' | 'ADMIN_APPROVAL';
  /** applied : abonnement activé ou prolongé ; pending : en attente d'approbation d'Ocall. */
  result: 'applied' | 'pending';
  subscriptionStatus: string;
  expiresAt: string | null;
  /** Raison d'un passage en approbation alors que le mode est AUTO (produit, abonnement…). */
  blockedBy: string | null;
};

/**
 * Règlements des abonnements SaaS (Sprint 12A) : déclaration manuelle (espèces, virement),
 * confirmation à quatre yeux, rejet, annulation, remboursement, décision d'activation, remises
 * d'espèces et rapprochement de caisse. Le paiement en ligne vérifié réutilise la confirmation
 * et l'activation (`settleConfirmedPayment`).
 *
 * Règles : une déclaration n'est jamais un encaissement ; seule la confirmation (ou un paiement
 * en ligne vérifié) l'est. L'activation suit le mode figé de l'abonnement, séparée du statut du
 * règlement. Aucun prélèvement ni renouvellement automatique.
 */
@Injectable()
export class SubscriptionPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaymentsQueryDto): Promise<SubscriptionPaymentView[]> {
    const rows = await this.prisma.subscriptionPayment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.activationStatus ? { activationStatus: query.activationStatus } : {}),
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      },
      select: PAYMENT_SELECT,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(paymentView);
  }

  /** Nombre d'activations à approuver (notification interne du Super Admin). */
  pendingActivations(): Promise<number> {
    return this.prisma.subscriptionPayment.count({
      where: { activationStatus: 'PENDING', status: 'CONFIRMED' },
    });
  }

  // ─── Déclaration ───

  async declare(auth: AuthContext, dto: DeclareSubscriptionPaymentDto) {
    this.assertDates(dto);
    if (dto.method === 'CASH' && !dto.receiptReference) {
      throw new BadRequestException({
        code: 'RECEIPT_REFERENCE_REQUIRED',
        message: 'Espèces : la référence du reçu remis au client est obligatoire.',
      });
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Verrou de la facture : deux déclarations simultanées ne dépassent pas le reste dû.
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${dto.invoiceId}::uuid FOR UPDATE`;
        const invoice = await tx.invoice.findFirst({
          where: { id: dto.invoiceId, organizationId: dto.organizationId },
          select: {
            id: true,
            status: true,
            total: true,
            currency: true,
            subscriptionId: true,
            subscription: { select: { planId: true } },
            payments: { select: { amount: true, status: true } },
          },
        });
        if (!invoice) {
          throw new NotFoundException({
            code: 'INVOICE_NOT_FOUND',
            message: 'Facture introuvable pour ce client.',
          });
        }
        if (invoice.status !== 'ISSUED') {
          throw new ConflictException({
            code: 'INVOICE_NOT_PAYABLE',
            message: 'Cette facture est déjà payée ou annulée.',
          });
        }
        if (dto.currency !== invoice.currency) {
          throw new BadRequestException({
            code: 'CURRENCY_MISMATCH',
            message: `La facture est en ${invoice.currency}.`,
          });
        }
        const remaining = invoiceRemaining(invoice.total, invoice.payments);
        if (dto.amount > remaining) {
          throw new ConflictException({
            code: remaining === 0 ? 'INVOICE_FULLY_COVERED' : 'PAYMENT_EXCEEDS_REMAINING',
            message:
              remaining === 0
                ? 'Cette facture est déjà couverte par des règlements confirmés ou en cours.'
                : `Le montant dépasse le reste dû (${remaining} ${invoice.currency}).`,
            remaining,
          });
        }
        if (dto.reference) {
          const duplicate = await tx.subscriptionPayment.findFirst({
            where: {
              organizationId: dto.organizationId,
              reference: { equals: dto.reference, mode: 'insensitive' },
              status: { notIn: ['REJECTED', 'CANCELLED'] },
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new ConflictException({
              code: 'PAYMENT_DUPLICATE',
              message: 'Un règlement avec cette référence est déjà enregistré pour ce client.',
            });
          }
        }
        const cash = dto.method === 'CASH';
        let collectedById: string | null = null;
        let receiptNumber: string | null = null;
        if (cash) {
          collectedById = dto.collectedById ?? auth.user.id;
          if (collectedById !== auth.user.id) await this.assertInternalUser(tx, collectedById);
          const { year, sequence } = await nextPlatformSequence(tx, 'receipt');
          receiptNumber = formatReceiptNumber(year, sequence);
        }
        const payment = await tx.subscriptionPayment.create({
          data: {
            organizationId: dto.organizationId,
            subscriptionId: invoice.subscriptionId,
            planId: invoice.subscription.planId,
            invoiceId: invoice.id,
            amount: dto.amount,
            currency: invoice.currency,
            method: dto.method,
            reference: dto.reference ?? null,
            paidAt: new Date(`${dto.paidAt}T12:00:00Z`),
            periodStart: new Date(`${dto.periodStart}T00:00:00Z`),
            periodEnd: new Date(`${dto.periodEnd}T00:00:00Z`),
            note: dto.note ?? null,
            status: 'PENDING_VERIFICATION',
            recordedById: auth.user.id,
            collectedById,
            receiptNumber,
            receiptReference: cash ? dto.receiptReference! : null,
          },
          select: PAYMENT_SELECT,
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'platform.subscription_payment_declared',
            targetType: 'SubscriptionPayment',
            targetId: payment.id,
            metadata: {
              organizationId: dto.organizationId,
              invoiceId: invoice.id,
              amount: dto.amount,
              method: dto.method,
              receiptNumber,
              remainingBefore: remaining,
            },
          },
          tx,
        );
        return payment;
      });
      return paymentView(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'RECEIPT_DUPLICATE',
          message: 'Ce reçu est déjà enregistré pour ce client.',
        });
      }
      throw e;
    }
  }

  // ─── Confirmation, rejet, annulation ───

  /**
   * Confirmation d'un règlement manuel : par un utilisateur distinct du déclarant et du collecteur
   * (contrôle à quatre yeux). Transition conditionnelle : deux confirmations n'en appliquent
   * qu'une. Si la facture est alors soldée, l'activation suit le mode figé de l'abonnement.
   */
  async confirm(auth: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findPayment(tx, id);
      if (!canConfirmPayment(auth.user.id, current)) {
        throw new ForbiddenException({
          code: 'SELF_CONFIRMATION_FORBIDDEN',
          message:
            'Un règlement est confirmé par une autre personne que son déclarant ou collecteur.',
        });
      }
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'PENDING_VERIFICATION' },
        data: { status: 'CONFIRMED', validatedById: auth.user.id, validatedAt: new Date() },
      });
      if (claimed.count === 0) this.notInStatus(current.status, 'à vérifier');
      const settlement = await this.settleConfirmedPayment(tx, id, auth.user.id);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_confirmed',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { amount: current.amount, method: current.method, ...settlement },
        },
        tx,
      );
      const payment = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id },
        select: PAYMENT_SELECT,
      });
      return { payment: paymentView(payment), ...settlement };
    });
  }

  async reject(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findPayment(tx, id);
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: { in: [...OPEN_PAYMENT_STATUSES] } },
        data: {
          status: 'REJECTED',
          validatedById: auth.user.id,
          validatedAt: new Date(),
          rejectionReason: reason,
        },
      });
      if (claimed.count === 0) this.notInStatus(current.status, 'en cours');
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_rejected',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { organizationId: current.organizationId, reason },
        },
        tx,
      );
      return paymentView(
        await tx.subscriptionPayment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT }),
      );
    });
  }

  /** Annulation par le déclarant (ou un validateur) avant confirmation. */
  async cancel(auth: AuthContext, id: string, reason: string, canValidate: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findPayment(tx, id);
      if (current.recordedById !== auth.user.id && !canValidate) {
        throw new ForbiddenException({
          code: 'NOT_DECLARANT',
          message: 'Seul le déclarant ou un validateur peut annuler ce règlement.',
        });
      }
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: { in: [...OPEN_PAYMENT_STATUSES] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: auth.user.id,
          rejectionReason: reason,
        },
      });
      if (claimed.count === 0) this.notInStatus(current.status, 'en cours');
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_cancelled',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { organizationId: current.organizationId, reason },
        },
        tx,
      );
      return paymentView(
        await tx.subscriptionPayment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT }),
      );
    });
  }

  /**
   * Remboursement (saisie manuelle après remboursement chez le prestataire ou en espèces) : le
   * règlement n'est plus encaissé, la facture redevient à payer si elle n'est plus soldée.
   * L'abonnement n'est pas modifié automatiquement (suspension éventuelle : action explicite).
   */
  async refund(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.findPayment(tx, id);
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'CONFIRMED' },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          refundedById: auth.user.id,
          refundReason: reason,
          ...(current.activationStatus === 'PENDING'
            ? { activationStatus: 'REFUSED' as const, activationDecisionReason: reason }
            : {}),
        },
      });
      if (claimed.count === 0) this.notInStatus(current.status, 'confirmé');
      let invoiceReopened = false;
      if (current.invoiceId) {
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: current.invoiceId },
          select: {
            total: true,
            status: true,
            payments: { where: { status: 'CONFIRMED' }, select: { amount: true } },
          },
        });
        const paid = invoice.payments.reduce((t, p) => t + p.amount, 0);
        if (invoice.status === 'PAID' && paid < invoice.total) {
          await tx.invoice.update({
            where: { id: current.invoiceId },
            data: { status: 'ISSUED', paidAt: null },
          });
          invoiceReopened = true;
        }
      }
      const online = await tx.onlinePayment.findUnique({
        where: { subscriptionPaymentId: id },
        select: { id: true, status: true },
      });
      if (online) {
        await tx.onlinePayment.update({ where: { id: online.id }, data: { status: 'REFUNDED' } });
        await tx.onlinePaymentEvent.create({
          data: {
            onlinePaymentId: online.id,
            type: 'REFUND_RECORDED',
            fromStatus: online.status,
            toStatus: 'REFUNDED',
            detail: { reason },
          },
        });
      }
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.subscription_payment_refunded',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { amount: current.amount, reason, invoiceReopened },
        },
        tx,
      );
      return paymentView(
        await tx.subscriptionPayment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT }),
      );
    });
  }

  // ─── Activation (mode figé de l'abonnement) ───

  /**
   * Après un encaissement confirmé (manuel ou en ligne) : facture soldée → activation selon le
   * mode figé de l'abonnement. Une facture partiellement réglée n'active rien. À appeler dans la
   * transaction de la confirmation.
   */
  async settleConfirmedPayment(
    tx: Tx,
    paymentId: string,
    actorUserId: string | null,
    options: { activate?: boolean } = {},
  ) {
    const payment = await tx.subscriptionPayment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { invoiceId: true, paidAt: true },
    });
    const invoicePaid = payment.invoiceId
      ? await markInvoicePaidIfSettled(tx, payment.invoiceId, payment.paidAt)
      : false;
    // Une facture sans mensualité (frais de mise en service seuls) ne prolonge rien.
    const activation =
      invoicePaid && options.activate !== false
        ? await this.applyActivation(tx, paymentId, actorUserId)
        : null;
    return { invoicePaid, activation };
  }

  private async applyActivation(
    tx: Tx,
    paymentId: string,
    actorUserId: string | null,
  ): Promise<ActivationOutcome> {
    const p = await tx.subscriptionPayment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        id: true,
        reference: true,
        receiptNumber: true,
        periodStart: true,
        periodEnd: true,
        subscription: {
          select: { id: true, status: true, expiresAt: true, activationMode: true },
        },
      },
    });
    const sub = p.subscription;
    const label = p.receiptNumber ?? p.reference ?? p.id;
    if (sub.activationMode === 'AUTO') {
      try {
        const ext = await extendSubscription(tx, {
          subscriptionId: sub.id,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          actorUserId,
          reason: `Activation automatique après encaissement confirmé (${label}).`,
        });
        await tx.subscriptionPayment.update({
          where: { id: p.id },
          data: {
            subscriptionExtended: true,
            activationStatus: 'APPROVED',
            activationDecidedAt: new Date(),
            activationDecisionReason: 'Activation automatique (mode AUTO).',
          },
        });
        return {
          mode: 'AUTO',
          result: 'applied',
          subscriptionStatus: ext.status,
          expiresAt: ext.expiresAt,
          blockedBy: null,
        };
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        // Conditions non remplies (produit non commercialisé, abonnement résilié ou suspendu) :
        // rien n'est activé, la décision revient à Ocall.
        const code = (e.getResponse() as { code?: string }).code ?? 'ACTIVATION_BLOCKED';
        await this.markPending(tx, p.id, sub, `Activation automatique impossible : ${code}.`);
        return {
          mode: 'AUTO',
          result: 'pending',
          subscriptionStatus: sub.status,
          expiresAt: sub.expiresAt?.toISOString() ?? null,
          blockedBy: code,
        };
      }
    }
    const status = await this.markPending(tx, p.id, sub, null);
    return {
      mode: 'ADMIN_APPROVAL',
      result: 'pending',
      subscriptionStatus: status,
      expiresAt: sub.expiresAt?.toISOString() ?? null,
      blockedBy: null,
    };
  }

  /**
   * Activation en attente d'Ocall. Un abonnement en cours de validité reste actif (seule la
   * prolongation attend) ; sinon il passe « payé, activation en attente ».
   */
  private async markPending(
    tx: Tx,
    paymentId: string,
    sub: { id: string; status: string; expiresAt: Date | null },
    note: string | null,
  ): Promise<string> {
    await tx.subscriptionPayment.update({
      where: { id: paymentId },
      data: { activationStatus: 'PENDING', activationDecisionReason: note },
    });
    const current = isSubscriptionCurrent({
      status: sub.status as 'ACTIVE',
      expiresAt: sub.expiresAt,
    });
    if (current || sub.status === 'CANCELED' || sub.status === 'SUSPENDED') return sub.status;
    if (sub.status !== 'PENDING_ACTIVATION') {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'PENDING_ACTIVATION' },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: sub.id,
          type: 'STATUS_CHANGED',
          fromStatus: sub.status as 'NOT_ACTIVATED',
          toStatus: 'PENDING_ACTIVATION',
          reason: 'Encaissement confirmé, activation soumise à l’approbation d’Ocall.',
        },
      });
    }
    return 'PENDING_ACTIVATION';
  }

  async approveActivation(auth: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'CONFIRMED', activationStatus: 'PENDING' },
        data: {
          activationStatus: 'APPROVED',
          activationDecidedById: auth.user.id,
          activationDecidedAt: new Date(),
          subscriptionExtended: true,
        },
      });
      if (claimed.count === 0) await this.notPendingActivation(tx, id);
      const p = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id },
        select: {
          subscriptionId: true,
          periodStart: true,
          periodEnd: true,
          receiptNumber: true,
          reference: true,
          amount: true,
        },
      });
      const ext = await extendSubscription(tx, {
        subscriptionId: p.subscriptionId,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        actorUserId: auth.user.id,
        reason: `Activation approuvée par Ocall (${p.receiptNumber ?? p.reference ?? id}).`,
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.activation_approved',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { subscriptionId: p.subscriptionId, expiresAt: ext.expiresAt },
        },
        tx,
      );
      return { subscription: ext };
    });
  }

  /**
   * Refus d'activation (motif obligatoire) : le paiement reste encaissé et compté ; il est à
   * rembourser (saisie du remboursement séparée). Un abonnement « activation en attente » revient
   * à son état précédent (non activé ou expiré).
   */
  async refuseActivation(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscriptionPayment.updateMany({
        where: { id, status: 'CONFIRMED', activationStatus: 'PENDING' },
        data: {
          activationStatus: 'REFUSED',
          activationDecidedById: auth.user.id,
          activationDecidedAt: new Date(),
          activationDecisionReason: reason,
        },
      });
      if (claimed.count === 0) await this.notPendingActivation(tx, id);
      const p = await tx.subscriptionPayment.findUniqueOrThrow({
        where: { id },
        select: {
          subscriptionId: true,
          subscription: { select: { status: true, startedAt: true } },
        },
      });
      const others = await tx.subscriptionPayment.count({
        where: { subscriptionId: p.subscriptionId, activationStatus: 'PENDING', id: { not: id } },
      });
      if (p.subscription.status === 'PENDING_ACTIVATION' && others === 0) {
        const back = p.subscription.startedAt ? 'EXPIRED' : 'NOT_ACTIVATED';
        await tx.subscription.update({ where: { id: p.subscriptionId }, data: { status: back } });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: p.subscriptionId,
            type: 'STATUS_CHANGED',
            fromStatus: 'PENDING_ACTIVATION',
            toStatus: back,
            actorUserId: auth.user.id,
            reason: `Activation refusée : ${reason}`,
          },
        });
      }
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.activation_refused',
          targetType: 'SubscriptionPayment',
          targetId: id,
          metadata: { subscriptionId: p.subscriptionId, reason },
        },
        tx,
      );
      return paymentView(
        await tx.subscriptionPayment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT }),
      );
    });
  }

  // ─── Remises d'espèces et rapprochement de caisse ───

  async listRemittances() {
    const rows = await this.prisma.cashRemittance.findMany({
      orderBy: { remittedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        number: true,
        amount: true,
        currency: true,
        remittedAt: true,
        reference: true,
        status: true,
        note: true,
        confirmedAt: true,
        rejectionReason: true,
        collectorId: true,
        recordedById: true,
        collector: PERSON,
        recordedBy: PERSON,
        confirmedBy: PERSON,
        _count: { select: { payments: true } },
      },
    });
    return rows.map(({ collector, recordedBy, confirmedBy, _count, remittedAt, ...r }) => ({
      ...r,
      remittedAt: dateOnly(remittedAt),
      collector: fullName(collector),
      recordedBy: fullName(recordedBy),
      confirmedBy: fullName(confirmedBy),
      payments: _count.payments,
    }));
  }

  /**
   * Remise d'espèces : règlements en espèces CONFIRMÉS du collecteur, pas encore remis. Le
   * montant est calculé par le serveur. Sous verrou des règlements (pas de double remise).
   */
  async declareRemittance(auth: AuthContext, dto: DeclareRemittanceDto) {
    if (!isRealDate(dto.remittedAt)) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: 'Date de remise invalide.' });
    }
    const ids = [...new Set(dto.paymentIds)];
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SubscriptionPayment" WHERE "id" = ANY(${ids}::uuid[]) FOR UPDATE`;
      const payments = await tx.subscriptionPayment.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          collectedById: true,
          remittanceId: true,
        },
      });
      const invalid = ids.filter((id) => {
        const p = payments.find((x) => x.id === id);
        return (
          !p ||
          p.method !== 'CASH' ||
          p.status !== 'CONFIRMED' ||
          p.collectedById !== dto.collectorId ||
          p.remittanceId !== null
        );
      });
      if (invalid.length > 0) {
        throw new ConflictException({
          code: 'REMITTANCE_PAYMENTS_INVALID',
          message:
            'Seuls les règlements en espèces confirmés de ce collecteur, pas encore remis, peuvent être remis.',
          invalid,
        });
      }
      const currencies = new Set(payments.map((p) => p.currency));
      if (currencies.size !== 1) {
        throw new BadRequestException({
          code: 'CURRENCY_MISMATCH',
          message: 'Une remise ne mélange pas plusieurs devises.',
        });
      }
      const { year, sequence } = await nextPlatformSequence(tx, 'remittance');
      const remittance = await tx.cashRemittance.create({
        data: {
          number: formatRemittanceNumber(year, sequence),
          collectorId: dto.collectorId,
          amount: payments.reduce((t, p) => t + p.amount, 0),
          currency: [...currencies][0]!,
          remittedAt: new Date(`${dto.remittedAt}T12:00:00Z`),
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          recordedById: auth.user.id,
        },
      });
      await tx.subscriptionPayment.updateMany({
        where: { id: { in: ids } },
        data: { remittanceId: remittance.id },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.cash_remittance_declared',
          targetType: 'CashRemittance',
          targetId: remittance.id,
          metadata: { number: remittance.number, amount: remittance.amount, payments: ids.length },
        },
        tx,
      );
      return remittance;
    });
  }

  /** Confirmation d'une remise : par une autre personne que le collecteur et le déclarant. */
  async confirmRemittance(auth: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.cashRemittance.findUnique({
        where: { id },
        select: { id: true, status: true, collectorId: true, recordedById: true, number: true },
      });
      if (!r) {
        throw new NotFoundException({
          code: 'REMITTANCE_NOT_FOUND',
          message: 'Remise introuvable.',
        });
      }
      if (
        !canConfirmPayment(auth.user.id, {
          recordedById: r.recordedById,
          collectedById: r.collectorId,
        })
      ) {
        throw new ForbiddenException({
          code: 'SELF_CONFIRMATION_FORBIDDEN',
          message:
            'Une remise est confirmée par une autre personne que son collecteur ou déclarant.',
        });
      }
      const claimed = await tx.cashRemittance.updateMany({
        where: { id, status: 'DECLARED' },
        data: { status: 'CONFIRMED', confirmedById: auth.user.id, confirmedAt: new Date() },
      });
      if (claimed.count === 0) this.notInStatus(r.status, 'déclarée');
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.cash_remittance_confirmed',
          targetType: 'CashRemittance',
          targetId: id,
          metadata: { number: r.number },
        },
        tx,
      );
      return { id, status: 'CONFIRMED' as const };
    });
  }

  /** Rejet d'une remise : ses règlements redeviennent « à remettre ». */
  async rejectRemittance(auth: AuthContext, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashRemittance.updateMany({
        where: { id, status: 'DECLARED' },
        data: {
          status: 'REJECTED',
          confirmedById: auth.user.id,
          confirmedAt: new Date(),
          rejectionReason: reason,
        },
      });
      if (claimed.count === 0) {
        const r = await tx.cashRemittance.findUnique({ where: { id }, select: { status: true } });
        if (!r) {
          throw new NotFoundException({
            code: 'REMITTANCE_NOT_FOUND',
            message: 'Remise introuvable.',
          });
        }
        this.notInStatus(r.status, 'déclarée');
      }
      await tx.subscriptionPayment.updateMany({
        where: { remittanceId: id },
        data: { remittanceId: null },
      });
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.cash_remittance_rejected',
          targetType: 'CashRemittance',
          targetId: id,
          metadata: { reason },
        },
        tx,
      );
      return { id, status: 'REJECTED' as const };
    });
  }

  /**
   * Rapprochement de caisse par collecteur sur la période (date de collecte) : espèces déclarées,
   * confirmées, rejetées ou annulées, remises (confirmées ou en attente) et écart à remettre.
   */
  async reconciliation(query: ReconciliationQueryDto) {
    const where: Prisma.SubscriptionPaymentWhereInput = {
      method: 'CASH',
      ...(query.from || query.to
        ? {
            paidAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59Z`) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.subscriptionPayment.findMany({
      where,
      select: {
        amount: true,
        status: true,
        collectedById: true,
        collectedBy: PERSON,
        remittance: { select: { status: true } },
      },
    });
    const byCollector = new Map<
      string,
      {
        collectorId: string;
        collector: string | null;
        inProgress: number;
        confirmed: number;
        rejectedOrCancelled: number;
        refunded: number;
        remittedConfirmed: number;
        remittedPending: number;
        toRemit: number;
      }
    >();
    for (const r of rows) {
      const key = r.collectedById ?? 'inconnu';
      const line =
        byCollector.get(key) ??
        byCollector
          .set(key, {
            collectorId: key,
            collector: fullName(r.collectedBy),
            inProgress: 0,
            confirmed: 0,
            rejectedOrCancelled: 0,
            refunded: 0,
            remittedConfirmed: 0,
            remittedPending: 0,
            toRemit: 0,
          })
          .get(key)!;
      if (OPEN_PAYMENT_STATUSES.includes(r.status)) line.inProgress += r.amount;
      else if (r.status === 'REJECTED' || r.status === 'CANCELLED')
        line.rejectedOrCancelled += r.amount;
      else if (r.status === 'REFUNDED') line.refunded += r.amount;
      else if (r.status === 'CONFIRMED') {
        line.confirmed += r.amount;
        if (r.remittance?.status === 'CONFIRMED') line.remittedConfirmed += r.amount;
        else if (r.remittance?.status === 'DECLARED') line.remittedPending += r.amount;
        else line.toRemit += r.amount;
      }
    }
    return [...byCollector.values()].sort((a, b) => b.toRemit - a.toRemit);
  }

  // ─── Outils ───

  private assertDates(dto: { paidAt: string; periodStart: string; periodEnd: string }) {
    for (const d of [dto.paidAt, dto.periodStart, dto.periodEnd]) {
      if (!isRealDate(d)) {
        throw new BadRequestException({ code: 'INVALID_DATE', message: `Date invalide : ${d}.` });
      }
    }
    if (dto.periodEnd < dto.periodStart) {
      throw new BadRequestException({
        code: 'PERIOD_INVERTED',
        message: 'La fin de période précède son début.',
      });
    }
    const span =
      (Date.parse(`${dto.periodEnd}T00:00:00Z`) - Date.parse(`${dto.periodStart}T00:00:00Z`)) /
        DAY_MS +
      1;
    if (span > SUBSCRIPTION_PAYMENT_MAX_PERIOD_DAYS) {
      throw new BadRequestException({
        code: 'PERIOD_TOO_LONG',
        message: 'La période couverte ne peut pas dépasser 3 ans.',
      });
    }
    const today = localMoment(new Date(), PLATFORM_TIMEZONE).date;
    if (dto.paidAt > addDays(today, 1)) {
      throw new BadRequestException({
        code: 'PAID_IN_FUTURE',
        message: 'La date du règlement ne peut pas être dans le futur.',
      });
    }
  }

  private async assertInternalUser(tx: Tx, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, isActive: true },
    });
    if (!user?.platformRole || !user.isActive) {
      throw new BadRequestException({
        code: 'COLLECTOR_INVALID',
        message: 'Le collecteur doit être un compte interne Ocall actif.',
      });
    }
  }

  private async findPayment(tx: Tx, id: string) {
    const p = await tx.subscriptionPayment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        amount: true,
        method: true,
        organizationId: true,
        invoiceId: true,
        recordedById: true,
        collectedById: true,
        activationStatus: true,
      },
    });
    if (!p) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Règlement introuvable.' });
    }
    return p;
  }

  private notInStatus(status: string, expected: string): never {
    throw new ConflictException({
      code: 'PAYMENT_STATUS_CONFLICT',
      message: `Ce règlement n’est pas ${expected} (statut actuel : ${status}).`,
      status,
    });
  }

  private async notPendingActivation(tx: Tx, id: string): Promise<never> {
    const p = await tx.subscriptionPayment.findUnique({
      where: { id },
      select: { activationStatus: true },
    });
    if (!p) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Règlement introuvable.' });
    }
    throw new ConflictException({
      code: 'ACTIVATION_NOT_PENDING',
      message: 'Aucune activation en attente pour ce règlement.',
      activationStatus: p.activationStatus,
    });
  }
}
