import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — module IA F6B, parcours navigateur (fournisseur IA simulé) : compétences des
 * techniciens, maintenance préventive (équipement jamais entretenu → suggestion prudente → planifiée par
 * le responsable), puis planification intelligente (seul le technicien compétent est proposé, affecté
 * après validation). Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

const isoDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test('Ocall Facture : maintenance préventive et planification intelligente', async ({ page }) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('facture-f6b');
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

  // Équipe : deux techniciens, une compétence détenue par un seul.
  await page.goto('/facture/equipe');
  const memberForm = page.getByTestId('facture-member-form');
  for (const [first, last] of [
    ['Moussa', 'Diarra'],
    ['Awa', 'Traoré'],
  ]) {
    await memberForm.getByLabel('Prénom').fill(first!);
    await memberForm.getByRole('textbox', { name: 'Nom', exact: true }).fill(last!);
    await memberForm.getByRole('button', { name: 'Créer le compte' }).click();
    await expect(page.getByTestId('facture-member-list')).toContainText(last!);
  }
  await page.reload();
  const skills = page.getByTestId('facture-skills');
  await skills.getByLabel('Nouvelle compétence').fill('Climatisation');
  await skills.getByRole('button', { name: 'Ajouter' }).click();
  await expect(skills).toContainText('Climatisation');
  const moussa = page.getByLabel('Climatisation — Moussa Diarra');
  await moussa.check();
  await expect(moussa).toBeChecked();

  await page.goto('/facture/clients');
  const clientForm = page.getByTestId('facture-client-form');
  await clientForm.getByLabel('Raison sociale ou nom').fill('Hôtel du Fleuve');
  await clientForm.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByTestId('facture-client-list')).toContainText('Hôtel du Fleuve');

  // Équipement en service depuis deux ans, jamais entretenu : suggestion prudente.
  await page.goto('/facture/equipements');
  const equipmentForm = page.getByTestId('facture-equipment-form');
  await equipmentForm.getByLabel('Désignation').fill('Climatiseur salle de réunion');
  await equipmentForm.getByLabel('Mise en service').fill(isoDay(-730));
  await equipmentForm.getByLabel('Entretien conseillé tous les (mois)').fill('6');
  await equipmentForm.getByRole('button', { name: 'Ajouter l’équipement' }).click();
  await expect(page.getByTestId('facture-equipment-list')).toContainText(
    'Climatiseur salle de réunion',
  );
  await page.getByTestId('facture-ai-maintenance-analyze').click();
  const suggestions = page.getByTestId('facture-ai-maintenance');
  await expect(suggestions).toContainText('Climatiseur salle de réunion');
  await expect(suggestions).toContainText('recommandée');
  await suggestions.getByRole('link', { name: 'Planifier' }).first().click();

  // Planification de l'entretien suggéré : compétence requise, sans technicien.
  await expect(page.getByTestId('facture-maintenance-prefill')).toBeVisible();
  const planForm = page.getByTestId('facture-new-intervention');
  await expect(planForm.getByLabel('Objet de la demande')).toHaveValue(/Entretien préventif/);
  await planForm.getByLabel('Date').fill(isoDay(2));
  await planForm.getByLabel('Climatisation').check();
  await planForm.getByRole('button', { name: 'Planifier' }).click();
  const view = page.getByTestId('facture-intervention');
  await expect(view).toHaveAttribute('data-status', 'PLANNED');
  await expect(view).toContainText('Aucun');

  // Planification intelligente : seul le technicien compétent est proposé ; affecté sur décision.
  await page.getByTestId('facture-ai-planning-suggest').click();
  const candidates = page.getByTestId('facture-ai-planning-candidates');
  await expect(candidates).toContainText('Moussa Diarra');
  await expect(candidates).not.toContainText('Awa Traoré');
  await expect(candidates).toContainText('Compétences 1/1');
  await candidates.getByRole('button', { name: 'Affecter' }).first().click();
  await expect(view).toContainText('Moussa Diarra');
});
