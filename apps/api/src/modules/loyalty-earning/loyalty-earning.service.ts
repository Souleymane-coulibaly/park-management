import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { computeEarnedPoints, formatSaleNumber } from '@ocall/shared';

/**
 * Fidélité côté moteur de vente. Appelé UNIQUEMENT dans une transaction qui détient déjà le verrou
 * de la vente (paiement, rattachement d'un client à une vente payée, annulation).
 *
 * - Les points ne sont crédités que sur une vente effectivement payée, sur le montant réellement payé
 *   (total après remise fidélité), dans le portefeuille de l'activité de la vente (Parc ou
 *   Restaurant) : jamais de transfert entre les deux.
 * - Idempotence : un seul crédit par vente (clé `earn:<vente>`, unique en base) ; la vérification
 *   préalable se fait sous le verrou de la vente, la contrainte d'unicité reste le dernier rempart.
 */
@Injectable()
export class LoyaltyEarningService {
  /** Vente payée : dernière visite du client, puis crédit des points si la règle est active. */
  async onPaidSale(
    tx: Prisma.TransactionClient,
    saleId: string,
    actorMembershipId: string | null,
  ): Promise<number> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        organizationId: true,
        customerId: true,
        activity: true,
        total: true,
        number: true,
        paymentStatus: true,
        status: true,
        customer: { select: { anonymizedAt: true } },
      },
    });
    if (!sale.customerId || sale.customer?.anonymizedAt) return 0;
    if (sale.paymentStatus !== 'PAID' || sale.status !== 'OPEN') return 0;
    await tx.customer.update({ where: { id: sale.customerId }, data: { lastVisitAt: new Date() } });

    const key = `earn:${saleId}`;
    const already = await tx.loyaltyTransaction.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId: sale.organizationId, idempotencyKey: key },
      },
      select: { id: true },
    });
    if (already) return 0;
    const rule = await tx.loyaltyRule.findUnique({
      where: {
        organizationId_activity: { organizationId: sale.organizationId, activity: sale.activity },
      },
      select: { isActive: true, earnAmountStep: true },
    });
    if (!rule?.isActive) return 0;
    const points = computeEarnedPoints(sale.total, rule.earnAmountStep);
    if (points === 0) return 0;

    const wallet = await tx.loyaltyWallet.upsert({
      where: { customerId_activity: { customerId: sale.customerId, activity: sale.activity } },
      create: {
        organizationId: sale.organizationId,
        customerId: sale.customerId,
        activity: sale.activity,
        balance: points,
      },
      update: { balance: { increment: points } },
      select: { id: true, balance: true },
    });
    await tx.loyaltyTransaction.create({
      data: {
        organizationId: sale.organizationId,
        walletId: wallet.id,
        kind: 'EARN',
        points,
        balanceAfter: wallet.balance,
        saleId,
        reason: `Vente n° ${formatSaleNumber(sale.number)}`,
        actorMembershipId,
        idempotencyKey: key,
      },
    });
    return points;
  }

  /**
   * Annule l'utilisation de points d'une vente NON payée (annulation de la vente ou retrait de la
   * remise) : points recrédités, total rétabli. Sans effet s'il n'y a rien à annuler.
   */
  async reverseRedemption(
    tx: Prisma.TransactionClient,
    saleId: string,
    actorMembershipId: string | null,
  ): Promise<boolean> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        organizationId: true,
        number: true,
        paymentStatus: true,
        loyaltyDiscount: true,
        loyaltyPointsRedeemed: true,
      },
    });
    if (sale.loyaltyPointsRedeemed === 0 || sale.paymentStatus === 'PAID') return false;
    const redeem = await tx.loyaltyTransaction.findFirst({
      where: { organizationId: sale.organizationId, saleId, kind: 'REDEEM' },
      orderBy: { createdAt: 'desc' },
      select: { walletId: true, id: true },
    });
    if (!redeem) return false;
    const wallet = await tx.loyaltyWallet.update({
      where: { id: redeem.walletId },
      data: { balance: { increment: sale.loyaltyPointsRedeemed } },
      select: { balance: true },
    });
    await tx.loyaltyTransaction.create({
      data: {
        organizationId: sale.organizationId,
        walletId: redeem.walletId,
        kind: 'REVERSAL',
        points: sale.loyaltyPointsRedeemed,
        balanceAfter: wallet.balance,
        saleId,
        reason: `Annulation de la remise, vente n° ${formatSaleNumber(sale.number)}`,
        actorMembershipId,
        // Une vente peut recevoir une remise, la perdre, puis en recevoir une autre : clé par mouvement.
        idempotencyKey: `reversal:${redeem.id}`,
      },
    });
    await tx.sale.update({
      where: { id: saleId },
      data: {
        total: { increment: sale.loyaltyDiscount },
        loyaltyDiscount: 0,
        loyaltyPointsRedeemed: 0,
      },
    });
    return true;
  }
}
