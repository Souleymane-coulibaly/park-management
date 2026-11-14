import { type Page, expect, test } from '@playwright/test';
import { TINY_PNG } from './facture-support';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S8, parcours navigateur (fournisseur IA simulé) : IA activée par l'administrateur,
 * suggestion de réapprovisionnement puis brouillon de commande, prévision des ruptures, illustration
 * générée (mention IA, hors vitrine), fiche préremplie depuis une photo ; page IA lisible sur téléphone.
 * Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock : assistant IA, illustration et photo', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s8');
  await signupOrganization(page, { metier: 'Parc', orgName: 'IA Stock', email });
  await startStockTrial(email);

  const site = await post<{ id: string; locations: { id: string }[] }>(page, '/ocall-stock/sites', {
    code: 'MAG1',
    name: 'Magasin Bamako',
    kind: 'STORE',
  });
  await post(page, '/ocall-stock/suppliers', { name: 'Grossiste Sahel', leadTimeDays: 7 });
  const paint = await post<{ id: string; variants: { id: string }[] }>(
    page,
    '/ocall-stock/products',
    { name: 'Peinture blanche 5 L', salePrice: 11_800, purchasePrice: 5000, unit: 'pot' },
  );
  const bare = await post<{ id: string }>(page, '/ocall-stock/products', {
    name: 'Vernis incolore',
    salePrice: 4000,
  });
  for (const [kind, quantity] of [
    ['IN', 30],
    ['OUT', 27],
  ] as const) {
    await post(page, '/ocall-stock/movements', {
      kind,
      variantId: paint.variants[0]!.id,
      locationId: site.locations[0]!.id,
      quantity,
      idempotencyKey: `e2e${kind}${Date.now()}`,
      ...(kind === 'OUT' ? { reason: 'Ventes' } : {}),
    });
  }

  // Activation par l'administrateur.
  await page.goto('/stock/ia');
  const settings = page.getByTestId('stock-ai-settings');
  await settings.getByLabel('Activer l’IA pour mon entreprise').check();
  await settings.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(settings.getByText('Réglages IA enregistrés.')).toBeVisible();

  // Réapprovisionnement : suggestion puis brouillon de commande (jamais passée automatiquement).
  const form = page.getByTestId('stock-ai-restock-form');
  await form.getByLabel('Site à réapprovisionner').selectOption({ label: 'MAG1 · Magasin Bamako' });
  await form.getByLabel('Fournisseur').selectOption({ label: 'Grossiste Sahel' });
  await form.getByRole('button', { name: 'Proposer une commande' }).click();
  const result = page.getByTestId('stock-ai-restock-result');
  await expect(result).toContainText('Peinture blanche 5 L');
  // 27 sorties / 90 j × 21 j = 6,3 − 3 disponibles = 3,3 → 4 pots.
  await expect(result.getByLabel('Quantité : Peinture blanche 5 L')).toHaveValue('4');

  // Téléphone : la carte de suggestion reste dans l'écran (le tableau défile à l'intérieur).
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await result.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByTestId('stock-ai-restock-order').click();
  await page.getByRole('link', { name: 'Ouvrir le brouillon' }).click();
  await expect(page).toHaveURL(/\/stock\/achats\//);
  await expect(page.getByText(/Brouillon/).first()).toBeVisible();

  // Ruptures.
  await page.goto('/stock/ia');
  await page.getByTestId('stock-ai-stockouts-run').click();
  await expect(page.getByTestId('stock-ai-stockouts')).toContainText('Peinture blanche 5 L');

  // Illustration générée pour un article sans photo : mention IA, hors vitrine par défaut.
  await page.goto(`/stock/articles/${bare.id}`);
  await page.getByTestId('stock-ai-illustrate').click();
  const draft = page.getByTestId('stock-ai-illustration');
  await expect(draft).toContainText('Illustration générée par IA');
  await draft.getByRole('button', { name: 'Ajouter à l’article' }).click();
  await expect(page.getByTestId('stock-ai-illustration-label')).toHaveText(
    'Illustration générée par IA · hors vitrine',
  );

  // Fiche préremplie depuis une photo d'emballage.
  await page.goto('/stock/articles?nouveau=1');
  const photo = TINY_PNG;
  await page
    .getByTestId('stock-ai-photo')
    .locator('input[type="file"]')
    .setInputFiles({ name: 'emballage.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByTestId('stock-ai-photo')).toContainText('vérifiez avant d’enregistrer');
  await expect(page.getByTestId('stock-ai-photo')).toContainText('4006381333931');
  await expect(
    page.getByTestId('stock-product-form').getByLabel('Désignation', { exact: false }),
  ).toHaveValue('Peinture glycéro brillante 1 L');
});
