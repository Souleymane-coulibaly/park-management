import { type Page, expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S5, parcours navigateur (organisation abonnée aux deux applications) : emplacement des
 * ventes Facture réglé dans Stock ; dans une facture Facture, recherche d'un article Ocall Stock (prix et
 * disponibilité), ajout, avertissement avant émission, émission puis « Stock mis à jour » ; trace dans
 * Stock ; facture d'une vente en caisse ; article miroir en lecture seule au catalogue ; recherche
 * utilisable sur téléphone. Données fictives, bases de test locales.
 */
test.skip(
  !process.env.TEST_STOCK_DATABASE_URL || !process.env.TEST_FACTURE_DATABASE_URL,
  'Bases Stock et Facture de test absentes.',
);

async function call<T>(
  page: Page,
  method: 'post' | 'put',
  path: string,
  data: unknown,
): Promise<T> {
  const res = await page.request[method](`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Stock ↔ Facture : article Stock facturé, stock mis à jour, vente en caisse facturée', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s5');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Quincaillerie S5', email });
  await startFactureTrial(email);
  await startStockTrial(email);

  // Données de départ (API, session du navigateur) : identité Facture, client, article et stock.
  await call(page, 'put', '/facture/settings', {
    legalName: 'Quincaillerie du Fleuve SARL',
    tradeName: 'Quincaillerie du Fleuve',
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    phone: '+223 70 00 00 00',
    email: `contact.${Date.now()}@test.ocallpark.local`,
    nif: '084123456A',
    defaultVatRate: 18,
    paymentTermsDays: 30,
    quoteValidityDays: 15,
  });
  const client = await call<{ id: string }>(page, 'post', '/facture/clients', {
    kind: 'COMPANY',
    name: 'BTP Sahel',
  });
  const paint = await call<{ variants: { id: string }[] }>(page, 'post', '/ocall-stock/products', {
    name: 'Peinture blanche 5 L',
    salePrice: 11_800,
    vatRate: 18,
  });
  const site = await call<{ locations: { id: string }[] }>(page, 'post', '/ocall-stock/sites', {
    code: 'MAG1',
    name: 'Magasin Bamako',
    kind: 'STORE',
  });
  await call(page, 'post', '/ocall-stock/movements', {
    kind: 'IN',
    variantId: paint.variants[0]!.id,
    locationId: site.locations[0]!.id,
    quantity: 10,
    idempotencyKey: `e2e${Date.now()}`,
  });

  // Stock : emplacement des ventes Facture.
  await page.goto('/stock/parametres');
  const where = page.getByTestId('stock-facture-location');
  await where.getByLabel('Site').selectOption({ label: 'MAG1 · Magasin Bamako' });
  await where
    .getByLabel('Emplacement des ventes Facture', { exact: true })
    .selectOption({ label: 'GENERAL · Général' });
  await page
    .getByTestId('stock-settings-form')
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

  // Facture : un brouillon, l'article cherché dans Ocall Stock.
  const draft = await call<{ id: string }>(page, 'post', '/facture/documents', {
    type: 'INVOICE',
    clientId: client.id,
    lines: [],
  });
  await page.goto(`/facture/documents/${draft.id}`);
  const picker = page.getByTestId('facture-stock-picker');
  await picker.getByLabel('Articles Ocall Stock (nom, référence, code-barres)').fill('peinture');
  await picker.getByRole('button', { name: 'Chercher' }).click();
  const results = picker.getByTestId('facture-stock-results');
  await expect(results).toContainText('Peinture blanche 5 L');
  await expect(results).toContainText('10 000 FCFA HT (11 800 FCFA TTC)');
  await expect(results).toContainText('Disponible : 10');

  // Téléphone : la recherche reste dans l'écran (mesure de la carte elle-même).
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  await results.getByRole('button', { name: 'Ajouter' }).click();
  const row = page.getByTestId('facture-line-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel('Désignation', { exact: false })).toHaveValue('Peinture blanche 5 L');
  await expect(row.getByLabel('P.U. HT (FCFA)')).toHaveValue('10000');
  await row.getByLabel('Quantité').fill('3');
  await page.getByTestId('facture-save').click();
  const preview = page.getByTestId('facture-stock-preview');
  await expect(preview).toContainText('À l’émission, ces articles sortiront du stock');
  await expect(preview).toContainText('Peinture blanche 5 L : 3 (disponible : 10)');

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-status')).toContainText('Émis');
  // Transmission à Stock par le répartiteur, juste après l'émission.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('facture-stock-sync')).toContainText('Stock mis à jour', {
      timeout: 2000,
    });
  }).toPass({ timeout: 60_000 });
  const number = (await page.getByTestId('facture-document-number').textContent())!
    .replace('Facture', '')
    .trim();

  // Stock : la demande reçue est tracée, le stock a baissé.
  await page.goto('/stock/parametres');
  const events = page.getByTestId('stock-facture-events');
  await expect(events).toContainText(number);
  await expect(events).toContainText('Peinture blanche 5 L : −3');

  // Vente en caisse, puis sa facture depuis Facture (aucun second déstockage).
  const register = await call<{ id: string }>(page, 'post', '/ocall-stock/registers', {
    code: 'CAISSE1',
    name: 'Caisse 1',
    locationId: site.locations[0]!.id,
  });
  await call(page, 'post', `/ocall-stock/registers/${register.id}/sessions`, { openingFloat: 0 });
  await call(page, 'post', '/ocall-stock/sales', {
    idempotencyKey: `e2esale${Date.now()}`,
    registerId: register.id,
    lines: [{ variantId: paint.variants[0]!.id, quantity: 1 }],
    payments: [{ method: 'CASH', amount: 11_800 }],
  });
  await page.goto('/facture/stock');
  const form = page.getByTestId('facture-stock-invoice-sale');
  await form.getByLabel('Numéro de la vente', { exact: false }).fill('VTE-000001');
  await form.getByLabel('Client', { exact: false }).selectOption({ label: 'BTP Sahel' });
  await form.getByRole('button', { name: 'Créer la facture' }).click();
  await expect(page.getByText('Facture de la vente en caisse VTE-000001')).toBeVisible();
  await expect(page.getByTestId('facture-line-row')).toHaveCount(1);

  // Suivi : la facture émise figure dans la liste, stock mis à jour.
  await page.goto('/facture/stock');
  await expect(page.getByTestId('facture-stock-sync-list')).toContainText(number);

  // Catalogue : l'article miroir est signalé et ne se modifie pas dans Facture.
  await page.goto('/facture/catalogue');
  const list = page.getByTestId('facture-item-list');
  const mirror = list.getByRole('row', { name: /Peinture blanche 5 L/ });
  await expect(mirror).toContainText('Ocall Stock');
  await expect(mirror.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await expect(mirror.getByRole('button', { name: 'Délier' })).toBeVisible();
});
