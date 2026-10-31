import { expect, test } from '@playwright/test';

/**
 * Sprint 12A — site public Ocall Suite dans le navigateur : navigation, catalogue, produits
 * « bientôt disponibles », tarifs exacts, demande de démonstration, SEO de base et accessibilité.
 * Les sites vitrines des clients restent couverts par sprint10-sites.spec.ts.
 */
test.describe('Sprint 12A — site Ocall Suite', () => {
  test('accueil → solutions → produit disponible → produit à venir', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ocall Suite/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      'content',
      'Ocall Suite',
    );
    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Nos solutions' })
      .click();
    await expect(page).toHaveURL(/\/solutions$/);
    await page
      .getByRole('link', { name: /Découvrir la solution/ })
      .first()
      .click();
    await expect(page.getByText('Disponible', { exact: true })).toBeVisible();

    await page.goto('/solutions/ocall-school');
    await expect(page.getByText('Bientôt disponible').first()).toBeVisible();
    await expect(page.getByText(/FCFA/)).toHaveCount(0); // aucun tarif scolaire publié
    await expect(page.getByRole('link', { name: 'Être informé du lancement' })).toBeVisible();
  });

  test('tarifs Ocall Park exacts', async ({ page }) => {
    await page.goto('/tarifs');
    const body = page.locator('main');
    await expect(body).toContainText('250 000');
    await expect(body).toContainText('350 000');
    await expect(body).toContainText('15 000');
    await expect(body).toContainText('25 000');
  });

  test('demande de démonstration envoyée ; pages légales non indexées', async ({ page }) => {
    await page.goto('/demo?produit=ocall-clinic');
    await page.getByLabel('Nom et prénom').fill('Awa Traoré');
    await page.getByLabel('Entreprise').fill(`Clinique e2e ${Date.now()}`);
    await page.getByLabel('Téléphone').fill('+223 70 00 00 00');
    await page.getByLabel('E-mail').fill(`demo-${Date.now()}@test.ocallpark.local`);
    await page.getByLabel('Message').fill('Nous voulons découvrir Ocall Clinic.');
    await page.getByRole('checkbox').check();
    await page.waitForTimeout(3_500); // délai minimal anti-robot
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(page.getByText('Merci, votre demande est envoyée.')).toBeVisible();

    await page.goto('/mentions-legales');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByText('À compléter', { exact: false }).first()).toBeVisible();
  });

  test('anciennes pages redirigées', async ({ page }) => {
    await page.goto('/metiers');
    await expect(page).toHaveURL(/\/solutions$/);
    await page.goto('/fonctionnalites');
    await expect(page).toHaveURL(/\/solutions\/ocall-park$/);
  });
});
