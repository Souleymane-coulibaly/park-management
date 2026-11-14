import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S7, parcours navigateur : site vitrine créé, contenu et prix affichés, article coché
 * « Publier sur la vitrine », mise en ligne ; côté visiteur, accueil, catalogue, fiche article (prix,
 * « Disponible »), article ajouté à la demande de devis, envoi ; côté magasin, la demande reçue avec son
 * article. Fiche article lisible sur téléphone. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock : site vitrine, catalogue public et demande de devis', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s7');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Vitrine Stock', email });
  await startStockTrial(email, { showcase: true });

  const paint = await post<{ id: string; variants: { id: string }[] }>(
    page,
    '/ocall-stock/products',
    { name: 'Peinture blanche 5 L', salePrice: 11_800, vatRate: 18, purchasePrice: 6000 },
  );
  await post(page, '/ocall-stock/products', { name: 'Article interne', salePrice: 1000 });
  const site = await post<{ locations: { id: string }[] }>(page, '/ocall-stock/sites', {
    code: 'MAG1',
    name: 'Magasin Bamako',
    kind: 'STORE',
  });
  await post(page, '/ocall-stock/movements', {
    kind: 'IN',
    variantId: paint.variants[0]!.id,
    locationId: site.locations[0]!.id,
    quantity: 5,
    idempotencyKey: `e2e${Date.now()}`,
  });

  // Création du site : adresse, contenu (prix affichés), article publié, mise en ligne.
  await page.goto('/stock/vitrine');
  const slug = `vitrine-${Date.now().toString(36)}`;
  await page.getByLabel('Adresse du site').fill(slug);
  await page.getByRole('button', { name: 'Créer le site' }).click();
  const content = page.getByTestId('stock-showcase-content');
  await content.getByLabel('Titre principal').fill('Tout pour bâtir à Bamako');
  await content.getByLabel('WhatsApp (+223 …)').fill('+223 70 11 22 33');
  await content.getByLabel('Ville').fill('Bamako');
  await content.getByRole('checkbox', { name: /Afficher les prix/ }).check();
  // Couleur principale du site (même règle que les sites Park).
  await content.getByLabel('Couleur principale du site').fill('#1e3a8a');
  await content.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(content.getByText('Brouillon enregistré.')).toBeVisible();
  const products = page.getByTestId('stock-showcase-products');
  // Case pilotée par l'API : l'état change après la réponse (badge « Publié »).
  await products
    .getByRole('checkbox', { name: 'Publier sur la vitrine : Peinture blanche 5 L' })
    .click();
  await expect(products.getByText('Publié')).toHaveCount(1);
  await page.getByTestId('stock-showcase-publish').click();
  await expect(page.getByText('Site en ligne')).toBeVisible();

  // Côté visiteur : accueil, catalogue (l'article interne n'y est pas), fiche article.
  await page.goto(`/m/${slug}`);
  await expect(page.getByRole('heading', { name: 'Tout pour bâtir à Bamako' })).toBeVisible();
  await expect(page.getByTestId('stock-site-whatsapp')).toBeVisible();
  await expect(page.getByTestId('stock-site-featured')).toContainText('Peinture blanche 5 L');
  // Mise en page des sites Park, à la couleur choisie.
  await expect(page.getByTestId('stock-site')).toHaveAttribute('style', /--brand:\s*#1e3a8a/i);
  if (process.env.E2E_SHOTS) {
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/stock-vitrine-bureau.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${process.env.E2E_SHOTS}/stock-vitrine-telephone.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  await page.getByRole('link', { name: 'Tout le catalogue' }).click();
  const catalog = page.getByTestId('stock-site-catalog');
  await expect(catalog).toContainText('Peinture blanche 5 L');
  await expect(catalog).not.toContainText('Article interne');
  await catalog.getByRole('link', { name: /Peinture blanche 5 L/ }).click();
  const product = page.getByTestId('stock-site-product');
  await expect(product).toContainText('11 800 FCFA TTC');
  await expect(product).toContainText('Disponible');
  await expect(product).not.toContainText('6 000');
  const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(jsonLd!)).toMatchObject({
    '@type': 'Product',
    offers: { price: 11_800, availability: 'https://schema.org/InStock' },
  });

  // Téléphone : la fiche reste dans l'écran (chaque colonne mesurée).
  await page.setViewportSize({ width: 390, height: 844 });
  for (const box of [
    await product.boundingBox(),
    await page.getByTestId('stock-site-add').boundingBox(),
  ]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Demande de devis avec l'article.
  await product.getByLabel('Quantité').fill('12');
  await page.getByTestId('stock-site-add').click();
  await expect(page.getByTestId('stock-site-add')).toHaveText('Dans votre demande');
  await page.getByRole('link', { name: 'Voir ma demande et l’envoyer' }).click();
  const form = page.getByTestId('stock-site-request-form');
  await expect(form.getByTestId('stock-site-request-items')).toContainText('Peinture blanche 5 L');
  await form.getByLabel('Votre nom').fill('Awa Traoré');
  await form.getByLabel('Téléphone').fill('+223 76 00 00 01');
  await form.getByLabel('Message').fill('Devis pour un chantier, livraison possible ?');
  // Anti-spam : un envoi trop rapide est ignoré par l'API ; on laisse passer quelques secondes.
  await page.waitForTimeout(3500);
  await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(page.getByTestId('stock-site-request-sent')).toBeVisible();

  // Côté magasin : la demande et son article.
  await page.goto('/stock/demandes');
  const inbox = page.getByTestId('stock-showcase-requests');
  await expect(inbox).toContainText('Awa Traoré');
  await expect(inbox).toContainText('Peinture blanche 5 L : 12');
});
