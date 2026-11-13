import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S4, parcours navigateur : caisse créée (imprimante simulée), session ouverte, vente à la
 * recherche puis au scan, monnaie rendue, ticket imprimé (simulation) ; panier mis en attente puis repris,
 * paiement mixte ; retour remboursé ; clôture avec écart motivé ; client créé ; caisse utilisable sur
 * téléphone. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock : caisse, ventes, ticket, attente, retour, clôture', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s4');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Caisse Stock', email });
  await startStockTrial(email);

  // Catalogue et stock (par l'API, avec la session du navigateur).
  const paint = await post<{ id: string; sku: string; variants: { id: string }[] }>(
    page,
    '/ocall-stock/products',
    { name: 'Peinture blanche 5 L', salePrice: 6000 },
  );
  const site = await post<{ id: string; locations: { id: string }[] }>(page, '/ocall-stock/sites', {
    code: 'MAG1',
    name: 'Magasin Bamako',
    kind: 'STORE',
  });
  await post(page, '/ocall-stock/movements', {
    kind: 'IN',
    variantId: paint.variants[0]!.id,
    locationId: site.locations[0]!.id,
    quantity: 20,
    idempotencyKey: `e2e${Date.now()}`,
  });

  // Caisse avec imprimante simulée (58 mm).
  await page.goto('/stock/caisses');
  const form = page.getByTestId('stock-register-form');
  await form.getByLabel('Code (ex. CAISSE1)').fill('CAISSE1');
  await form.getByLabel('Nom').fill('Caisse 1');
  await form.getByLabel('Site').selectOption({ label: 'MAG1 · Magasin Bamako' });
  await form
    .getByLabel('Vend depuis', { exact: true })
    .selectOption({ label: 'GENERAL · Général' });
  await form.getByLabel('Imprimante de tickets').selectOption('SIMULATED');
  await form.getByLabel('Largeur du papier').selectOption('58');
  await form.getByRole('button', { name: 'Créer la caisse' }).click();
  await expect(page.getByTestId('stock-register-list')).toContainText('Caisse 1');

  // Ouverture de la session.
  await page.goto('/stock/caisse');
  await page.getByTestId('stock-open-session').getByLabel('Fond de caisse').fill('10000');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(page.getByText('Session SES-000001')).toBeVisible();

  // Vente 1 : recherche, deux pots, espèces avec monnaie, ticket imprimé (simulation).
  await page.getByLabel('Rechercher un article').fill('peint');
  await page
    .getByTestId('stock-pos-results')
    .getByRole('button', { name: /Peinture/ })
    .click();
  await page.getByRole('button', { name: 'Ajouter un Peinture blanche 5 L' }).click();
  await expect(page.getByTestId('stock-cart-total')).toHaveText('12 000 FCFA');
  await page.getByRole('button', { name: 'Encaisser' }).click();
  const pay = page.getByTestId('stock-payment');
  await pay.getByLabel('Somme remise par le client').fill('15000');
  await expect(pay.getByText('Monnaie à rendre : 3 000 FCFA')).toBeVisible();
  await pay.getByRole('button', { name: 'Valider le paiement' }).click();
  const done = page.getByTestId('stock-sale-done');
  await expect(done).toContainText('VTE-000001');
  await expect(page.getByTestId('stock-receipt-preview')).toContainText('Monnaie rendue');
  await done.getByRole('button', { name: 'Imprimer le ticket' }).click();
  await expect(done.getByText('Ticket envoyé à l’imprimante.')).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __ocallSimulated?: { prints: string[][] } }).__ocallSimulated
          ?.prints.length ?? 0,
    ),
  ).toBe(1);
  await done.getByRole('button', { name: 'Nouvelle vente' }).click();

  // Vente 2 : lecture du code, mise en attente, reprise, paiement mixte.
  const scan = page.getByTestId('stock-pos-scan').getByRole('textbox');
  await scan.fill(paint.sku);
  await scan.press('Enter');
  await expect(page.getByTestId('stock-cart-total')).toHaveText('6 000 FCFA');
  await page.getByRole('button', { name: 'Mettre en attente' }).click();
  await expect(page.getByTestId('stock-held-carts')).toBeVisible();
  await expect(page.getByTestId('stock-cart')).toContainText('Scannez ou choisissez un article.');
  await page.getByTestId('stock-held-carts').getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByTestId('stock-cart-total')).toHaveText('6 000 FCFA');
  await page.getByRole('button', { name: 'Encaisser' }).click();
  await pay.getByLabel('Montant espèces').fill('2000');
  await pay.getByRole('button', { name: 'Ajouter un moyen de paiement' }).click();
  await pay.getByLabel('Référence de la transaction').fill('OM-778899');
  await pay.getByRole('button', { name: 'Valider le paiement' }).click();
  await expect(done).toContainText('VTE-000002');

  // Retour d'un pot de la première vente, remboursé en espèces.
  await page.goto('/stock/ventes');
  await page.getByTestId('stock-sale-list').getByRole('link', { name: 'VTE-000001' }).click();
  const ret = page.getByTestId('stock-return-form');
  await ret.getByLabel('Quantité retournée de Peinture blanche 5 L').fill('1');
  await ret.getByLabel('Motif').fill('Erreur de teinte');
  await expect(ret.getByText('À rembourser : 6 000 FCFA')).toBeVisible();
  await ret.getByRole('button', { name: 'Enregistrer le retour' }).click();
  await expect(page.getByTestId('stock-sale-returns')).toContainText('RET-000001');

  // Clôture : fond 10 000 + espèces 12 000 + 2 000 − remboursement 6 000 = 18 000 attendus.
  await page.goto('/stock/caisses');
  await page.getByRole('link', { name: 'SES-000001 ouverte' }).click();
  await expect(page.getByTestId('stock-expected-cash')).toHaveText('18 000 FCFA');
  const close = page.getByTestId('stock-close-session');
  await close.getByLabel('Espèces comptées').fill('17500');
  await close.getByLabel('Motif de l’écart').fill('Pièce manquante');
  await close.getByRole('button', { name: 'Clôturer' }).click();
  await expect(page.getByTestId('stock-session-difference')).toContainText('-500 FCFA');

  // Client.
  await page.goto('/stock/clients');
  const customer = page.getByTestId('stock-customer-form');
  await customer.getByLabel('Nom').fill('Mariam Coulibaly');
  await customer.getByLabel('Téléphone').fill('+223 76 11 22 33');
  await customer.getByRole('button', { name: 'Ajouter le client' }).click();
  await expect(page.getByTestId('stock-customer-list')).toContainText('Mariam Coulibaly');

  // Caisse sur téléphone : rien ne déborde, colonne par colonne.
  await page.goto('/stock/caisse');
  await page.getByTestId('stock-open-session').getByLabel('Fond de caisse').fill('0');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Rechercher un article').fill('peint');
  await page
    .getByTestId('stock-pos-results')
    .getByRole('button', { name: /Peinture/ })
    .click();
  for (const id of ['stock-pos-scan', 'stock-cart', 'stock-pos-results']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.x, id).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, id).toBeLessThanOrEqual(390);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
