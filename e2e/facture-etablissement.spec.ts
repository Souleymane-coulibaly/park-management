import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite S2 — Facture, établissement émetteur, parcours navigateur : l'établissement est choisi sur le
 * brouillon parmi ceux du référentiel commun des sites, il reste affiché une fois le document émis
 * (numérotation de l'organisation inchangée), la liste le montre et le filtre ; lisible sur téléphone.
 * Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

const YEAR = new Date().getUTCFullYear();

test('Ocall Facture : établissement émetteur choisi, imprimé et figé', async ({ page }) => {
  test.setTimeout(240_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const email = uniqueEmail('facture-etab');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Kayes Froid', email });
  await startFactureTrial(email);

  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(`/api/v1${path}`, { data });
    expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  await post('/establishments', {
    name: 'Agence Kayes',
    businessType: 'NONE',
    city: 'Kayes',
    address: 'Rue 12, Plateau',
  });
  const settings = await page.request.put('/api/v1/facture/settings', {
    data: {
      legalName: 'Kayes Froid SARL',
      tradeName: 'Kayes Froid',
      address: 'Avenue du Fleuve',
      city: 'Bamako',
      phone: '+223 70 00 00 01',
      email: `contact.${Date.now()}@test.ocallpark.local`,
      nif: '084123456A',
      defaultVatRate: 18,
      paymentTermsDays: 30,
      quoteValidityDays: 15,
    },
  });
  expect(settings.ok(), `settings : ${settings.status()} ${await settings.text()}`).toBeTruthy();
  await post('/facture/clients', { kind: 'COMPANY', name: 'Clinique Lumière' });

  await page.goto('/facture/documents');
  const create = page.getByTestId('facture-new-document');
  await create.getByLabel('Type').selectOption({ label: 'Facture' });
  await create.getByLabel('Client').selectOption({ label: 'Clinique Lumière' });
  await create.getByRole('button', { name: 'Créer le brouillon' }).click();
  const editor = page.getByTestId('facture-document-editor');
  await expect(editor).toBeVisible();
  const select = editor.getByTestId('facture-establishment-select');
  await expect(select.locator('option', { hasText: 'Agence Kayes — Kayes' })).toHaveCount(1);
  await select.selectOption({ label: 'Agence Kayes — Kayes' });
  await editor.getByTestId('facture-add-line').click();
  const row = editor.getByTestId('facture-line-row').first();
  await row.getByLabel('Désignation').fill('Maintenance climatiseur');
  await row.getByLabel('Quantité').fill('1');
  await row.getByLabel('P.U. HT (FCFA)').fill('25000');

  // Téléphone : l'en-tête du brouillon reste dans l'écran.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(select).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  await editor.getByTestId('facture-issue').click();
  await expect(page.getByTestId('facture-document-number')).toContainText(`FAC-${YEAR}-00001`);
  await expect(page.getByTestId('facture-document-establishment')).toContainText(
    'Établissement émetteur : Agence Kayes — Rue 12, Plateau, Kayes',
  );
  // Document émis : plus d'éditeur, donc plus de choix d'établissement.
  await expect(page.getByTestId('facture-establishment-select')).toHaveCount(0);
  const pdf = await page.request.get(page.url().replace('/facture/', '/api/v1/facture/') + '/pdf');
  expect(pdf.ok()).toBeTruthy();
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Liste : nom de l'établissement et filtre.
  await page.goto('/facture/documents');
  const list = page.getByTestId('facture-document-list');
  await expect(list).toContainText('Agence Kayes');
  await page.getByLabel('Établissement').selectOption({ label: 'Agence Kayes' });
  await expect(list).toContainText(`FAC-${YEAR}-00001`);
});
