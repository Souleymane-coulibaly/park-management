import type { Prisma, PrismaClient } from '@ocall/database';
import { type ProductAccess, subscriptionAccess } from '@ocall/shared';
import { parkSubscriptionWhere } from './park-subscription';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Droit d'accès d'une organisation à l'application Ocall Park (socle S1, décision D3), à partir de
 * son abonnement de la famille Park et de son essai :
 * - essai en cours, abonnement actif ou en renouvellement : accès complet ;
 * - essai échu, abonnement expiré, suspendu ou résilié : lecture seule (données conservées) ;
 * - abonnement « non activé » antérieur au socle S1 : accès complet conservé (pas de rétroactivité).
 *
 * Organisation Park sans aucun abonnement (impossible par le provisionnement : chaque organisation
 * Park reçoit son abonnement à la création) : lecture seule, jamais d'accès complet par défaut.
 */
export async function loadParkAccess(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<ProductAccess> {
  const sub = await db.subscription.findFirst({
    where: parkSubscriptionWhere(organizationId),
    select: { status: true, expiresAt: true, productId: true },
  });
  if (!sub) return 'read_only';
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
