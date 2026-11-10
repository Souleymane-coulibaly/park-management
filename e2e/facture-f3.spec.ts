import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — interventions F3, parcours navigateur : équipement du client, intervention planifiée
 * pour un technicien, réalisée (temps, pièce, photo), terminée, signée à l'écran par le client, rapport
 * PDF, puis facturée (facture brouillon reprenant temps et pièce). Données fictives, bases de test
 * locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

/** Petite image PNG valide (1 × 1 pixel). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('Ocall Facture : intervention planifiée, réalisée, signée, facturée', async ({ page }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('facture-f3');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Services', email });
  await startFactureTrial(email);

  await page.goto('/facture/parametres');
  await page
    .getByTestId('facture-settings-form')
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();

  await page.goto('/facture/equipe');
  const memberForm = page.getByTestId('facture-member-form');
  await memberForm.getByLabel('Prénom').fill('Moussa');
  await memberForm.getByRole('textbox', { name: 'Nom', exact: true }).fill('Diarra');
  await memberForm.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByTestId('facture-member-list')).toContainText('Diarra');

  await page.goto('/facture/clients');
  const clientForm = page.getByTestId('facture-client-form');
  await clientForm.getByLabel('Raison sociale ou nom').fill('Hôtel du Fleuve');
  await clientForm.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByTestId('facture-client-list')).toContainText('Hôtel du Fleuve');

  await page.goto('/facture/catalogue');
  const itemForm = page.getByTestId('facture-item-form');
  await itemForm.getByLabel('Désignation').fill('Main-d’œuvre technicien');
  await itemForm.getByLabel('Unité').fill('heure');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('10000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Main-d’œuvre technicien');
  await itemForm.getByLabel('Type').selectOption({ label: 'Article ou pièce' });
  await itemForm.getByLabel('Désignation').fill('Filtre à air');
  await itemForm.getByLabel('Unité').fill('unité');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('25000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Filtre à air');

  await page.goto('/facture/equipements');
  const equipmentForm = page.getByTestId('facture-equipment-form');
  await equipmentForm.getByLabel('Désignation').fill('Climatiseur salle de réunion');
  await equipmentForm.getByLabel('Numéro de série').fill('DK-2041');
  await equipmentForm.getByRole('button', { name: 'Ajouter l’équipement' }).click();
  await expect(page.getByTestId('facture-equipment-list')).toContainText(
    'Climatiseur salle de réunion',
  );

  // Planification : client, équipement, créneau, technicien.
  await page.goto('/facture/interventions');
  const planForm = page.getByTestId('facture-new-intervention');
  await planForm.getByLabel('Client').selectOption({ label: 'Hôtel du Fleuve' });
  await planForm.getByLabel('Équipement').selectOption({ label: 'Climatiseur salle de réunion' });
  await planForm.getByLabel('Objet de la demande').fill('Climatiseur en panne');
  await planForm.getByLabel('Moussa Diarra (Technicien)').check();
  await planForm.getByRole('button', { name: 'Planifier' }).click();
  const view = page.getByTestId('facture-intervention');
  await expect(view).toHaveAttribute('data-status', 'PLANNED');
  await expect(view).toContainText('Moussa Diarra');

  // Réalisation : démarrage, 1 h 30 de travail, une pièce, une photo.
  await page.getByTestId('facture-intervention-start').click();
  await expect(view).toHaveAttribute('data-status', 'IN_PROGRESS');
  const timeForm = page.getByTestId('facture-time-form');
  await timeForm.getByLabel('Heures').fill('1');
  await timeForm.getByLabel('Minutes').fill('30');
  await timeForm.getByRole('button', { name: 'Ajouter le temps' }).click();
  await expect(page.getByTestId('facture-time-entries')).toContainText('1 h 30');
  const partForm = page.getByTestId('facture-part-form');
  await partForm.getByLabel('Article').selectOption({ label: 'Filtre à air' });
  await partForm.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByTestId('facture-parts')).toContainText('Filtre à air');
  await page
    .getByTestId('facture-photo-input')
    .setInputFiles({ name: 'avant.png', mimeType: 'image/png', buffer: PIXEL });
  await expect(page.getByTestId('facture-photos').locator('img')).toHaveCount(1);

  // Fin des travaux : rapport rédigé, saisies figées.
  const complete = page.getByTestId('facture-complete-form');
  await complete
    .getByLabel('Travaux réalisés')
    .fill('Nettoyage des filtres, remplacement du filtre.');
  await complete.getByRole('button', { name: 'Terminer les travaux' }).click();
  await expect(view).toHaveAttribute('data-status', 'COMPLETED');
  await expect(page.getByTestId('facture-time-form')).toHaveCount(0);

  // Signature du client à l'écran.
  const signForm = page.getByTestId('facture-sign-form');
  await signForm.getByLabel('Nom du signataire').fill('Awa Traoré');
  const pad = page.getByTestId('facture-signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30, { steps: 8 });
  await page.mouse.up();
  await signForm.getByRole('button', { name: 'Valider la signature' }).click();
  await expect(view).toHaveAttribute('data-status', 'SIGNED');
  await expect(page.getByTestId('facture-signature')).toContainText('Awa Traoré');
  await expect(page.getByTestId('facture-signature')).toContainText(/[0-9a-f]{64}/);

  const report = await page.request.get(
    (await page.getByTestId('facture-intervention-report').getAttribute('href'))!,
  );
  expect(report.status()).toBe(200);
  expect((await report.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Facturation : main-d'œuvre à l'heure + pièce ; 1,5 × 10 000 + 25 000 = 40 000 HT, 47 200 TTC.
  await page.getByLabel('Main-d’œuvre facturée à l’heure').selectOption({ index: 1 });
  await page.getByTestId('facture-intervention-create-invoice').click();
  const editor = page.getByTestId('facture-document-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('facture-total-ttc')).toHaveText(/47\s200\sFCFA/);
  await expect(editor.getByLabel('Client', { exact: true })).toBeDisabled();
  await page.getByRole('link', { name: /intervention INT-\d{4}-\d{5}/ }).click();
  await expect(view).toHaveAttribute('data-status', 'INVOICED');
  await expect(page.getByTestId('facture-intervention-invoice')).toContainText('Brouillon');
});
