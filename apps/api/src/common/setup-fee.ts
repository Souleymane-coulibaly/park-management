import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';

/**
 * Frais de mise en service (socle S1) : facturés UNE SEULE FOIS par organisation et application,
 * jamais au renouvellement ni au passage à l'offre avec vitrine. La ligne `ProductSetupFee` est
 * verrouillée (FOR UPDATE) pendant la transaction de facturation : deux factures simultanées ne
 * peuvent pas porter chacune le setup. Toutes ces fonctions s'exécutent dans la transaction de
 * l'appelant.
 */

/** Réserve le setup pour une facture ; refus s'il est déjà facturé, réglé ou non dû. */
export async function reserveSetupFee(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; productId: string; amount: number; invoiceId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "ProductSetupFee" ("id", "organizationId", "productId", "amount", "status", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${input.organizationId}::uuid, ${input.productId}::uuid, ${input.amount}, 'DUE', now(), now())
    ON CONFLICT ("organizationId", "productId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT "id", "status"::text AS "status" FROM "ProductSetupFee"
    WHERE "organizationId" = ${input.organizationId}::uuid AND "productId" = ${input.productId}::uuid
    FOR UPDATE`;
  const row = rows[0]!;
  if (row.status !== 'DUE') {
    throw new ConflictException({
      code: 'SETUP_FEE_ALREADY_BILLED',
      message:
        row.status === 'WAIVED'
          ? 'Aucun frais de mise en service n’est dû pour cette application.'
          : 'Les frais de mise en service de cette application ont déjà été facturés : ils ne sont jamais refacturés.',
    });
  }
  await tx.productSetupFee.update({
    where: { id: row.id },
    data: {
      status: 'INVOICED',
      amount: input.amount,
      invoiceId: input.invoiceId,
      invoicedAt: new Date(),
    },
  });
}

/** Facture annulée avant paiement : le setup redevient facturable. */
export async function releaseSetupFee(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  await tx.productSetupFee.updateMany({
    where: { invoiceId, status: 'INVOICED' },
    data: { status: 'DUE', invoiceId: null, invoicedAt: null },
  });
}

/** Facture soldée : le setup qu'elle portait est réglé. */
export async function markSetupFeePaid(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  paidAt: Date,
): Promise<void> {
  await tx.productSetupFee.updateMany({
    where: { invoiceId, status: 'INVOICED' },
    data: { status: 'PAID', paidAt },
  });
}
