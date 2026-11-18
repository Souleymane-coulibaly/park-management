import { type Page, expect, test } from '@playwright/test';
import { superAdminPage, withTestDb } from './suite-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite étape 6 — facturation par site, parcours navigateur : offres par site dans le Super Admin
 * (prix du site supplémentaire, vitrine, mise en service dégressive), aperçu de la séparation Parc /
 * Restaurant, facture par site avec ses sites photographiés, et page Tarifs publique avec la grille par
 * site (bureau et téléphone). Données fictives, base de test locale jetable ; les offres par site
 * activées pour la page Tarifs sont désactivées à la fin.
 */

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

test('Ocall Suite : facturation par site, du Super Admin à la page Tarifs', async ({
  page,
  browser,
}) => {
  test.setTimeout(480_000);
  const email = uniqueEmail('suite-s6');
  await signupOrganization(page, { metier: 'Parc + Restaurant', orgName: 'Groupe Ségou', email });

  // Un parc et un restaurant en plus du premier établissement ; abonnement Ocall Park passé à l'offre
  // par site (comme après un changement d'offre validé par Ocall). Décompte attendu lu en base.
  const { organizationId, perSitePlanIds, parkSites, restaurantSites, billed } = await withTestDb(
    async (db) => {
      const user = await db.user.findUniqueOrThrow({
        where: { email },
        select: { memberships: { select: { organizationId: true } } },
      });
      const orgId = user.memberships[0]!.organizationId;
      const suffix = Date.now();
      await db.establishment.createMany({
        data: [
          {
            organizationId: orgId,
            name: `Restaurant du fleuve ${suffix}`,
            businessType: 'RESTAURANT',
          },
          { organizationId: orgId, name: `Parc aquatique ${suffix}`, businessType: 'PARK' },
        ],
      });
      const sites = await db.establishment.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { businessType: true },
      });
      const park = sites.filter((e) => ['PARK', 'PARK_RESTAURANT'].includes(e.businessType)).length;
      const resto = sites.filter((e) =>
        ['RESTAURANT', 'PARK_RESTAURANT'].includes(e.businessType),
      ).length;
      const distinct = sites.filter((e) => e.businessType !== 'NONE').length;
      const plans = await db.subscriptionPlan.findMany({
        where: { pricingMode: 'PER_SITE', product: { code: 'OCALL_PARK' } },
        select: { id: true, includesShowcase: true },
      });
      await db.subscription.updateMany({
        where: { organizationId: orgId, product: { code: 'OCALL_PARK' } },
        data: { planId: plans.find((p) => !p.includesShowcase)!.id },
      });
      return {
        organizationId: orgId,
        perSitePlanIds: plans.map((p) => p.id),
        parkSites: park,
        restaurantSites: resto,
        billed: distinct,
      };
    },
  );
  // Un établissement « parc et restaurant » compte pour les deux activités, une seule fois au total.
  expect(billed).toBe(3);

  const admin = await superAdminPage(browser, 's6owner', 'PLATFORM_OWNER');

  // Offres : l'offre par site montre ses prix propres.
  await admin.goto('/admin/abonnements');
  const perSiteEditor = admin
    .locator('div.rounded-xl')
    .filter({ hasText: 'Ocall Park — Par site avec vitrine' })
    .first();
  await expect(perSiteEditor.getByText('Par site activé')).toBeVisible();
  await expect(perSiteEditor.getByLabel('Premier site (FCFA / mois)')).toHaveValue('17500');
  await expect(perSiteEditor.getByLabel('Site supplémentaire (FCFA / mois)')).toHaveValue('7500');
  await expect(perSiteEditor.getByLabel('Supplément vitrine (FCFA / mois)')).toHaveValue('5000');
  await expect(
    perSiteEditor.getByLabel('Mise en service d’une application supplémentaire (FCFA)'),
  ).toHaveValue('112500');

  // Aperçu de séparation : ce contrat couvre parc et restaurant, il est conservé tel quel.
  const split = admin.getByTestId('park-restaurant-split');
  const row = split.locator('tr').filter({ hasText: 'Groupe Ségou' });
  await expect(row).toContainText(`Ocall Parc : ${parkSites} site(s)`);
  await expect(row).toContainText(`Ocall Restaurant : ${restaurantSites} site(s)`);

  // Facture par site : mensualité au décompte (3 sites, l'établissement mixte compté une fois).
  await admin.goto('/admin/factures');
  await admin.getByRole('button', { name: /Émettre une facture/ }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Organisation').selectOption(organizationId);
  const subSelect = dialog.getByLabel('Abonnement');
  await expect(subSelect.locator('option')).not.toHaveCount(1);
  await subSelect.selectOption({ index: 1 });
  await expect(dialog.getByLabel(/pour 3 site\(s\)/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Émettre', exact: true }).click();
  const invoiceRow = admin.getByTestId('invoice-row').filter({ hasText: 'Groupe Ségou' }).first();
  await expect(invoiceRow.getByTestId('invoice-sites')).toContainText('3 site(s) facturé(s)');
  await expect(invoiceRow).toContainText('Sites supplémentaires : 2 × 1 mois');
  await expect(invoiceRow).toContainText('32 500');
  // J2 : identité légale d'Ocall non renseignée → facture provisoire annoncée ; PDF téléchargeable.
  await expect(admin.getByTestId('legal-identity-incomplete')).toBeVisible();
  await expect(invoiceRow).toContainText('Provisoire');
  const [download] = await Promise.all([
    admin.waitForEvent('download'),
    invoiceRow.getByTestId('invoice-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Facture-.+\.pdf$/);

  // Page Tarifs : grille par site dès qu'Ocall active les offres (cache de 5 minutes des prix).
  await withTestDb((db) =>
    db.subscriptionPlan.updateMany({
      where: { id: { in: perSitePlanIds } },
      data: { isActive: true },
    }),
  );
  try {
    await expect(async () => {
      await page.goto('/tarifs');
      await expect(page.getByTestId('tarif-extra-site').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ intervals: [5_000, 15_000, 30_000], timeout: 360_000 });
    const park = page.locator('section').filter({ hasText: 'Ocall Park' }).first();
    await expect(park.getByTestId('tarif-extra-site').first()).toContainText(
      '7 500 FCFA / mois par site supplémentaire',
    );
    await expect(park).toContainText('pour chaque application suivante');
    await expect(park).toContainText('site vitrine + 5 000 FCFA / mois');
    await expect(page.getByTestId('tarifs-example')).toContainText('trois sites chacune');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(park).toBeVisible();
    await noOverflow(page);
  } finally {
    await withTestDb((db) =>
      db.subscriptionPlan.updateMany({
        where: { id: { in: perSitePlanIds } },
        data: { isActive: false },
      }),
    );
  }
});
