import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Stock — S1, parcours navigateur : essai, portail, réglages, catégories, article, codes-barres
 * (clé de contrôle, code interne), scan clavier d'un code connu et d'un code inconnu (création), recherche
 * tolérante, étiquettes PDF, équipe, format téléphone. Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

const EAN13 = '4006381333931';
const UNKNOWN_EAN8 = '96385074';

test('Ocall Stock : catalogue, codes-barres, scan, recherche, étiquettes et équipe', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('stock-s1');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Quincaillerie Stock', email });
  await startStockTrial(email);

  // Portail : tuile Ocall Stock ouverte.
  await page.goto('/suite');
  const tile = page.getByTestId('suite-app-OCALL_STOCK');
  await expect(tile).toBeVisible();
  await tile.getByRole('link', { name: 'Ouvrir' }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByText('Propriétaire (administrateur)')).toBeVisible();

  // Réglages : préfixe des codes.
  await page.goto('/stock/parametres');
  const settings = page.getByTestId('stock-settings-form');
  await settings.getByLabel('Préfixe des codes (2 à 4 lettres)').fill('qs');
  await settings.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

  // Catégories : deux niveaux.
  await page.goto('/stock/categories');
  const categoryForm = page.getByTestId('stock-category-form');
  await categoryForm.getByLabel('Nouvelle catégorie').fill('Peintures');
  await categoryForm.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByTestId('stock-category-tree')).toContainText('Peintures');
  await categoryForm.getByLabel('Nouvelle catégorie').fill('Acryliques');
  await categoryForm.getByLabel('Dans').selectOption({ label: 'Peintures' });
  await categoryForm.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByTestId('stock-category-tree')).toContainText('Acryliques');

  // Article : référence générée avec le préfixe.
  await page.goto('/stock/articles');
  await page.getByRole('button', { name: 'Nouvel article' }).click();
  const form = page.getByTestId('stock-product-form');
  await form.getByLabel('Désignation').fill('Peinture acrylique blanche');
  await form.getByLabel('Catégorie').selectOption({ label: 'Peintures › Acryliques' });
  await form.getByLabel('Prix de vente TTC').fill('12500');
  await form.getByLabel('Prix d’achat HT (facultatif)').fill('9000');
  await form.getByRole('button', { name: 'Créer l’article' }).click();
  await expect(page).toHaveURL(/\/stock\/articles\/[0-9a-f-]{36}$/);
  await expect(page.getByText('QS-000001').first()).toBeVisible();

  // Codes : EAN à clé fausse refusé, EAN valide accepté, code interne généré.
  const variants = page.getByTestId('stock-variants');
  await variants.getByLabel('Code du fabricant').fill('4006381333932');
  await variants.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText(/clé de contrôle ne correspond pas/)).toBeVisible();
  await variants.getByLabel('Code du fabricant').fill(EAN13);
  await variants.getByRole('button', { name: 'Ajouter' }).click();
  await expect(variants).toContainText(EAN13);
  await variants.getByRole('button', { name: 'Générer un code interne' }).click();
  await expect(variants).toContainText('QS00000001');

  // Scan clavier (lecteur USB) d'un code connu : la fiche s'ouvre.
  await page.goto('/stock/articles');
  const scan = page.getByTestId('stock-products-scan').getByRole('textbox');
  await scan.fill(EAN13);
  await scan.press('Enter');
  await expect(page).toHaveURL(/\/stock\/articles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Peinture acrylique blanche' })).toBeVisible();

  // Code inconnu : création proposée, le code est ajouté à l'article créé.
  await page.goto('/stock/articles');
  await scan.fill(UNKNOWN_EAN8);
  await scan.press('Enter');
  await expect(page.getByText(`Code inconnu : ${UNKNOWN_EAN8} (EAN-8 valide).`)).toBeVisible();
  await form.getByLabel('Désignation').fill('Colle à bois');
  await form.getByLabel('Prix de vente TTC').fill('2500');
  await form.getByRole('button', { name: 'Créer l’article' }).click();
  await expect(page).toHaveURL(/\/stock\/articles\/[0-9a-f-]{36}\?code=96385074$/);
  await expect(variants.getByLabel('Code du fabricant')).toHaveValue(UNKNOWN_EAN8);
  await variants.getByRole('button', { name: 'Ajouter' }).click();
  await expect(variants).toContainText('EAN-8');

  // Recherche tolérante (faute de frappe, sans accents).
  await page.goto('/stock/recherche?q=acrilique');
  await expect(page.getByTestId('stock-search-results')).toContainText(
    'Peinture acrylique blanche',
  );

  // Étiquettes : PDF au format choisi.
  await page.goto('/stock/etiquettes');
  await page.getByLabel('Rechercher un article').fill('peinture');
  await page
    .getByTestId('stock-label-results')
    .getByRole('button', { name: 'Ajouter' })
    .first()
    .click();
  await page.getByLabel('Copies de Peinture acrylique blanche').fill('3');
  await page.getByLabel('Format').selectOption('40x30');
  await page.getByLabel('QR code').check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger le PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('etiquettes.pdf');
  const pdf = readFileSync((await file.path())!).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(3);

  // Équipe : caissier créé, mot de passe temporaire affiché une fois.
  await page.goto('/stock/equipe');
  const memberForm = page.getByTestId('stock-member-form');
  await memberForm.getByLabel('Prénom').fill('Awa');
  await memberForm.getByLabel(/^Nom/).fill('Caisse');
  await memberForm.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByText('Compte créé')).toBeVisible();
  await expect(page.getByTestId('stock-member-list')).toContainText('Caissier');

  // Téléphone : aucun défilement horizontal du catalogue ; menu avec « Mes applications ».
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stock/articles');
  await expect(page.getByTestId('stock-product-list')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Mes applications' }),
  ).toBeVisible();
});
