import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { addDays, isProductBillable, zonedMidnight } from '@ocall/shared';

/**
 * Règles communes de facturation des abonnements SaaS (Sprint 12A), utilisées par la validation
 * manuelle d'un règlement, le paiement en ligne vérifié (mode AUTO) et l'approbation d'Ocall
 * (mode ADMIN_APPROVAL). Toutes s'exécutent dans la transaction de l'appelant.
 */

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** Statuts depuis lesquels un abonnement ne peut pas être prolongé sans action explicite. */
const NOT_EXTENDABLE = new Set(['CANCELED', 'SUSPENDED']);

export type ExtensionResult = {
  status: 'ACTIVE';
  expiresAt: string;
  changed: boolean;
};

/** Facture soldée par ses règlements validés → payée (une seule fois). Vrai si elle vient de l'être. */
export async function markInvoicePaidIfSettled(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  paidAt: Date,
): Promise<boolean> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      total: true,
      payments: { where: { status: 'CONFIRMED' }, select: { amount: true } },
    },
  });
  if (invoice.payments.reduce((t, x) => t + x.amount, 0) < invoice.total) return false;
  const paid = await tx.invoice.updateMany({
    where: { id: invoiceId, status: 'ISSUED' },
    data: { status: 'PAID', paidAt },
  });
  return paid.count === 1;
}

/**
 * Vérifie qu'un abonnement peut être activé ou prolongé : produit commercialisé (ou en pilote),
 * abonnement ni résilié ni suspendu. Lève une erreur métier sinon (A45, A46).
 */
export async function assertExtendable(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
): Promise<void> {
  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { status: true, product: { select: { status: true } } },
  });
  if (!isProductBillable(sub.product.status)) {
    throw new ConflictException({
      code: 'PRODUCT_NOT_AVAILABLE',
      message: 'Ce produit n’est pas commercialisé : aucune activation possible.',
    });
  }
  if (NOT_EXTENDABLE.has(sub.status)) {
    throw new ConflictException({
      code: 'SUBSCRIPTION_NOT_EXTENDABLE',
      message:
        sub.status === 'CANCELED'
          ? 'Abonnement résilié : il ne peut pas être réactivé par un règlement.'
          : 'Abonnement suspendu : réactivez-le explicitement avant de le prolonger.',
    });
  }
}

/**
 * Active ou prolonge un abonnement jusqu'à la fin de la période payée (incluse), sans jamais
 * raccourcir son échéance. À la première activation, le tarif en vigueur devient le tarif
 * accepté, figé, et ouvre l'historique des tarifs. Sous verrou de l'abonnement.
 */
export async function extendSubscription(
  tx: Prisma.TransactionClient,
  input: {
    subscriptionId: string;
    periodStart: Date;
    periodEnd: Date;
    actorUserId: string | null;
    reason: string;
  },
): Promise<ExtensionResult> {
  await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${input.subscriptionId}::uuid FOR UPDATE`;
  await assertExtendable(tx, input.subscriptionId);
  const s = await tx.subscription.findUniqueOrThrow({
    where: { id: input.subscriptionId },
    select: {
      id: true,
      status: true,
      planId: true,
      startedAt: true,
      expiresAt: true,
      agreedMonthlyPrice: true,
      plan: { select: { setupFee: true, monthlyPrice: true, currency: true } },
      organization: { select: { timezone: true } },
    },
  });
  const tz = s.organization.timezone;
  const target = zonedMidnight(addDays(dateOnly(input.periodEnd), 1), tz);
  const expiresAt = s.expiresAt && s.expiresAt > target ? s.expiresAt : target;
  const changed = s.status !== 'ACTIVE' || s.expiresAt?.getTime() !== expiresAt.getTime();
  if (changed) {
    const firstAgreement = s.agreedMonthlyPrice === null;
    const now = new Date();
    await tx.subscription.update({
      where: { id: s.id },
      data: {
        status: 'ACTIVE',
        startedAt: s.startedAt ?? zonedMidnight(dateOnly(input.periodStart), tz),
        expiresAt,
        ...(firstAgreement
          ? {
              agreedSetupFee: s.plan.setupFee,
              agreedMonthlyPrice: s.plan.monthlyPrice,
              agreedAt: now,
            }
          : {}),
      },
    });
    if (firstAgreement) {
      await recordPriceChange(tx, {
        subscriptionId: s.id,
        planId: s.planId,
        setupFee: s.plan.setupFee,
        monthlyPrice: s.plan.monthlyPrice,
        currency: s.plan.currency,
        actorUserId: input.actorUserId,
        reason: 'Tarif accepté à la première activation',
        at: now,
      });
    }
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: s.id,
        type: 'STATUS_CHANGED',
        fromStatus: s.status,
        toStatus: 'ACTIVE',
        actorUserId: input.actorUserId,
        reason: input.reason,
      },
    });
  }
  return { status: 'ACTIVE', expiresAt: expiresAt.toISOString(), changed };
}

/**
 * Historique des tarifs appliqués : clôt la ligne courante et en ouvre une nouvelle. Avec
 * `monthlyPrice` null, clôt seulement (tarif à accepter de nouveau, ex. changement de métier).
 */
export async function recordPriceChange(
  tx: Prisma.TransactionClient,
  input: {
    subscriptionId: string;
    planId: string;
    setupFee: number | null;
    monthlyPrice: number | null;
    currency: string;
    actorUserId: string | null;
    reason: string;
    at?: Date;
  },
): Promise<void> {
  const at = input.at ?? new Date();
  await tx.subscriptionPriceHistory.updateMany({
    where: { subscriptionId: input.subscriptionId, effectiveTo: null },
    data: { effectiveTo: at },
  });
  if (input.monthlyPrice === null) return;
  await tx.subscriptionPriceHistory.create({
    data: {
      subscriptionId: input.subscriptionId,
      planId: input.planId,
      setupFee: input.setupFee ?? 0,
      monthlyPrice: input.monthlyPrice,
      currency: input.currency,
      effectiveFrom: at,
      reason: input.reason,
      actorUserId: input.actorUserId,
    },
  });
}
