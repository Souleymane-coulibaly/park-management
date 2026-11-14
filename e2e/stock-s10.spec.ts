import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S10, parcours navigateur : prix propre à une boutique fixé sur la fiche article, puis
 * retour au prix commun ; vitrine avec deux boutiques présentées : le visiteur choisit sa boutique sur
 * « Nos boutiques », voit son prix dans le catalogue et lui adresse sa demande ; côté magasin, la demande
 * porte la boutique. Lisible sur téléphone. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock : prix par boutique et vitrine multi-boutiques', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s10');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Quincaillerie Sahel', email });
  await startStockTrial(email, { showcase: true });

  const paint = await post<{ id: string; variants: { id: string }[] }>(
    page,
    '/ocall-stock/products',
    { name: 'Peinture blanche 5 L', salePrice: 10_000, vatRate: 18 },
  );
  for (const [code, name, city] of [
    ['BKO', 'Boutique Bamako', 'Bamako'],
    ['SEG', 'Boutique Ségou', 'Ségou'],
  ]) {
    const site = await post<{ locations: { id: string }[] }>(page, '/ocall-stock/sites', {
      code,
      name,
      kind: 'STORE',
      address: `Rue ${code}`,
      city,
    });
    await post(page, '/ocall-stock/movements', {
      kind: 'IN',
      variantId: paint.variants[0]!.id,
      locationId: site.locations[0]!.id,
      quantity: 5,
      idempotencyKey: `e2e${code}${Date.now()}`,
    });
  }

  // Fiche article : prix propre à Ségou, puis retour au prix commun, puis de nouveau un prix propre.
  await page.goto(`/stock/articles/${paint.id}`);
  const prices = page.getByTestId('stock-site-prices');
  const segou = prices.locator('[data-site="SEG"]');
  await expect(segou).toContainText('Prix commun');
  await segou.getByLabel('Prix TTC à Boutique Ségou').fill('9500');
  await segou.getByRole('button', { name: 'Fixer' }).click();
  await expect(segou.getByTestId('stock-site-price-value')).toHaveText(/9\s500/);
  await expect(segou).toContainText('Prix de la boutique');
  await expect(prices.locator('[data-site="BKO"]')).toContainText('Prix commun');
  await segou.getByRole('button', { name: 'Revenir au prix commun' }).click();
  await expect(segou.getByTestId('stock-site-price-value')).toHaveText(/10\s000/);
  await segou.getByLabel('Prix TTC à Boutique Ségou').fill('9500');
  await segou.getByRole('button', { name: 'Fixer' }).click();
  await expect(segou).toContainText('Prix de la boutique');
  await expect(page.getByTestId('stock-history')).toContainText('Prix de vente à Boutique Ségou');

  // Vitrine : deux boutiques présentées, prix affichés, article publié, mise en ligne.
  await page.goto('/stock/vitrine');
  const slug = `multi-${Date.now().toString(36)}`;
  await page.getByLabel('Adresse du site').fill(slug);
  await page.getByRole('button', { name: 'Créer le site' }).click();
  const content = page.getByTestId('stock-showcase-content');
  await content.getByLabel('Titre principal').fill('Quincaillerie du Sahel');
  await content.getByRole('checkbox', { name: /Afficher les prix/ }).check();
  const shops = content.getByTestId('stock-showcase-shops');
  for (const code of ['BKO', 'SEG']) {
    await shops.locator(`[data-site="${code}"]`).getByTestId('stock-showcase-shop-toggle').check();
  }
  await shops.locator('[data-site="SEG"]').getByLabel('Horaires').fill('Lun–Sam 8 h–18 h');
  await content.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(content.getByText('Brouillon enregistré.')).toBeVisible();
  const products = page.getByTestId('stock-showcase-products');
  await products
    .getByRole('checkbox', { name: 'Publier sur la vitrine : Peinture blanche 5 L' })
    .click();
  await expect(products.getByText('Publié')).toHaveCount(1);
  await page.getByTestId('stock-showcase-publish').click();
  await expect(page.getByText('Site en ligne')).toBeVisible();

  // Visiteur : sans boutique, prix commun et invitation à choisir.
  await page.goto(`/m/${slug}/catalogue`);
  await expect(page.getByTestId('stock-site-catalog')).toContainText('10 000 FCFA TTC');
  await page.getByTestId('stock-site-choose-shop').click();
  const list = page.getByTestId('stock-site-shops');
  await expect(list.getByTestId('stock-site-shop')).toHaveCount(2);
  await expect(list).toContainText('Lun–Sam 8 h–18 h');
  if (process.env.E2E_SHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/stock-boutiques.png`, fullPage: true });
  }
  await list
    .getByTestId('stock-site-shop')
    .filter({ hasText: 'Boutique Ségou' })
    .getByTestId('stock-site-shop-choose')
    .click();
  await expect(page.getByTestId('stock-site-shop-name')).toHaveText('Boutique Ségou');
  const catalog = page.getByTestId('stock-site-catalog');
  await expect(catalog).toContainText('9 500 FCFA TTC');

  // La boutique suit le visiteur : fiche article, puis demande adressée à Ségou.
  await catalog.getByRole('link', { name: /Peinture blanche 5 L/ }).click();
  await expect(page.getByTestId('stock-site-product')).toContainText('9 500 FCFA TTC');
  await expect(page.getByTestId('stock-site-shop-name')).toHaveText('Boutique Ségou');
  await page.getByRole('link', { name: 'Voir ma demande et l’envoyer' }).click();
  const form = page.getByTestId('stock-site-request-form');
  await expect(form.getByTestId('stock-site-request-shop')).toContainText('Boutique Ségou');
  await form.getByLabel('Votre nom').fill('Awa Traoré');
  await form.getByLabel('Téléphone').fill('+223 76 00 00 01');
  await form.getByLabel('Message').fill('Avez-vous ce produit en stock ?');
  // Durée minimale de saisie (anti-spam) avant l'envoi.
  await page.waitForTimeout(3_500);
  await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByTestId('stock-site-request-sent')).toBeVisible();

  // Téléphone : la page « Nos boutiques » reste dans l'écran.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/m/${slug}/boutiques`);
  for (const box of await Promise.all(
    (await page.getByTestId('stock-site-shop').all()).map((l) => l.boundingBox()),
  )) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Magasin : la demande porte la boutique choisie.
  await page.goto('/stock/demandes');
  await expect(page.getByTestId('stock-showcase-requests')).toContainText('Awa Traoré');
  await expect(page.getByTestId('stock-request-site')).toContainText('Boutique Ségou');
});
