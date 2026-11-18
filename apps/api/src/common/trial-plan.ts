import type { Prisma } from '@ocall/database';

const TRIAL_ORDER = [
  { includesShowcase: 'asc' },
  { monthlyPrice: 'asc' },
] satisfies Prisma.SubscriptionPlanOrderByWithRelationInput[];

/**
 * Offre attribuée à un nouvel essai (inscription, essai demandé depuis le portail ou lancé par Ocall).
 *
 * - Une offre forfaitaire est active : la moins chère, sans vitrine d'abord, comme avant l'étape 6.
 *   Aucun client n'est jamais basculé automatiquement vers le par site.
 * - Ocall a retiré tous les forfaits du catalogue (lancement de la grille par site) : l'offre par site
 *   active, sans vitrine d'abord.
 *
 * Les abonnements existants gardent leur offre, même retirée du catalogue.
 */
export async function findTrialPlan<S extends Prisma.SubscriptionPlanSelect>(
  db: Pick<Prisma.TransactionClient, 'subscriptionPlan'>,
  product: Prisma.SubscriptionPlanWhereInput,
  select: S,
): Promise<Prisma.SubscriptionPlanGetPayload<{ select: S }> | null> {
  const flat = await db.subscriptionPlan.findFirst({
    where: { ...product, isActive: true, pricingMode: 'FLAT' },
    orderBy: TRIAL_ORDER,
    select,
  });
  if (flat) return flat as Prisma.SubscriptionPlanGetPayload<{ select: S }>;
  return (await db.subscriptionPlan.findFirst({
    where: { ...product, isActive: true, pricingMode: 'PER_SITE' },
    orderBy: TRIAL_ORDER,
    select,
  })) as Prisma.SubscriptionPlanGetPayload<{ select: S }> | null;
}
