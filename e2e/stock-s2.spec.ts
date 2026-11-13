import { expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S2, parcours navigateur : sites et emplacements, entrée de stock, stocks par site,
 * transfert préparé, expédié, reçu en partie puis manque déclaré, inventaire compté au scan et validé,
 * panneau caméra. Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

test('Ocall Stock : sites, entrée, transfert partiel, inventaire au scan', async ({ page }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s2');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Depot Stock', email });
  await startStockTrial(email);

  // Article.
  await page.goto('/stock/articles');
  await page.getByRole('button', { name: 'Nouvel article' }).click();
  const form = page.getByTestId('stock-product-form');
  await form.getByLabel('Désignation').fill('Peinture blanche 5 L');
  await form.getByLabel('Référence (générée si vide)').fill('PB5');
  await form.getByLabel('Prix de vente TTC').fill('12500');
  await form.getByRole('button', { name: 'Créer l’article' }).click();
  await expect(page).toHaveURL(/\/stock\/articles\/[0-9a-f-]{36}$/);

  // Sites et emplacement.
  await page.goto('/stock/sites');
  const siteForm = page.getByTestId('stock-site-form');
  for (const [code, name, kind] of [
    ['ENT1', 'Entrepôt Bamako', 'Entrepôt'],
    ['MAG1', 'Magasin ACI', 'Magasin'],
  ]) {
    await siteForm.getByLabel('Code (ex. MAG1)').fill(code!);
    await siteForm.getByLabel('Nom').fill(name!);
    await siteForm.getByLabel('Type').selectOption({ label: kind! });
    await siteForm.getByRole('button', { name: 'Créer le site' }).click();
    await expect(page.getByTestId('stock-site-list')).toContainText(name!);
  }
  await page.getByRole('link', { name: 'Entrepôt Bamako' }).click();
  const locForm = page.getByTestId('stock-location-form');
  await locForm.getByLabel('Niveau').selectOption({ label: 'Emplacement' });
  await locForm.getByLabel('Code (ex. A-01-03)').fill('A-01');
  await locForm.getByLabel('Nom').fill('Rayon A-01');
  await locForm.getByRole('button', { name: 'Ajouter l’emplacement' }).click();
  await expect(page.getByTestId('stock-location-tree')).toContainText('A-01');

  // Entrée de 10.
  await page.goto('/stock/mouvements');
  const entry = page.getByTestId('stock-movement-form');
  await entry
    .getByTestId('stock-movement-variant')
    .getByLabel('Article : rechercher')
    .fill('peinture');
  await entry
    .getByTestId('stock-movement-variant')
    .getByRole('button', { name: 'Choisir' })
    .click();
  const where = entry.getByTestId('stock-movement-location');
  await where.getByLabel('Site').selectOption({ label: 'ENT1 · Entrepôt Bamako' });
  await where
    .getByLabel('Emplacement', { exact: true })
    .selectOption({ label: 'A-01 · Rayon A-01' });
  await entry.getByLabel('Quantité').fill('10');
  await entry.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Entrée enregistrée : 10 en stock à cet emplacement.')).toBeVisible();
  await expect(page.getByTestId('stock-movement-list')).toContainText('+10');

  // Transfert de 4 vers le magasin : préparé, expédié, 3 reçus, 1 manquant.
  await page.goto('/stock/transferts');
  const tf = page.getByTestId('stock-transfer-form');
  await tf.getByLabel('Site de départ').selectOption({ label: 'ENT1 · Entrepôt Bamako' });
  await tf.getByLabel('Site d’arrivée').selectOption({ label: 'MAG1 · Magasin ACI' });
  await tf.getByLabel('Article à transférer : rechercher').fill('peinture');
  await tf.getByRole('button', { name: 'Choisir' }).click();
  await tf.getByLabel('Quantité de Peinture blanche 5 L').fill('4');
  await tf.getByRole('button', { name: 'Demander le transfert' }).click();
  await expect(page).toHaveURL(/\/stock\/transferts\/[0-9a-f-]{36}$/);
  await page
    .getByLabel('Prélèvement de Peinture blanche 5 L')
    .selectOption({ label: 'A-01 · Rayon A-01' });
  await page.getByRole('button', { name: 'Préparer (réserver)' }).click();
  await expect(page.getByTestId('stock-transfer-status')).toHaveText('Préparé');
  await page.getByRole('button', { name: 'Expédier' }).click();
  await expect(page.getByTestId('stock-transfer-status')).toHaveText('Expédié');
  await page.getByLabel('Quantité reçue de Peinture blanche 5 L').fill('3');
  await page.getByRole('button', { name: 'Enregistrer la réception' }).click();
  await expect(page.getByTestId('stock-transfer-status')).toHaveText('Reçu en partie');
  await page.getByLabel('Motif du manque').fill('Pot cassé en route');
  await page.getByRole('button', { name: 'Déclarer le reste manquant' }).click();
  await expect(page.getByTestId('stock-transfer-status')).toHaveText('Reçu');

  // Stocks par site : 6 à l'entrepôt, 3 au magasin.
  await page.goto('/stock/stocks');
  const levels = page.getByTestId('stock-level-list');
  await expect(levels.getByRole('row', { name: /ENT1/ })).toContainText('6');
  await expect(levels.getByRole('row', { name: /MAG1/ })).toContainText('3');

  // Inventaire de l'emplacement A-01 : 2 comptés au scan (référence + Entrée), validé (écart −4).
  await page.goto('/stock/inventaires');
  const cf = page.getByTestId('stock-count-form');
  await cf.getByLabel('Site').selectOption({ label: 'ENT1 · Entrepôt Bamako' });
  await cf.getByLabel('Nom').fill('Rayon A');
  await cf.getByLabel('A-01 · Rayon A-01').check();
  await cf.getByRole('button', { name: 'Ouvrir l’inventaire' }).click();
  await expect(page).toHaveURL(/\/stock\/inventaires\/[0-9a-f-]{36}$/);
  await page.getByLabel('Emplacement compté').selectOption({ label: 'A-01 · Rayon A-01' });
  const scan = page.getByTestId('stock-count-scan').getByRole('textbox');
  await scan.fill('PB5');
  await scan.press('Enter');
  await expect(page.getByText('+1 Peinture blanche 5 L')).toBeVisible();
  // Deuxième lecture après le délai anti-doublon.
  await page.waitForTimeout(1600);
  await scan.fill('PB5');
  await scan.press('Enter');
  await expect(page.getByTestId('stock-count-lines')).toContainText(/[-−]4/);
  await page.getByRole('button', { name: 'Valider l’inventaire' }).click();
  await expect(page.getByTestId('stock-count-status')).toHaveText('Validé');

  // Panneau caméra : s'ouvre et se ferme (sans caméra dans le navigateur de test : message clair).
  await page.goto('/stock/articles');
  await page.getByTestId('stock-products-scan').getByRole('button', { name: 'Caméra' }).click();
  await expect(page.getByTestId('camera-scanner')).toBeVisible();
  await page
    .getByTestId('stock-products-scan')
    .getByRole('button', { name: 'Fermer la caméra' })
    .click();
  await expect(page.getByTestId('camera-scanner')).toHaveCount(0);
});
