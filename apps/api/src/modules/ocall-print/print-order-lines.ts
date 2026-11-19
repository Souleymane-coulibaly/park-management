import type { Prisma } from '@ocall/print-database';
import { PRINT_ORDER_CANCELLABLE, type PrintOrderStatus } from '@ocall/shared';

type Tx = Prisma.TransactionClient;

/**
 * Recalcule la quantité facturée et le montant d'une commande : lignes à imprimer ou imprimées seulement
 * (une ligne refusée ou annulée n'est pas due). La commande est verrouillée par l'appelant.
 */
export async function recomputeOrder(tx: Tx, organizationId: string, orderId: string) {
  const order = await tx.printOrder.findFirstOrThrow({
    where: { id: orderId, organizationId },
    select: { unitPrice: true },
  });
  const quantity = await tx.printOrderItem.count({
    where: { organizationId, orderId, status: { in: ['PENDING', 'PRINTED'] } },
  });
  await tx.printOrder.update({
    where: { id: orderId },
    data: { quantity, totalAmount: quantity * order.unitPrice },
  });
  return quantity;
}

/** Verrou d'une commande (ligne), pris avant toute modification de ses lignes ou de son état. */
export async function lockOrder(tx: Tx, organizationId: string, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "PrintOrder" WHERE id = ${orderId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
}

/**
 * Carte révoquée (perte, départ, remplacement) : ses lignes encore à imprimer, dans une commande dont la
 * production n'a pas commencé, sont annulées et la commande recalculée ; une commande sans plus aucune
 * ligne est annulée. Une carte déjà en production reste dans sa commande : son QR sera refusé.
 */
export async function releaseCardLines(
  tx: Tx,
  organizationId: string,
  cardId: string,
  actorUserId: string,
  reason: string,
) {
  const lines = await tx.printOrderItem.findMany({
    where: { organizationId, cardId, status: 'PENDING' },
    select: { id: true, orderId: true },
  });
  for (const line of lines) {
    await lockOrder(tx, organizationId, line.orderId);
    const order = await tx.printOrder.findFirstOrThrow({
      where: { id: line.orderId, organizationId },
      select: { status: true },
    });
    if (!PRINT_ORDER_CANCELLABLE.includes(order.status as PrintOrderStatus)) continue;
    await tx.printOrderItem.update({
      where: { id: line.id },
      data: { status: 'CANCELLED', rejectReason: 'Carte révoquée' },
    });
    const quantity = await recomputeOrder(tx, organizationId, line.orderId);
    await tx.printOrderEvent.create({
      data: {
        organizationId,
        orderId: line.orderId,
        type: 'ITEM_CANCELLED_CARD_REVOKED',
        actorKind: 'CLIENT',
        actorUserId,
        details: { itemId: line.id, reason },
      },
    });
    if (quantity === 0) {
      await tx.printOrder.update({
        where: { id: line.orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          closedReason: 'Toutes les cartes de la commande ont été révoquées.',
        },
      });
      await tx.printOrderEvent.create({
        data: {
          organizationId,
          orderId: line.orderId,
          type: 'CANCELLED',
          actorKind: 'SYSTEM',
          details: { reason: 'ALL_CARDS_REVOKED' },
        },
      });
    }
  }
}
