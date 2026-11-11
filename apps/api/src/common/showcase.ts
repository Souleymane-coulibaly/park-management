import { ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@ocall/database';
import { canPublishShowcase } from '@ocall/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Option vitrine (socle S1, décision D5) : publier un site vitrine exige, pour un contrat conclu
 * depuis le socle S1, une offre « avec vitrine ». Sont préservés sans modification rétroactive :
 * - les organisations antérieures au socle S1 (site déjà publié, abonnement ou contrat existant),
 *   marquées `showcaseGrandfathered` par les migrations du socle.
 * L'absence d'abonnement n'accorde jamais ce droit : un client conclu depuis S1 sans offre « avec
 * vitrine » (ex. contrat Ocall School Free) ne publie pas.
 * L'édition d'un brouillon reste toujours possible : seule la publication est contrôlée.
 */
export async function assertShowcaseAllowed(
  db: Db,
  organizationId: string,
  productCodes: readonly string[],
  /**
   * Droit historique des organisations antérieures au socle S1 (Park, School). Un produit lancé après
   * (Ocall Facture) le refuse : sa vitrine exige toujours son offre « avec vitrine ».
   */
  options: { honorGrandfathered?: boolean } = {},
): Promise<void> {
  const [org, sub] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { showcaseGrandfathered: true },
    }),
    db.subscription.findFirst({
      where: { organizationId, product: { code: { in: [...productCodes] } } },
      select: { plan: { select: { includesShowcase: true } } },
    }),
  ]);
  if (
    canPublishShowcase({
      planIncludesShowcase: sub?.plan.includesShowcase ?? false,
      grandfathered: (options.honorGrandfathered ?? true) && org.showcaseGrandfathered,
    })
  ) {
    return;
  }
  throw new ForbiddenException({
    code: 'SHOWCASE_OPTION_REQUIRED',
    message:
      'La publication d’un site vitrine nécessite l’offre « avec vitrine ». Votre brouillon est conservé ; ' +
      'demandez le changement d’offre depuis le portail Ocall Suite.',
  });
}
