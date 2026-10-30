import { Injectable } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { formatSaleNumber } from '@ocall/shared';

/**
 * Déduction des ingrédients d'une vente de restaurant selon les recettes.
 *
 * Moment de la déduction : à la PREMIÈRE de ces deux actions — envoi explicite en cuisine, ou
 * paiement. Une commande envoyée en cuisine consomme ses ingrédients même si elle est réglée plus
 * tard ; une vente au comptoir jamais envoyée en cuisine les consomme à l'encaissement.
 *
 * Idempotence, à deux niveaux :
 * 1. `Sale.stockDeductedAt` est revendiqué par une mise à jour conditionnelle (une seule transaction
 *    peut le faire passer de null à une date) ;
 * 2. chaque mouvement porte la clé unique `sale:<vente>:<article>` : même en cas d'erreur de
 *    programmation, une seconde déduction serait rejetée par la base.
 *
 * L'appelant détient déjà le verrou de la vente (même transaction).
 */
@Injectable()
export class StockConsumptionService {
  async consumeForSale(
    tx: Prisma.TransactionClient,
    saleId: string,
    actorMembershipId: string | null,
  ): Promise<number> {
    const claimed = await tx.sale.updateMany({
      where: { id: saleId, activity: 'RESTAURANT', stockDeductedAt: null },
      data: { stockDeductedAt: new Date() },
    });
    if (claimed.count === 0) return 0;

    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        organizationId: true,
        establishmentId: true,
        number: true,
        lines: { where: { variantId: { not: null } }, select: { variantId: true, quantity: true } },
      },
    });
    const variantIds = [...new Set(sale.lines.map((l) => l.variantId!))];
    if (variantIds.length === 0) return 0;

    // Seuls les ingrédients de l'établissement de la vente sont consommés.
    const components = await tx.recipeComponent.findMany({
      where: {
        organizationId: sale.organizationId,
        variantId: { in: variantIds },
        stockItem: { establishmentId: sale.establishmentId, isActive: true },
      },
      select: { variantId: true, stockItemId: true, quantity: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of sale.lines) {
      for (const c of components.filter((c) => c.variantId === line.variantId)) {
        const used = c.quantity.mul(line.quantity);
        totals.set(c.stockItemId, (totals.get(c.stockItemId) ?? new Prisma.Decimal(0)).add(used));
      }
    }

    // Ordre stable des articles : deux déductions concurrentes verrouillent les lignes dans le même
    // ordre (pas d'interblocage).
    const ordered = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [stockItemId, quantity] of ordered) {
      const item = await tx.stockItem.update({
        where: { id: stockItemId },
        data: { quantity: { decrement: quantity } },
        select: { quantity: true },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: sale.organizationId,
          establishmentId: sale.establishmentId,
          stockItemId,
          kind: 'SALE',
          quantity: quantity.neg(),
          quantityAfter: item.quantity,
          saleId,
          actorMembershipId,
          reason: `Vente n° ${formatSaleNumber(sale.number)}`,
          idempotencyKey: `sale:${saleId}:${stockItemId}`,
        },
      });
    }
    return ordered.length;
  }
}
