import type { Prisma, PrismaClient } from '@ocall/database';
import {
  type Activity,
  type ProductAccess,
  bestAccess,
  subscriptionAccess,
  subscriptionActivities,
} from '@ocall/shared';
import { parkSubscriptionWhere } from './park-subscription';

type Db = PrismaClient | Prisma.TransactionClient;

/** Abonnement de la famille Park avec son droit et les activités qu'il couvre (sprint 7). */
export interface ParkFamilySubscription {
  id: string;
  productId: string;
  productCode: string;
  /** Contrat combiné actif : droits sur parc ET restaurant, comme avant la séparation. */
  combined: boolean;
  activities: Activity[];
  access: ProductAccess;
}

/**
 * Abonnements de la famille Ocall Park d'une organisation (Parc, Restaurant, contrat combiné), dans un
 * ordre déterministe, avec leur droit d'accès (socle S1, décision D3) :
 * - essai en cours, abonnement actif ou en renouvellement : accès complet ;
 * - essai échu, abonnement expiré, suspendu ou résilié : lecture seule (données conservées) ;
 * - abonnement « non activé » antérieur au socle S1 : accès complet conservé (pas de rétroactivité).
 */
export async function loadParkFamilySubscriptions(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<ParkFamilySubscription[]> {
  const subs = await db.subscription.findMany({
    where: parkSubscriptionWhere(organizationId),
    select: {
      id: true,
      status: true,
      expiresAt: true,
      productId: true,
      product: { select: { code: true } },
      parkCombined: { select: { status: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const trials = subs.some((s) => s.status === 'TRIALING')
    ? await db.productTrial.findMany({
        where: { organizationId, productId: { in: subs.map((s) => s.productId) } },
        select: { productId: true, endsAt: true },
      })
    : [];
  return subs.map((s) => {
    const combined = s.parkCombined?.status === 'ACTIVE';
    return {
      id: s.id,
      productId: s.productId,
      productCode: s.product.code,
      combined,
      activities: subscriptionActivities(s.product.code, combined),
      access: subscriptionAccess(
        {
          status: s.status,
          expiresAt: s.expiresAt,
          trialEndsAt:
            s.status === 'TRIALING'
              ? (trials.find((t) => t.productId === s.productId)?.endsAt ?? null)
              : null,
        },
        now,
      ),
    };
  });
}

/**
 * Droit d'une organisation sur UNE activité (sprint 7) : meilleur droit parmi les abonnements qui la
 * couvrent (Ocall Parc pour le parc, Ocall Restaurant pour le restaurant, contrat combiné pour les deux).
 * Aucun abonnement qui la couvre : lecture seule, jamais d'accès complet par défaut.
 */
export async function loadActivityAccess(
  db: Db,
  organizationId: string,
  activity: Activity,
  now: Date = new Date(),
): Promise<ProductAccess> {
  const covering = (await loadParkFamilySubscriptions(db, organizationId, now)).filter((s) =>
    s.activities.includes(activity),
  );
  return covering.length ? bestAccess(covering.map((s) => s.access)) : 'read_only';
}

/**
 * Droit d'une organisation sur l'application Ocall Park au sens large (parc ou restaurant) : meilleur
 * droit de ses abonnements de la famille. Organisation sans abonnement : lecture seule.
 */
export async function loadParkAccess(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<ProductAccess> {
  const subs = await loadParkFamilySubscriptions(db, organizationId, now);
  return subs.length ? bestAccess(subs.map((s) => s.access)) : 'read_only';
}
