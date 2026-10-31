import type { Prisma } from '@ocall/database';
import { allocatePayment, computeCommissions } from '@ocall/shared';

type Tx = Prisma.TransactionClient;

/**
 * Moteur de commissions des partenaires (Sprint 12B), appelé dans la transaction de la
 * confirmation (ou du remboursement) d'un règlement. Règles :
 * - uniquement sur un règlement CONFIRMÉ (jamais une déclaration ni une facture impayée) ;
 * - uniquement si l'organisation a une attribution CONFIRMÉE à un partenaire actif ;
 * - règle applicable : celle figée sur l'attribution, sinon celle du partenaire si active, sinon
 *   la règle active du produit, sinon la règle active générale ; aucune règle → aucune commission ;
 * - une commission par règlement et par nature (contrainte d'unicité : aucun doublon).
 */
export async function accrueCommissions(tx: Tx, paymentId: string): Promise<number> {
  const p = await tx.subscriptionPayment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      paidAt: true,
      organizationId: true,
      invoice: { select: { total: true, lines: { select: { kind: true, amount: true } } } },
      subscription: { select: { startedAt: true, productId: true } },
    },
  });
  if (p.status !== 'CONFIRMED' || !p.invoice) return 0;
  const attribution = await tx.attribution.findFirst({
    where: { organizationId: p.organizationId, status: 'CONFIRMED' },
    select: {
      id: true,
      partnerId: true,
      rule: true,
      partner: { select: { status: true, commissionRule: true } },
    },
  });
  if (!attribution || attribution.partner.status !== 'ACTIVE') return 0;
  const productId = p.subscription.productId;
  const rule =
    attribution.rule ??
    (attribution.partner.commissionRule?.isActive ? attribution.partner.commissionRule : null) ??
    (await tx.commissionRule.findFirst({
      where: { isActive: true, productId },
      orderBy: { validatedAt: 'desc' },
    })) ??
    (await tx.commissionRule.findFirst({
      where: { isActive: true, productId: null },
      orderBy: { validatedAt: 'desc' },
    }));
  if (!rule) return 0;
  const allocation = allocatePayment(p.invoice.lines, p.invoice.total, p.amount);
  const lines = computeCommissions({
    allocation,
    rule,
    windowStart: p.subscription.startedAt ?? p.paidAt,
    paidAt: p.paidAt,
  });
  if (lines.length === 0) return 0;
  const created = await tx.commission.createMany({
    data: lines.map((l) => ({
      partnerId: attribution.partnerId,
      attributionId: attribution.id,
      subscriptionPaymentId: p.id,
      organizationId: p.organizationId,
      productId,
      kind: l.kind,
      baseAmount: l.baseAmount,
      rateBps: l.rateBps,
      amount: l.amount,
      currency: p.currency,
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Remboursement ou litige sur un règlement : ses commissions non versées sont annulées ; si une
 * commission a déjà été versée, une régularisation négative est créée (déduite du prochain
 * versement). Idempotent.
 */
export async function reverseCommissions(
  tx: Tx,
  paymentId: string,
  reason: string,
): Promise<{ reversed: number; adjustment: number }> {
  const reversed = await tx.commission.updateMany({
    where: {
      subscriptionPaymentId: paymentId,
      kind: { not: 'ADJUSTMENT' },
      status: { in: ['ACCRUED', 'VALIDATED'] },
      payoutId: null,
    },
    data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: reason },
  });
  const paid = await tx.commission.findMany({
    where: {
      subscriptionPaymentId: paymentId,
      kind: { not: 'ADJUSTMENT' },
      OR: [{ status: 'PAID' }, { payoutId: { not: null }, status: { not: 'REVERSED' } }],
    },
    select: {
      amount: true,
      partnerId: true,
      attributionId: true,
      organizationId: true,
      productId: true,
      currency: true,
    },
  });
  const total = paid.reduce((t, c) => t + c.amount, 0);
  if (total > 0) {
    const ref = paid[0]!;
    const created = await tx.commission.createMany({
      data: [
        {
          partnerId: ref.partnerId,
          attributionId: ref.attributionId,
          subscriptionPaymentId: paymentId,
          organizationId: ref.organizationId,
          productId: ref.productId,
          kind: 'ADJUSTMENT',
          baseAmount: 0,
          rateBps: 0,
          amount: -total,
          currency: ref.currency,
          reversalReason: reason,
        },
      ],
      skipDuplicates: true,
    });
    return { reversed: reversed.count, adjustment: created.count ? -total : 0 };
  }
  return { reversed: reversed.count, adjustment: 0 };
}
