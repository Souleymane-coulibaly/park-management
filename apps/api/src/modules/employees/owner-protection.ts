import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/database';

/**
 * Refuse toute opération qui laisserait l'organisation sans propriétaire actif.
 *
 * Le verrou FOR UPDATE sur la ligne de l'organisation sérialise les opérations
 * concurrentes : deux propriétaires qui se rétrogradent mutuellement au même instant
 * ne peuvent pas passer tous les deux le contrôle.
 */
export async function assertKeepsAnActiveOwner(
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipLosingOwnership: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
  const remainingOwners = await tx.organizationMembership.count({
    where: {
      organizationId,
      role: 'OWNER',
      isActive: true,
      user: { isActive: true },
      id: { not: membershipLosingOwnership },
    },
  });
  if (remainingOwners === 0) {
    throw new ConflictException({
      code: 'LAST_OWNER',
      message: "Impossible : l'organisation doit conserver au moins un propriétaire actif.",
    });
  }
}
