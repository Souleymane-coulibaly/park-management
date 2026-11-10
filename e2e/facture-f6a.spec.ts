import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — module IA F6A, parcours navigateur (fournisseur IA simulé, aucun appel payant) :
 * assistant IA activé par le gérant ; rapport proposé depuis les observations, corrigé puis validé en
 * terminant les travaux ; devis proposé depuis une demande, avec les prix du catalogue, puis brouillon
 * créé sur décision (jamais émis). Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

test('Ocall Facture : rapport et devis intelligents, validés par une personne', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('facture-f6a');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Services', email });
  await startFactureTrial(email);

  await page.goto('/facture/parametres');
  await page
    .getByTestId('facture-settings-form')
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();
  const ai = page.getByTestId('facture-ai-settings');
  await ai.getByTestId('facture-ai-enabled').check();
  await ai.getByRole('button', { name: 'Enregistrer l’assistant IA' }).click();
  await expect(ai.getByText('Réglages IA enregistrés.')).toBeVisible();

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
  await itemForm.getByLabel('Désignation').fill('Recharge gaz climatiseur');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('35000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Recharge gaz climatiseur');
  await itemForm.getByLabel('Type').selectOption({ label: 'Article ou pièce' });
  await itemForm.getByLabel('Désignation').fill('Filtre à air');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('25000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Filtre à air');

  // Rapport intelligent : intervention en cours, observations, proposition corrigée puis validée.
  await page.goto('/facture/interventions');
  const planForm = page.getByTestId('facture-new-intervention');
  await planForm.getByLabel('Client').selectOption({ label: 'Hôtel du Fleuve' });
  await planForm.getByLabel('Objet de la demande').fill('Climatiseur en panne');
  await planForm.getByLabel('Moussa Diarra (Technicien)').check();
  await planForm.getByRole('button', { name: 'Planifier' }).click();
  const view = page.getByTestId('facture-intervention');
  await expect(view).toHaveAttribute('data-status', 'PLANNED');
  await page.getByTestId('facture-intervention-start').click();
  await expect(view).toHaveAttribute('data-status', 'IN_PROGRESS');
  const timeForm = page.getByTestId('facture-time-form');
  await timeForm.getByLabel('Heures').fill('1');
  await timeForm.getByLabel('Minutes').fill('30');
  await timeForm.getByRole('button', { name: 'Ajouter le temps' }).click();
  await expect(page.getByTestId('facture-time-entries')).toContainText('1 h 30');

  const assistant = page.getByTestId('facture-ai-report');
  await assistant
    .getByLabel('Vos observations (ou dictez-les)')
    .fill('Filtre encrassé, débit d’air faible.');
  await page.getByTestId('facture-ai-report-generate').click();
  await expect(page.getByTestId('facture-ai-report-proposed')).toBeVisible();
  const complete = page.getByTestId('facture-complete-form');
  const summary = complete.getByLabel('Travaux réalisés');
  await expect(summary).toHaveValue(/Filtre encrassé/);
  await expect(summary).toHaveValue(/Temps passé : 1 h 30/);
  await summary.fill(`${await summary.inputValue()}\nFiltre nettoyé et remis en place.`);
  await complete.getByRole('button', { name: 'Terminer les travaux' }).click();
  await expect(view).toHaveAttribute('data-status', 'COMPLETED');

  // Devis intelligent : lignes du catalogue à ses prix, brouillon créé sur décision.
  await page.goto('/facture/documents');
  const quote = page.getByTestId('facture-ai-quote');
  await quote.getByLabel('Client du devis').selectOption({ label: 'Hôtel du Fleuve' });
  await quote
    .getByLabel('Demande du client')
    .fill('Le climatiseur ne refroidit plus : prévoir une recharge et un filtre.');
  await quote.getByRole('button', { name: 'Proposer un devis' }).click();
  const proposal = page.getByTestId('facture-ai-quote-proposal');
  await expect(proposal).toContainText('Recharge gaz climatiseur');
  await expect(proposal).toContainText('Filtre à air');
  await expect(proposal).toContainText(/70\s800\sFCFA TTC/);
  await expect(page.getByTestId('facture-ai-quote-missing')).toContainText('Quantités à confirmer');
  await page.getByTestId('facture-ai-quote-apply').click();
  const editor = page.getByTestId('facture-document-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('facture-total-ttc')).toHaveText(/70\s800\sFCFA/);
  await expect(page.getByTestId('facture-document-number')).toContainText('brouillon');
});
