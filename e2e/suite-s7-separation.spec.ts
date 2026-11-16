import { type Page, expect, test } from '@playwright/test';
import { superAdminPage, withTestDb } from './suite-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite sprint 7 — séparation Ocall Parc / Ocall Restaurant, parcours navigateur : contrat combiné
 * (Restaurant « inclus »), ouverture d'Ocall Restaurant par Ocall, inscription « Parc + Restaurant » en deux
 * applications (une session), lecture seule d'une seule activité, bascule explicite d'un contrat combiné
 * depuis le Super Admin, portail sur téléphone. Données fictives, base de test locale jetable ; le
 * catalogue est remis dans son état initial à la fin.
 */

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

async function setRestaurantOpen(open: boolean) {
  await withTestDb(async (db) => {
    const product = await db.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_RESTAURANT' } });
    await db.subscriptionPlan.updateMany({
      where: { productId: product.id, pricingMode: 'FLAT', name: { endsWith: '— Sans vitrine' } },
      data: { isActive: open },
    });
    await db.saasProduct.update({ where: { id: product.id }, data: { listed: open } });
  });
}

test('Ocall Suite : séparation commerciale Ocall Parc / Ocall Restaurant', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  // Contrat combiné : inscription « Parc + Restaurant » avant l'ouverture d'Ocall Restaurant.
  const combinedEmail = uniqueEmail('suite-s7-combine');
  await signupOrganization(page, {
    metier: 'Parc + Restaurant',
    orgName: 'Groupe Niger',
    email: combinedEmail,
  });

  await setRestaurantOpen(true);
  try {
    // Le contrat combiné présente Ocall Restaurant comme inclus.
    await page.goto('/suite');
    const included = page.getByTestId('suite-app-OCALL_RESTAURANT');
    await expect(included.getByTestId('suite-app-included')).toBeVisible();

    // Nouveau client « Parc + Restaurant » : deux applications, une session.
    const context = await browser.newContext();
    const fresh = await context.newPage();
    const freshEmail = uniqueEmail('suite-s7-deux');
    await signupOrganization(fresh, {
      metier: 'Parc + Restaurant',
      orgName: 'Groupe Bani',
      email: freshEmail,
    });
    await fresh.goto('/suite');
    await expect(fresh.getByTestId('suite-app-OCALL_PARK')).toBeVisible();
    const resto = fresh.getByTestId('suite-app-OCALL_RESTAURANT');
    await expect(resto).toBeVisible();
    await expect(resto.getByTestId('suite-app-included')).toHaveCount(0);
    await expect(resto).toContainText(/jours d’essai restants/);
    // Restaurant échu : seule l'activité restaurant passe en consultation, l'espace reste unifié.
    await withTestDb(async (db) => {
      const user = await db.user.findUniqueOrThrow({
        where: { email: freshEmail },
        select: { memberships: { select: { organizationId: true } } },
      });
      const product = await db.saasProduct.findUniqueOrThrow({
        where: { code: 'OCALL_RESTAURANT' },
      });
      await db.productTrial.update({
        where: {
          organizationId_productId: {
            organizationId: user.memberships[0]!.organizationId,
            productId: product.id,
          },
        },
        data: { endsAt: new Date(Date.now() - 86_400_000) },
      });
    });
    await fresh.goto('/app');
    await expect(fresh.getByTestId('activity-read-only')).toContainText('Ocall Restaurant');
    await expect(fresh.getByTestId('activity-read-only')).not.toContainText('Ocall Parc');
    // Portail sur téléphone : lisible, sans débordement.
    await fresh.setViewportSize({ width: 390, height: 844 });
    await fresh.goto('/suite');
    await expect(fresh.getByTestId('suite-app-OCALL_RESTAURANT')).toBeVisible();
    await noOverflow(fresh);
    await context.close();

    // Bascule explicite du contrat combiné par Ocall : total conservé, répartition pré-remplie.
    const admin = await superAdminPage(browser, 's7owner', 'PLATFORM_OWNER');
    await admin.goto('/admin/abonnements');
    const row = admin
      .getByTestId('park-restaurant-split')
      .locator('tr')
      .filter({ hasText: 'Groupe Niger' });
    const form = row.getByTestId('park-restaurant-switch');
    await expect(form.getByLabel('Ocall Parc / mois')).toHaveValue('25000');
    await expect(form.getByLabel('Ocall Restaurant / mois')).toHaveValue('25000');
    await form.getByLabel('Motif (accord du client)').fill('Accord du client (essai E2E)');
    await form.getByRole('button', { name: 'Basculer' }).click();
    await expect(row).toHaveCount(0);

    // Le client voit désormais Ocall Restaurant comme application à part entière.
    await page.goto('/suite');
    const separated = page.getByTestId('suite-app-OCALL_RESTAURANT');
    await expect(separated).toBeVisible();
    await expect(separated.getByTestId('suite-app-included')).toHaveCount(0);
  } finally {
    await setRestaurantOpen(false);
  }
});
