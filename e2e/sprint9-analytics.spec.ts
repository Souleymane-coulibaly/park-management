import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 9 — analyses dans le navigateur : une vente encaissée apparaît dans la vue globale, la
 * page restaurant (produit, heure) et l'export CSV ; une vente impayée n'entre pas dans le CA.
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const NETWORK_WAIT = { timeout: 30_000 };

test.describe('Sprint 9 — analyses', () => {
  test.setTimeout(240_000);

  test('vente encaissée → vue globale, restaurant, export CSV', async ({ page }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Maquis Analyses',
      email: uniqueEmail('bi'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const category = await apiPost(page, '/catalog/categories', { name: 'Plats' });
    const product = await apiPost(page, '/catalog/products', {
      name: 'Poulet braisé',
      categoryId: category.id,
      variants: [
        { name: 'Standard', prices: [{ establishmentId: establishment.id, price: 4000 }] },
      ],
    });
    const variantId = product.variants[0].id;
    await apiPost(page, '/cash-sessions', { establishmentId: establishment.id, openingFloat: 0 });
    const paid = await apiPost(page, '/sales', {
      establishmentId: establishment.id,
      lines: [{ variantId, quantity: 2 }],
    });
    await apiPost(page, `/sales/${paid.id}/payments`, { method: 'CASH', amountTendered: 8000 });
    // Commande impayée : comptée comme commande, jamais dans le CA.
    await apiPost(page, '/sales', {
      establishmentId: establishment.id,
      lines: [{ variantId, quantity: 1 }],
    });

    await page.goto('/app');
    await page.getByRole('link', { name: 'Analyses' }).first().click();
    await expect(page.getByRole('heading', { name: 'Statistiques et rentabilité' })).toBeVisible();
    await page.getByLabel('Période').selectOption('today');
    await expect(page.getByTestId('kpi-revenue')).toHaveText('8 000 FCFA', NETWORK_WAIT);

    await page.getByRole('link', { name: 'Restaurant', exact: true }).click();
    await expect(page.getByTestId('kpi-restaurant-revenue')).toHaveText('8 000 FCFA', NETWORK_WAIT);
    await expect(page.getByTestId('product-row').first()).toContainText('Poulet braisé');
    await expect(page.getByTestId('hourly-quantity').first()).toHaveText('2', NETWORK_WAIT);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Exporter (CSV)' }).first().click(),
    ]);
    const stream = await download.createReadStream();
    let csv = '';
    for await (const chunk of stream) csv += chunk.toString('utf8');
    expect(download.suggestedFilename()).toMatch(
      /^ocall-restaurant-products-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv).toContain('Poulet braisé;Plats;2;8000');
    expect(csv).toContain('Devise;FCFA (XOF), montants TTC');
  });
});
