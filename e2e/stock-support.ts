import { E2E_SUFFIX } from './support';
import { withTestDb } from './suite-support';

/**
 * Essai Ocall Stock ouvert directement en base de test pour l'organisation du compte `email` (le produit
 * reste « à venir » au catalogue) : offre inactive dédiée, essai de 14 jours.
 */
export async function startStockTrial(
  email: string,
  options: { showcase?: boolean } = {},
): Promise<void> {
  await withTestDb(async (db) => {
    const org = await db.organization.findFirstOrThrow({
      where: { memberships: { some: { user: { email } } } },
      select: { id: true },
    });
    const product = await db.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_STOCK' } });
    // `showcase` : l'offre réelle « Ocall Stock — Avec vitrine » (migration S1), qui autorise la
    // publication du site vitrine (S7).
    const plan = options.showcase
      ? await db.subscriptionPlan.findUniqueOrThrow({
          where: {
            productId_name: { productId: product.id, name: 'Ocall Stock — Avec vitrine' },
          },
        })
      : await db.subscriptionPlan.create({
          data: {
            productId: product.id,
            name: `Stock E2E ${E2E_SUFFIX} ${Date.now()}`,
            monthlyPrice: 50_000,
            setupFee: 200_000,
            isActive: false,
          },
        });
    await db.productTrial.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * 86_400_000),
        startedByOcall: true,
      },
    });
    await db.subscription.create({
      data: { organizationId: org.id, productId: product.id, planId: plan.id, status: 'TRIALING' },
    });
  });
}
