import { expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S3, parcours navigateur : fournisseur, commande passée, réception partielle puis du reste,
 * annulation d'une réception, document joint, retour fournisseur. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

test('Ocall Stock : commande fournisseur, réceptions, annulation, document, retour', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const email = uniqueEmail('stock-s3');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Achats Stock', email });
  await startStockTrial(email);

  // Article, site, fournisseur.
  await page.goto('/stock/articles');
  await page.getByRole('button', { name: 'Nouvel article' }).click();
  const form = page.getByTestId('stock-product-form');
  await form.getByLabel('Désignation').fill('Ciment 50 kg');
  await form.getByLabel('Référence (générée si vide)').fill('CIM50');
  await form.getByLabel('Prix de vente TTC').fill('6000');
  await form.getByRole('button', { name: 'Créer l’article' }).click();
  await expect(page).toHaveURL(/\/stock\/articles\/[0-9a-f-]{36}$/);
  await page.goto('/stock/sites');
  const siteForm = page.getByTestId('stock-site-form');
  await siteForm.getByLabel('Code (ex. MAG1)').fill('DEP1');
  await siteForm.getByLabel('Nom').fill('Dépôt Kalaban');
  await siteForm.getByRole('button', { name: 'Créer le site' }).click();
  await expect(page.getByTestId('stock-site-list')).toContainText('Dépôt Kalaban');
  await page.goto('/stock/fournisseurs');
  const sup = page.getByTestId('stock-supplier-form');
  await sup.getByLabel('Raison sociale').fill('Cimenterie du Sahel');
  await sup.getByRole('button', { name: 'Ajouter le fournisseur' }).click();
  await expect(page.getByTestId('stock-supplier-list')).toContainText('Cimenterie du Sahel');

  // Commande de 100 sacs à 4 500 HT.
  await page.goto('/stock/achats');
  const po = page.getByTestId('stock-purchase-form');
  await po.getByLabel('Fournisseur').selectOption({ label: 'Cimenterie du Sahel' });
  await po.getByLabel('Site de livraison').selectOption({ label: 'DEP1 · Dépôt Kalaban' });
  await po.getByLabel('Article à commander : rechercher').fill('ciment');
  await po.getByRole('button', { name: 'Choisir' }).click();
  await po.getByLabel('Quantité de Ciment 50 kg').fill('100');
  await po.getByLabel('Coût de Ciment 50 kg').fill('4500');
  await po.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page).toHaveURL(/\/stock\/achats\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('stock-purchase-status')).toHaveText('Brouillon');
  await page.getByRole('button', { name: 'Passer la commande' }).click();
  await expect(page.getByTestId('stock-purchase-status')).toHaveText('Commandée');

  // Réception partielle (60) puis du reste (40).
  await page.getByLabel('Quantité reçue de Ciment 50 kg').fill('60');
  await page.getByLabel('Bon de livraison (facultatif)').fill('BL-2026-118');
  await page.getByRole('button', { name: 'Enregistrer la réception' }).click();
  await expect(page.getByTestId('stock-purchase-status')).toHaveText('Reçue en partie');
  await expect(page.getByTestId('stock-receipts')).toContainText('BL BL-2026-118');
  await page.getByRole('button', { name: 'Enregistrer la réception' }).click();
  await expect(page.getByTestId('stock-purchase-status')).toHaveText('Reçue');

  // Annulation de la seconde réception : la commande attend de nouveau 40 sacs.
  await page
    .getByLabel('Motif d’annulation d’une réception')
    .fill('Livraison refusée (sacs mouillés)');
  await page.getByRole('button', { name: 'Annuler la réception' }).last().click();
  await expect(page.getByTestId('stock-purchase-status')).toHaveText('Reçue en partie');
  await expect(page.getByTestId('stock-receipts')).toContainText(
    'Annulée : Livraison refusée (sacs mouillés)',
  );

  // Document joint (bon de livraison en PDF).
  await page
    .getByTestId('stock-documents')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'BL-2026-118.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
  await expect(page.getByTestId('stock-documents')).toContainText('BL-2026-118.pdf');

  // Stock : 60 au dépôt.
  await page.goto('/stock/stocks');
  await expect(
    page.getByTestId('stock-level-list').getByRole('row', { name: /DEP1/ }),
  ).toContainText('60');

  // Retour de 5 sacs au fournisseur.
  await page.goto('/stock/achats/retours');
  const ret = page.getByTestId('stock-return-form');
  await ret.getByLabel('Fournisseur').selectOption({ label: 'Cimenterie du Sahel' });
  await ret.getByLabel('Site').selectOption({ label: 'DEP1 · Dépôt Kalaban' });
  await ret
    .getByLabel('Emplacement de départ', { exact: true })
    .selectOption({ label: 'GENERAL · Général' });
  await ret.getByLabel('Article retourné : rechercher').fill('ciment');
  await ret.getByRole('button', { name: 'Choisir' }).click();
  await ret.getByLabel('Quantité').fill('5');
  await ret.getByLabel('Motif').fill('Sacs percés');
  await ret.getByRole('button', { name: 'Enregistrer le retour' }).click();
  await expect(page.getByText('Retour RF-000001 enregistré.')).toBeVisible();
  await expect(page.getByTestId('stock-return-list')).toContainText('Ciment 50 kg × 5');
});
