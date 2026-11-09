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
    await expect(page.getByText('Disponible', { exact: true }).first()).toBeVisible();

    // Statuts de l'accueil : School en préproduction, Facture et Stock bientôt disponibles.
    await page.goto('/');
    const card = (name: string) => page.locator('#logiciels article').filter({ hasText: name });
    await expect(card('Ocall School')).toContainText('En préproduction');
    await expect(card('Ocall Facture')).toContainText('Bientôt disponible');
    await expect(card('Ocall Stock')).toContainText('Bientôt disponible');

    // Connexion : titre Ocall Suite, plus « Connexion · Ocall Park ».
    await page.goto('/connexion');
    await expect(page).toHaveTitle('Connexion · Ocall Suite');

    // Statut d'Ocall School harmonisé avec l'accueil : « En préproduction », jamais « Bientôt disponible ».
    await page.goto('/solutions/ocall-school');
    await expect(page.getByText('En préproduction').first()).toBeVisible();
    await expect(page.getByRole('main').getByText('Bientôt disponible')).toHaveCount(0);
    // Aucun tarif scolaire publié (le pied de page commun mentionne la devise).
    await expect(page.getByRole('main').getByText(/FCFA/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Être informé du lancement' })).toBeVisible();
  });

  test('tarifs Ocall Suite exacts (grille S1)', async ({ page }) => {
    await page.goto('/tarifs');
    const body = page.locator('main');
    await expect(body).toContainText('50 000');
    await expect(body).toContainText('65 000');
    await expect(body).toContainText('200 000');
    await expect(body).toContainText('Essai gratuit de 14 jours');
    // Anciens tarifs par métier : plus proposés aux nouveaux clients.
    await expect(body).not.toContainText('350 000');
    await expect(body).not.toContainText('250 000');
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
