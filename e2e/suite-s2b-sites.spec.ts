import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite — Sprint 2, étape B, parcours navigateur : référentiel commun des sites. L'établissement
 * Park existant apparaît dans « Sites de l'organisation » ; une enseigne et une boutique y sont ajoutées ;
 * un site Stock créé avec son lieu, puis un site Stock rattaché au lieu Park existant : le même site montre
 * alors Ocall Park et Ocall Stock, sans doublon. Lisible sur téléphone. Données fictives, bases locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function sites(page: Page) {
  await page.goto('/suite/sites');
  return page.getByTestId('suite-sites');
}

test('Ocall Suite S2B : un site enregistré une fois, utilisé par Park et Stock', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('suite-s2b');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Parc Djoliba', email });
  await startStockTrial(email);
  const [park] = (await (await page.request.get('/api/v1/establishments')).json()) as {
    id: string;
    name: string;
  }[];

  // Portail : lien vers les sites ; l'établissement Park existant y figure, utilisé par Ocall Park.
  await page.goto('/suite');
  await page.getByTestId('suite-sites-link').click();
  await expect(page).toHaveURL(/\/suite\/sites$/);
  const list = page.getByTestId('suite-sites');
  const parkCard = list.getByTestId('suite-site').filter({ hasText: park!.name });
  await expect(parkCard.getByTestId('suite-site-apps')).toHaveText('Ocall Park');

  // Enseigne, puis boutique sans activité Park.
  const brandForm = page.getByTestId('suite-brand-form');
  await brandForm.getByLabel('Nom de l’enseigne').fill('Quincaillerie Sahel');
  await brandForm.getByRole('button', { name: 'Ajouter l’enseigne' }).click();
  await expect(page.getByTestId('suite-brands')).toContainText('Quincaillerie Sahel');
  await page.getByRole('button', { name: 'Ajouter un site' }).click();
  const form = page.getByTestId('suite-site-form');
  await form.getByLabel('Nom du site').fill('Boutique Bamako');
  await form.getByLabel('Nature du lieu').selectOption({ label: 'Boutique / magasin' });
  await form.getByLabel('Enseigne').selectOption({ label: 'Quincaillerie Sahel' });
  await form.getByLabel('Ville').fill('Bamako');
  await form.getByRole('button', { name: 'Enregistrer' }).click();
  const shopCard = list.getByTestId('suite-site').filter({ hasText: 'Boutique Bamako' });
  await expect(shopCard).toContainText('Enseigne : Quincaillerie Sahel');
  await expect(shopCard.getByTestId('suite-site-apps')).toHaveText('Aucune application');

  // Stock : un site créé avec son lieu dans le référentiel (case cochée par défaut).
  await page.goto('/stock/sites');
  const siteForm = page.getByTestId('stock-site-form');
  await siteForm.getByLabel('Code (ex. MAG1)').fill('SEG');
  await siteForm.getByRole('textbox', { name: 'Nom', exact: true }).fill('Boutique Ségou');
  await siteForm.getByRole('button', { name: 'Créer le site' }).click();
  const stockList = page.getByTestId('stock-site-list');
  await expect(stockList.locator('tr').filter({ hasText: 'Boutique Ségou' })).toContainText(
    'Rattaché',
  );

  // Stock : un site créé sans lieu, puis rattaché au lieu Park existant.
  await siteForm.getByLabel('Code (ex. MAG1)').fill('PARC');
  await siteForm.getByRole('textbox', { name: 'Nom', exact: true }).fill('Boutique du parc');
  await siteForm.getByLabel('Enregistrer aussi ce lieu dans le référentiel Ocall Suite').uncheck();
  await siteForm.getByRole('button', { name: 'Créer le site' }).click();
  const row = stockList.locator('tr').filter({ hasText: 'Boutique du parc' });
  await expect(row).toContainText('Non rattaché');
  await row.getByRole('button', { name: 'Référentiel : Boutique du parc' }).click();
  const panel = page.getByTestId('site-link-panel');
  await panel.getByLabel('Lieu du référentiel').selectOption({ label: park!.name });
  await panel.getByRole('button', { name: 'Rattacher' }).click();
  await expect(panel.getByTestId('site-link-status')).toHaveText(`Rattaché à « ${park!.name} »`);

  // Référentiel : le lieu Park sert aussi à Stock, une seule fiche ; Ségou est un nouveau lieu Stock.
  const after = await sites(page);
  await expect(after.getByTestId('suite-site').filter({ hasText: park!.name })).toHaveCount(1);
  const shared = after.getByTestId('suite-site').filter({ hasText: park!.name });
  await expect(shared.getByTestId('suite-site-apps')).toContainText('Ocall Park');
  await expect(shared.getByTestId('suite-site-apps')).toContainText('Ocall Stock');
  await expect(
    after
      .getByTestId('suite-site')
      .filter({ hasText: 'Boutique Ségou' })
      .getByTestId('suite-site-apps'),
  ).toHaveText('Ocall Stock');

  // Téléphone : les cartes restent dans l'écran.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const box of await Promise.all(
    (await after.getByTestId('suite-site').all()).map((l) => l.boundingBox()),
  )) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
