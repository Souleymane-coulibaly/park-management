import type { PrismaClient } from '.prisma/facture-client';

/**
 * Purge complète des données Ocall Facture d'organisations (bases de test ; plus tard, suppression d'un
 * compte à l'issue de la durée légale de conservation). Une seule transaction, qui pose le réglage local
 * `ocall.facture_purge` : les déclencheurs de la base acceptent alors la suppression des documents émis,
 * jamais leur modification. Les documents dérivés sont supprimés avant leur document d'origine.
 */
export async function purgeFactureOrganizations(
  db: PrismaClient,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('ocall.facture_purge', 'on', true)`;
      const where = { organizationId: { in: organizationIds } };
      await tx.facturePayment.deleteMany({ where });
      await tx.factureDocumentLine.deleteMany({ where });
      // Chaîne devis → pro forma → bon de commande → facture → avoir : d'abord les documents dont rien
      // ne découle.
      for (let pass = 0; pass < 20; pass++) {
        const { count } = await tx.factureDocument.deleteMany({
          where: { ...where, derived: { none: {} }, creditNotes: { none: {} } },
        });
        if (count === 0) break;
      }
      if ((await tx.factureDocument.count({ where })) > 0) {
        throw new Error('Purge Facture incomplète : documents encore liés.');
      }
      await tx.factureItem.deleteMany({ where });
      await tx.factureLogo.deleteMany({ where });
      await tx.factureClient.deleteMany({ where });
      await tx.factureMember.deleteMany({ where });
      await tx.factureNumberCounter.deleteMany({ where });
      await tx.factureSettings.deleteMany({ where });
      await tx.$executeRaw`SELECT set_config('ocall.facture_purge', 'off', true)`;
    },
    { timeout: 60_000 },
  );
}
