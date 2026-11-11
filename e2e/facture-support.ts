import { E2E_SUFFIX } from './support';
import { withTestDb } from './suite-support';

/**
 * Essai Ocall Facture ouvert directement en base de test pour l'organisation du compte `email` (le
 * produit reste « à venir » au catalogue) : offre inactive dédiée, essai de 14 jours. `showcase` : l'offre
 * réelle « Ocall Facture — Avec vitrine » (migration F5), qui autorise la publication du site vitrine.
 */
export async function startFactureTrial(
  email: string,
  options: { showcase?: boolean } = {},
): Promise<void> {
  await withTestDb(async (db) => {
    const org = await db.organization.findFirstOrThrow({
      where: { memberships: { some: { user: { email } } } },
      select: { id: true },
    });
    const product = await db.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_FACTURE' } });
    const plan = options.showcase
      ? await db.subscriptionPlan.findUniqueOrThrow({
          where: {
            productId_name: { productId: product.id, name: 'Ocall Facture — Avec vitrine' },
          },
        })
      : await db.subscriptionPlan.create({
          data: {
            productId: product.id,
            name: `Facture E2E ${E2E_SUFFIX} ${Date.now()}`,
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

/** PNG 1 × 1 valide (logos de test). */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
