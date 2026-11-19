import type { PrismaClient } from '.prisma/print-client';

/**
 * Purge complète des données Ocall Print d'organisations (bases de test ; plus tard, suppression d'un
 * compte à l'issue de la durée légale de conservation). Une seule transaction, qui pose le réglage local
 * `ocall.print_purge` : le déclencheur du journal accepte alors la suppression, jamais la modification.
 * Les lignes dépendantes sont supprimées avant celles qu'elles citent. Les fichiers stockés (photos, logos)
 * ne sont pas touchés ici.
 */
export async function purgePrintOrganizations(
  db: PrismaClient,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('ocall.print_purge', 'on', true)`;
      const where = { organizationId: { in: organizationIds } };
      await tx.printOrderEvent.deleteMany({ where });
      await tx.printOrderItem.deleteMany({ where });
      await tx.printOrder.deleteMany({ where });
      await tx.printCard.deleteMany({ where });
      await tx.printPerson.deleteMany({ where });
      await tx.printTemplateVersion.deleteMany({ where });
      await tx.printTemplate.deleteMany({ where });
      await tx.printCounter.deleteMany({ where });
    },
    { timeout: 60_000 },
  );
}
