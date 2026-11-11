import type { Prisma, PrismaClient } from '@ocall/database';
import { type ProductAccess, subscriptionAccess } from '@ocall/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Droit d'accès d'une organisation à une application vendue par abonnement et essai (socle S1), hors
 * Ocall Park (qui garde ses règles d'antériorité, voir `park-access.ts`) et hors Ocall School (contrats) :
 * - essai en cours, abonnement actif ou en renouvellement : accès complet ;
 * - essai échu, abonnement expiré, suspendu ou résilié : lecture seule, données conservées ;
 * - aucun abonnement, ou abonnement jamais activé (ni essai ni paiement) : aucun accès.
 * Recalculé à chaque requête, sans tâche planifiée.
 */
export async function loadAppAccess(
  db: Db,
  organizationId: string,
  productCode: string,
  now: Date = new Date(),
): Promise<ProductAccess> {
  const sub = await db.subscription.findFirst({
    where: { organizationId, product: { code: productCode } },
    select: { status: true, expiresAt: true, productId: true },
  });
  if (!sub || sub.status === 'NOT_ACTIVATED') return 'none';
  const trial =
    sub.status === 'TRIALING'
      ? await db.productTrial.findUnique({
          where: { organizationId_productId: { organizationId, productId: sub.productId } },
          select: { endsAt: true },
        })
      : null;
  return subscriptionAccess(
    { status: sub.status, expiresAt: sub.expiresAt, trialEndsAt: trial?.endsAt ?? null },
    now,
  );
}
