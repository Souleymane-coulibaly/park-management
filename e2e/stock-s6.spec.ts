import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S6, parcours navigateur : tableau de bord (CA, marges avec leur méthode, meilleures
 * ventes), compteur d'alertes dans le menu et page des alertes, recherche globale avec autocomplétion
 * depuis n'importe quelle page, filtre par type et disponible par site ; tableau de bord sur téléphone.
 * Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock : tableau de bord, alertes et recherche globale', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s6');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Rapports Stock', email });
  await startStockTrial(email);

  const paint = await post<{ id: string; variants: { id: string }[] }>(
    page,
    '/ocall-stock/products',
    {
      name: 'Peinture blanche 5 L',
      salePrice: 11_800,
      vatRate: 18,
      purchasePrice: 6000,
      minStock: 5,
    },
  );
  const site = await post<{ locations: { id: string }[] }>(page, '/ocall-stock/sites', {
    code: 'MAG1',
    name: 'Magasin Bamako',
    kind: 'STORE',
  });
  await post(page, '/ocall-stock/movements', {
    kind: 'IN',
    variantId: paint.variants[0]!.id,
    locationId: site.locations[0]!.id,
    quantity: 4,
    idempotencyKey: `e2e${Date.now()}`,
  });
  const register = await post<{ id: string }>(page, '/ocall-stock/registers', {
    code: 'CAISSE1',
    name: 'Caisse 1',
    locationId: site.locations[0]!.id,
  });
  await post(page, `/ocall-stock/registers/${register.id}/sessions`, { openingFloat: 0 });
  await post(page, '/ocall-stock/sales', {
    idempotencyKey: `e2esale${Date.now()}`,
    registerId: register.id,
    lines: [{ variantId: paint.variants[0]!.id, quantity: 2 }],
    payments: [{ method: 'CASH', amount: 23_600 }],
  });

  // Tableau de bord : CA, marge avec sa méthode, meilleures ventes.
  await page.goto('/stock');
  const dashboard = page.getByTestId('stock-dashboard');
  await expect(dashboard).toContainText('Chiffre d’affaires net');
  await expect(dashboard).toContainText('23 600 FCFA');
  const margins = page.getByTestId('stock-dashboard-margins');
  await expect(margins).toContainText('Marge estimée');
  await expect(margins).toContainText('8 000 FCFA (40 %)');
  await expect(margins).toContainText('Bénéfice net');
  await expect(margins).toContainText('Non calculé');
  await expect(page.getByTestId('stock-dashboard-top')).toContainText('Peinture blanche 5 L');

  // Menu : 1 alerte (2 pots restants, seuil 5) ; page des alertes.
  const alertsLink = page.getByRole('link', { name: /Alertes/ }).first();
  await expect(alertsLink).toContainText('1');
  await alertsLink.click();
  await expect(page.getByTestId('stock-alerts-low')).toContainText('Peinture blanche 5 L');

  // Recherche globale avec autocomplétion, depuis la page des alertes.
  const box = page.getByTestId('stock-search-box');
  await box.getByRole('combobox').fill('VTE-1');
  await box.getByRole('option', { name: /VTE-000001/ }).click();
  await expect(page).toHaveURL(/\/stock\/ventes\//);

  // Page de recherche : filtre par type, disponible par site.
  await page.goto('/stock/recherche?q=peintre');
  await page.getByRole('button', { name: 'Articles', exact: true }).click();
  const products = page.getByTestId('stock-search-products');
  await expect(products).toContainText('Peinture blanche 5 L');
  await expect(products).toContainText('MAG1 : 2 disponible(s)');

  // Téléphone : chaque carte du tableau de bord reste dans l'écran.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stock');
  await expect(page.getByTestId('stock-dashboard')).toBeVisible();
  for (const id of ['stock-dashboard', 'stock-dashboard-margins', 'stock-dashboard-top']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(b!.x, id).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width, id).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
