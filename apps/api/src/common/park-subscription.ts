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
