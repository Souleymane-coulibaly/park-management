import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — commercial F1, parcours navigateur : client, article du catalogue, devis (ligne du
 * catalogue et ligne libre, totaux recalculés), émission numérotée, PDF, conversion en bon de commande
 * émis, puis en facture brouillon. Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

const YEAR = new Date().getUTCFullYear();

test('Ocall Facture : devis → bon de commande → facture brouillon', async ({ page }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('facture-f1');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Soleil Énergie', email });
  await startFactureTrial(email);

  // Identité de l'entreprise : NIF et adresse facultatifs, la raison sociale suffit.
  await page.goto('/facture/parametres');
  const settings = page.getByTestId('facture-settings-form');
  await settings.getByLabel('Activité ou slogan').fill('Distributeur agréé d’équipements solaires');
  await settings.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();

  // Client et article.
  await page.goto('/facture/clients');
  const clientForm = page.getByTestId('facture-client-form');
  await clientForm.getByLabel('Raison sociale ou nom').fill('Hôtel du Fleuve SA');
  await clientForm.getByLabel('Description').fill('Hôtellerie — site de Koulikoro');
  await clientForm.getByLabel('RIB').fill('ML000 00000 000000000000 00');
  await clientForm.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByTestId('facture-client-list')).toContainText('Hôtel du Fleuve SA');

  await page.goto('/facture/catalogue');
  const itemForm = page.getByTestId('facture-item-form');
  await itemForm.getByLabel('Référence').fill('OND-10K');
  await itemForm.getByLabel('Désignation').fill('Onduleur hybride 10 kW');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('25000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Onduleur hybride 10 kW');

  // Devis brouillon : ligne du catalogue + ligne libre ; total recalculé à la saisie.
  await page.goto('/facture/documents');
  const create = page.getByTestId('facture-new-document');
  await create.getByLabel('Client').selectOption({ label: 'Hôtel du Fleuve SA' });
  await create.getByRole('button', { name: 'Créer le brouillon' }).click();
  const editor = page.getByTestId('facture-document-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Titre du document').fill('Installation solaire 10 kW');
  await editor.getByLabel('Ajouter depuis le catalogue').selectOption({ index: 1 });
  await editor.getByTestId('facture-add-line').click();
  const free = editor.getByTestId('facture-line-row').nth(1);
  await free.getByLabel('Désignation').fill('Pose et mise en service');
  await free.getByLabel('Quantité').fill('2');
  await free.getByLabel('P.U. HT (FCFA)').fill('10000');
  // 25 000 + 2 × 10 000 = 45 000 HT ; TVA 18 % = 8 100 ; 53 100 TTC.
  await expect(editor.getByTestId('facture-total-ttc')).toHaveText(/53\s100\sFCFA/);
  await editor.getByTestId('facture-save').click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();

  // Émission : numéro définitif, PDF.
  await editor.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-number')).toContainText(`DEV-${YEAR}-00001`);
  await expect(page.getByTestId('facture-document-status')).toContainText('Émis');
  const pdfHref = await page.getByTestId('facture-document-pdf').getAttribute('href');
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Conversion en bon de commande (le devis devient accepté), émission.
  await page.getByTestId('facture-convert-ORDER').click();
  await expect(page.getByTestId('facture-document-number')).toContainText('Bon de commande');
  await expect(page.getByTestId('facture-total-ttc')).toHaveText(/53\s100\sFCFA/);
  await page.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-number')).toContainText(`BC-${YEAR}-00001`);

  // Conversion en facture : brouillon (émission au module de facturation).
  await page.getByTestId('facture-convert-INVOICE').click();
  await expect(page.getByTestId('facture-document-number')).toContainText('Facture — brouillon');
  await expect(
    page.getByText('L’émission des factures arrive avec le module de facturation.'),
  ).toBeVisible();
  await expect(page.getByTestId('facture-issue')).toHaveCount(0);

  // Liste : trois documents liés.
  await page.goto('/facture/documents');
  await expect(page.getByTestId('facture-document-list')).toContainText(`DEV-${YEAR}-00001`);
  await expect(page.getByTestId('facture-document-list')).toContainText(`BC-${YEAR}-00001`);
});
