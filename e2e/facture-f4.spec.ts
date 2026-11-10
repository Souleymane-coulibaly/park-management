import { type Page, expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — notifications de rendez-vous F4, parcours navigateur : notifications activées,
 * client consentant à WhatsApp, rendez-vous confirmé (envoyé par le répartiteur, fournisseur simulé),
 * reporté (rappels remplacés), annulé. Données fictives, bases de test locales jetables, aucun message
 * réel.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

const isoDay = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Historique d'une notification, relu jusqu'à l'état attendu (le répartiteur passe toutes les 30 s). */
async function expectNotification(page: Page, kind: string, status: string) {
  await expect(async () => {
    await page.reload();
    await expect(
      page
        .locator(
          `[data-testid="facture-notifications"] li[data-kind="${kind}"][data-status="${status}"]`,
        )
        .first(),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
}

test('Ocall Facture : rendez-vous confirmé, reporté, annulé', async ({ page }) => {
  test.setTimeout(300_000);
  page.on('dialog', (dialog) => void dialog.accept('Client absent, à replanifier'));
  const email = uniqueEmail('facture-f4');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Services', email });
  await startFactureTrial(email);

  await page.goto('/facture/parametres');
  await page
    .getByTestId('facture-settings-form')
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();
  const notifSettings = page.getByTestId('facture-notification-settings');
  await notifSettings.getByTestId('facture-notifications-enabled').check();
  await notifSettings.getByRole('button', { name: 'Enregistrer les notifications' }).click();
  await expect(notifSettings.getByText('Réglages enregistrés.')).toBeVisible();

  await page.goto('/facture/equipe');
  const memberForm = page.getByTestId('facture-member-form');
  await memberForm.getByLabel('Prénom').fill('Moussa');
  await memberForm.getByRole('textbox', { name: 'Nom', exact: true }).fill('Diarra');
  await memberForm.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByTestId('facture-member-list')).toContainText('Diarra');

  await page.goto('/facture/clients');
  const clientForm = page.getByTestId('facture-client-form');
  await clientForm.getByLabel('Raison sociale ou nom').fill('Hôtel du Fleuve');
  await clientForm.getByLabel('Téléphone (+223 …)').fill('+223 70 11 22 33');
  await clientForm.getByLabel('Le client accepte de recevoir ses rendez-vous par WhatsApp').check();
  await clientForm.getByRole('button', { name: 'Créer le client' }).click();
  await expect(page.getByTestId('facture-client-list')).toContainText('Hôtel du Fleuve');

  // Rendez-vous dans trois jours : confirmation immédiate, deux rappels programmés.
  await page.goto('/facture/interventions');
  const planForm = page.getByTestId('facture-new-intervention');
  await planForm.getByLabel('Client').selectOption({ label: 'Hôtel du Fleuve' });
  await planForm.getByLabel('Objet de la demande').fill('Entretien climatiseur');
  await planForm.getByLabel('Date').fill(isoDay(3));
  await planForm.getByLabel('Moussa Diarra (Technicien)').check();
  await planForm.getByRole('button', { name: 'Planifier' }).click();
  await expect(page.getByTestId('facture-intervention')).toHaveAttribute('data-status', 'PLANNED');
  const history = page.getByTestId('facture-notifications');
  await expect(history.locator('li[data-kind="REMINDER"][data-status="PENDING"]')).toHaveCount(2);
  await expect(history).toContainText('WhatsApp');
  await expect(history).toContainText('2233');
  await expect(history).not.toContainText('70 11 22 33');
  await expectNotification(page, 'CONFIRMATION', 'SENT');

  // Report d'un jour : anciens rappels annulés, avis de report, nouveaux rappels.
  await page.getByLabel('Date').fill(isoDay(4));
  await page.getByRole('button', { name: 'Enregistrer le planning' }).click();
  await expect(history.locator('li[data-kind="REMINDER"][data-status="CANCELLED"]')).toHaveCount(2);
  await expect(history.locator('li[data-kind="REMINDER"][data-status="PENDING"]')).toHaveCount(2);
  await expect(history).toContainText('rendez-vous déplacé');
  await expectNotification(page, 'RESCHEDULED', 'SENT');

  // Annulation : rappels annulés, avis d'annulation envoyé.
  await page.getByRole('button', { name: 'Annuler l’intervention' }).click();
  await expect(page.getByTestId('facture-intervention')).toHaveAttribute(
    'data-status',
    'CANCELLED',
  );
  await expect(history.locator('li[data-kind="REMINDER"][data-status="PENDING"]')).toHaveCount(0);
  await expectNotification(page, 'CANCELLATION', 'SENT');
});
