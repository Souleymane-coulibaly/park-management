import type { PrismaClient } from '.prisma/stock-client';

/**
 * Purge complète des données Ocall Stock d'organisations (bases de test ; plus tard, suppression d'un
 * compte à l'issue de la durée légale de conservation). Une seule transaction, qui pose le réglage local
 * `ocall.stock_purge` : les déclencheurs acceptent alors la suppression des historiques en ajout seul,
 * jamais leur modification. Les lignes dépendantes sont supprimées avant celles qu'elles citent.
 */
export async function purgeStockOrganizations(
  db: PrismaClient,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('ocall.stock_purge', 'on', true)`;
      const where = { organizationId: { in: organizationIds } };
      await tx.stockProductHistory.deleteMany({ where });
      await tx.stockPriceHistory.deleteMany({ where });
      await tx.stockBarcode.deleteMany({ where });
      await tx.stockProductImage.deleteMany({ where });
      await tx.stockVariant.deleteMany({ where });
      await tx.stockProduct.deleteMany({ where });
      // Sous-catégories avant leurs catégories.
      await tx.stockCategory.deleteMany({ where: { ...where, parentId: { not: null } } });
      await tx.stockCategory.deleteMany({ where });
      await tx.stockBrand.deleteMany({ where });
      await tx.stockSupplier.deleteMany({ where });
      await tx.stockMemberPermission.deleteMany({ where });
      await tx.stockMember.deleteMany({ where });
      await tx.stockNumberCounter.deleteMany({ where });
      await tx.stockSettings.deleteMany({ where });
    },
    { timeout: 60_000 },
  );
}
