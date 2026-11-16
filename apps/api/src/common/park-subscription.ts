import type { Prisma } from '@ocall/database';
import { PARK_APP_PRODUCT_CODES } from '@ocall/shared';

/**
 * Abonnement de l'application Ocall Park d'une organisation (Sprint 11A). Une organisation peut
 * souscrire plusieurs produits Ocall Suite, mais au plus un produit de la famille Ocall Park
 * (Parc, Restaurant, Parc + Restaurant) : celui qui correspond à son métier.
 */
export const parkSubscriptionWhere = (organizationId: string): Prisma.SubscriptionWhereInput => ({
  organizationId,
  product: { code: { in: [...PARK_APP_PRODUCT_CODES] } },
});

/** Sélection imbriquée (organisation → abonnement Ocall Park) : `subscriptions[0]` ou rien. */
export const PARK_SUBSCRIPTION_STATUS = {
  where: { product: { code: { in: [...PARK_APP_PRODUCT_CODES] } } },
  select: { status: true },
  take: 1,
} satisfies Prisma.Organization$subscriptionsArgs;

/**
 * Sprint 7 : abonnement présenté sous « Ocall Park » (application Parc) — Ocall Parc séparé, ou contrat
 * combiné actif (historique, ou souscrit avant l'ouverture d'Ocall Restaurant ; il couvre aussi le
 * restaurant).
 */
export const parkTileSubscriptionWhere = (
  organizationId: string,
): Prisma.SubscriptionWhereInput => ({
  organizationId,
  OR: [{ product: { code: 'OCALL_PARK' } }, { parkCombined: { is: { status: 'ACTIVE' } } }],
});

/** Sprint 7 : abonnement Ocall Restaurant séparé (hors contrat combiné). */
export const restaurantSubscriptionWhere = (
  organizationId: string,
): Prisma.SubscriptionWhereInput => ({
  organizationId,
  product: { code: 'OCALL_RESTAURANT' },
  NOT: { parkCombined: { is: { status: 'ACTIVE' } } },
});

/** Abonnement présenté pour une application du portail (Park, Restaurant, ou produit exact). */
export const portalSubscriptionWhere = (
  organizationId: string,
  productCode: string,
): Prisma.SubscriptionWhereInput =>
  productCode === 'OCALL_PARK'
    ? parkTileSubscriptionWhere(organizationId)
    : productCode === 'OCALL_RESTAURANT'
      ? restaurantSubscriptionWhere(organizationId)
      : { organizationId, product: { code: productCode } };

/**
 * Sprint 7 : Ocall Restaurant est ouvert à la souscription quand Ocall le présente au catalogue (action
 * explicite du Super Admin, jamais automatique). Avant : l'inscription garde le contrat Ocall Park
 * combiné (parc et restaurant), comme aujourd'hui.
 */
export async function isRestaurantOpen(
  db: Pick<Prisma.TransactionClient, 'saasProduct'>,
): Promise<boolean> {
  const product = await db.saasProduct.findUnique({
    where: { code: 'OCALL_RESTAURANT' },
    select: { listed: true, status: true },
  });
  return product?.listed === true && product.status === 'ACTIVE';
}

/**
 * Avant l'ouverture d'Ocall Restaurant, un nouvel abonnement Ocall Park reste un contrat combiné (parc et
 * restaurant) : inscription de la ligne, sans modifier l'abonnement. Après : rien (Ocall Parc seul).
 */
export async function keepCombinedBeforeOpening(
  tx: Prisma.TransactionClient,
  subscription: { id: string; organizationId: string; productCode: string },
): Promise<void> {
  if (subscription.productCode !== 'OCALL_PARK' || (await isRestaurantOpen(tx))) return;
  await tx.parkCombinedContract.upsert({
    where: { subscriptionId: subscription.id },
    create: {
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      origin: 'SIGNUP',
    },
    update: {},
  });
}
