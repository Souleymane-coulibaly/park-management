import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 10 — site vitrine dans le navigateur : création, menu choisi, publication, page publique
 * (mobile, SEO, données structurées, aucune action d'achat), dépublication. Aucune vérification
 * DNS/HTTPS réelle ici (voir docs/SITES-VITRINES.md).
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const NETWORK_WAIT = { timeout: 30_000 };

test.describe('Sprint 10 — site vitrine', () => {
  test.setTimeout(240_000);

  test('créer, choisir le menu, publier, consulter sur mobile, dépublier', async ({
    page,
    browser,
  }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Maquis Vitrine',
      email: uniqueEmail('site'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const category = await apiPost(page, '/catalog/categories', { name: 'Grillades' });
    for (const [name, price] of [
      ['Poulet braisé', 4000],
      ['Repas du personnel', 500],
    ] as const) {
      await apiPost(page, '/catalog/products', {
        name,
        categoryId: category.id,
        variants: [{ name: 'Standard', prices: [{ establishmentId: establishment.id, price }] }],
      });
    }

    await page.goto('/app');
    await page.getByRole('link', { name: 'Site web' }).first().click();
    const slug = `maquis-vitrine-${Date.now().toString(36)}`;
    await page.getByLabel('Adresse publique').fill(slug);
    await page.getByRole('button', { name: 'Créer le site' }).click();
    await expect(page.getByText('Brouillon (jamais publié)')).toBeVisible(NETWORK_WAIT);

    await page.getByLabel('Accroche').fill('Grillades au feu de bois à Bamako');
    await page.getByRole('button', { name: 'Menu et tarifs' }).click();
    await page
      .getByTestId('site-menu-option')
      .filter({ hasText: 'Poulet braisé' })
      .getByRole('checkbox')
      .check();
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await expect(page.getByText('Brouillon enregistré (non public).')).toBeVisible(NETWORK_WAIT);

    // Brouillon : la page publique n'existe pas encore.
    expect((await page.request.get(`/e/${slug}`)).status()).toBe(404);

    await page.getByRole('button', { name: 'Publier' }).click();
    await expect(page.getByText('Site publié.')).toBeVisible(NETWORK_WAIT);

    // Page publique, sur un écran de téléphone, sans session.
    const visitor = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobile = await visitor.newPage();
    const res = await mobile.goto(`/e/${slug}`);
    expect(res?.status()).toBe(200);
    await expect(mobile.getByRole('heading', { level: 1 })).toContainText('Maquis Vitrine');
    await expect(mobile.getByText('Poulet braisé')).toBeVisible();
    await expect(mobile.getByText('Repas du personnel')).toHaveCount(0);
    await expect(mobile.getByText(/Commandes sur place uniquement/)).toBeVisible();
    await expect(
      mobile.getByRole('button', { name: /acheter|payer|réserver|commander/i }),
    ).toHaveCount(0);
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(mobile.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'Grillades au feu de bois à Bamako',
    );
    await expect(mobile.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      /Maquis Vitrine/,
    );
    const jsonLd = JSON.parse(
      (await mobile.locator('script[type="application/ld+json"]').textContent()) ?? '{}',
    );
    expect(jsonLd['@type']).toBe('Restaurant');
    const robots = await mobile.request.get('/robots.txt');
    expect(await robots.text()).toContain('Disallow: /app');
    await visitor.close();

    await page.getByRole('button', { name: 'Dépublier' }).click();
    await expect(page.getByText(/Site dépublié/)).toBeVisible(NETWORK_WAIT);
    expect((await page.request.get(`/e/${slug}`)).status()).toBe(404);
  });
});
