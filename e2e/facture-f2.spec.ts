import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — facturation F2, parcours navigateur : facture émise (définitive), payée en deux fois,
 * avoir partiel (trop-perçu), tableau de bord et export du journal des ventes. Données fictives, bases de
 * test locales jetables, aucun e-mail réel.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

const YEAR = new Date().getUTCFullYear();

test('Ocall Facture : facture émise, payée en deux fois, avoir', async ({ page }) => {
  test.setTimeout(240_000);
  // Émission d'une facture ou d'un avoir : confirmation (document définitif).
  page.on('dialog', (dialog) => void dialog.accept());
  const email = uniqueEmail('facture-f2');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Kati Clim', email });
  await startFactureTrial(email);

  await page.goto('/facture/parametres');
  const settings = page.getByTestId('facture-settings-form');
  await settings.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();

  await page.goto('/facture/clients');
  const clientForm = page.getByTestId('facture-client-form');
  await clientForm.getByLabel('Raison sociale ou nom').fill('Clinique Lumière');
  await clientForm.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByTestId('facture-client-list')).toContainText('Clinique Lumière');

  // Facture brouillon : 2 × 25 000 HT à 18 % = 59 000 TTC, paiement à réception.
  await page.goto('/facture/documents');
  const create = page.getByTestId('facture-new-document');
  await create.getByLabel('Type').selectOption({ label: 'Facture' });
  await create.getByLabel('Client').selectOption({ label: 'Clinique Lumière' });
  await create.getByRole('button', { name: 'Créer le brouillon' }).click();
  const editor = page.getByTestId('facture-document-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Délai de paiement').fill('0');
  await editor.getByTestId('facture-add-line').click();
  const row = editor.getByTestId('facture-line-row').first();
  await row.getByLabel('Désignation').fill('Maintenance climatiseur');
  await row.getByLabel('Quantité').fill('2');
  await row.getByLabel('P.U. HT (FCFA)').fill('25000');
  await expect(editor.getByTestId('facture-total-ttc')).toHaveText(/59\s000\sFCFA/);
  await editor.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-number')).toContainText(`FAC-${YEAR}-00001`);
  // Facture émise : définitive, jamais annulée.
  await expect(page.getByRole('button', { name: 'Annuler le document' })).toHaveCount(0);
  await expect(page.getByTestId('facture-balance')).toHaveText(/59\s000\sFCFA/);

  // Premier encaissement : 20 000 en espèces.
  const form = page.getByTestId('facture-payment-form');
  await form.getByLabel('Montant (FCFA)').fill('20000');
  await form.getByTestId('facture-record-payment').click();
  await expect(page.getByText('Encaissement enregistré.')).toBeVisible();
  await expect(page.getByTestId('facture-document-status')).toContainText('Payée en partie');
  await expect(page.getByTestId('facture-balance')).toHaveText(/39\s000\sFCFA/);

  // Solde : le montant proposé est le reste à payer ; paiement mobile money.
  await expect(form.getByLabel('Montant (FCFA)')).toHaveValue('39000');
  await form.getByLabel('Mode').selectOption({ label: 'Mobile money' });
  await form.getByLabel('Référence').fill('OM-123456');
  await form.getByTestId('facture-record-payment').click();
  await expect(page.getByTestId('facture-document-status')).toContainText('Soldée');
  await expect(page.getByTestId('facture-payments')).toContainText('OM-123456');
  await expect(page.getByTestId('facture-payment-form')).toHaveCount(0);

  // Avoir partiel : une unité retournée après paiement complet.
  await page.getByTestId('facture-create-credit-note').click();
  await expect(page.getByTestId('facture-document-number')).toContainText('Avoir — brouillon');
  const noteEditor = page.getByTestId('facture-document-editor');
  await expect(noteEditor.getByLabel('Client', { exact: true })).toBeDisabled();
  await noteEditor.getByTestId('facture-line-row').first().getByLabel('Quantité').fill('1');
  await expect(noteEditor.getByTestId('facture-total-ttc')).toHaveText(/29\s500\sFCFA/);
  await noteEditor.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-number')).toContainText(`AV-${YEAR}-00001`);
  const notePdf = await page.request.get(
    (await page.getByTestId('facture-document-pdf').getAttribute('href'))!,
  );
  expect((await notePdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Retour à la facture : trop-perçu à rembourser.
  await page.getByRole('link', { name: `facture FAC-${YEAR}-00001` }).click();
  await expect(page.getByTestId('facture-invoice-billing')).toContainText(
    'Trop-perçu à rembourser',
  );
  await expect(page.getByTestId('facture-balance')).toHaveText(/29\s500\sFCFA/);

  // Tableau de bord : facturé net des avoirs, encaissé ; export du journal des ventes.
  await page.goto('/facture');
  await expect(page.getByTestId('facture-kpi-invoiced')).toHaveText(/25\s000\sFCFA/);
  await expect(page.getByTestId('facture-kpi-collected')).toHaveText(/59\s000\sFCFA/);
  await expect(page.getByTestId('facture-kpi-outstanding')).toHaveText(/^0\sFCFA$/);
  const exportHref = await page.getByTestId('facture-export-sales').getAttribute('href');
  const csv = await page.request.get(exportHref!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain(`FAC-${YEAR}-00001`);
  expect(text).toContain(`;-25000;-4500;-29500;`);
});
