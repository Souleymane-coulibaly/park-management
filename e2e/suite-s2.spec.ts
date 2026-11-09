import { expect, test } from '@playwright/test';
import {
  apiCaller,
  chooseSchool,
  expectNoOverflow,
  loginTo,
  requireSchool,
  seedSchool,
  seedSchoolClient,
  seeder,
} from './school-support';
import { activateParkSubscription, superAdminPage } from './suite-support';

/**
 * Sprint S2 — parcours navigateur : portail Ocall Suite (synthèse, contrat, renouvellement au tarif
 * contractuel, centre de notifications), crédits SMS School (demande de recharge, validation par le
 * Super Admin sous double authentification, solde), isolation entre organisations. Données fictives,
 * bases de test, fournisseur SMS simulé.
 */
requireSchool();

test('portail Suite : synthèse, notifications, contrat et demande de renouvellement', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const client = await seedSchoolClient(request, 's2portail');
  await loginTo(page, client.email);

  // 1. Connexion : synthèse et organisation active.
  await expect(page.getByTestId('suite-summary')).toBeVisible();
  await expect(page.getByTestId('suite-organization')).toContainText('s2portail');
  await expect(page.getByTestId('suite-app-OCALL_SCHOOL')).toBeVisible();

  // 4. Notifications : essai Park démarré à l'inscription, badge non lu, tout marquer comme lu.
  await expect(page.getByTestId('suite-unread-badge')).toBeVisible();
  await page.getByTestId('suite-bell').click();
  await expect(page).toHaveURL(/\/suite\/notifications$/);
  await expect(page.getByTestId('suite-notifications')).toContainText(
    'Essai de Ocall Park démarré',
  );
  await page.getByRole('button', { name: 'Tout marquer comme lu' }).click();
  await expect(page.getByTestId('suite-unread-count')).toHaveText('Tout est lu.');
  await expect(page.getByTestId('suite-unread-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Non lues' }).click();
  await expect(page.getByText('Aucune notification non lue')).toBeVisible();

  // 2. Abonnement payant (tarif contractuel 45 000) : échéance, jours restants, contrat.
  await activateParkSubscription(client.organizationId, 45_000, 5);
  await page.goto('/suite');
  const park = page.getByTestId('suite-app-OCALL_PARK');
  await expect(park.getByTestId('suite-days-remaining')).toHaveText('5 jours');
  await expect(park).toContainText(/45\s000/);
  await expect(page.getByTestId('suite-next-due')).toContainText('Ocall Park');
  await park.getByRole('button', { name: 'Contrat' }).click();
  await expect(park.getByTestId('suite-contract')).toContainText(/45\s000/);

  // 3. Renouvellement : offre en cours au tarif contractuel conservé ; demande en attente affichée.
  await park.getByRole('button', { name: 'Demander le renouvellement' }).click();
  await expect(park.getByTestId('renewal-quote')).toContainText(/45\s000/);
  await park.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(park.getByRole('status')).toContainText('Demande de renouvellement envoyée');
  await expect(park.getByTestId('suite-pending-request')).toContainText('Renouvellement demandé');
  await expect(park.getByRole('button', { name: 'Demander le renouvellement' })).toHaveCount(0);

  // Mobile : aucune colonne ne déborde (portail et centre de notifications).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('suite-summary')).toBeVisible();
  await expectNoOverflow(page);
  await page.goto('/suite/notifications');
  await expect(page.getByTestId('suite-notifications')).toContainText(
    'Demande de renouvellement enregistrée',
  );
  await expectNoOverflow(page);
});

test('crédits SMS School : demande de recharge, validation Super Admin, solde ; isolation', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(240_000);
  const client = await seedSchoolClient(request, 's2sms');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École S2 SMS' }, []);
  await chooseSchool(page, school.id);

  // 5. Demande de recharge : aucun crédit avant la validation d'Ocall.
  await page.goto('/school/communication');
  const wallet = page.getByTestId('sms-wallet');
  await expect(wallet.getByTestId('sms-balance')).toHaveText('0');
  await wallet.getByLabel('Nombre de crédits').fill('500');
  await wallet.getByRole('button', { name: 'Demander une recharge' }).click();
  await expect(wallet.getByTestId('sms-topup-pending')).toContainText('500 crédits');
  await expect(wallet.getByTestId('sms-balance')).toHaveText('0');

  // 6. Super Admin (double authentification) : validation après vérification du règlement.
  const admin = await superAdminPage(browser, 's2billing');
  await admin.goto('/admin/sms');
  const row = admin.getByRole('row').filter({ hasText: 'École S2 SMS' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByLabel('Référence du règlement vérifié').fill('VIR-E2E-0001');
  await row.getByRole('button', { name: 'Valider et créditer' }).click();
  await expect(admin.getByRole('row').filter({ hasText: 'École S2 SMS' })).toContainText('500');
  await admin.context().close();

  // 7. Solde crédité, demande validée, établissement prévenu.
  await page.reload();
  await expect(wallet.getByTestId('sms-balance')).toHaveText('500');
  await expect(wallet.getByTestId('sms-topup-pending')).toHaveCount(0);
  await page.goto('/suite/notifications');
  await expect(page.getByTestId('suite-notifications')).toContainText('Recharge SMS validée');

  // 8. Isolation : un autre client ne voit ni le portefeuille ni l'administration.
  const other = await seedSchoolClient(request, 's2autre');
  const otherPage = await (await browser.newContext()).newPage();
  await loginTo(otherPage, other.email);
  const otherCall = apiCaller(otherPage);
  expect((await otherCall(`/school/sms/wallet?schoolId=${school.id}`)).status).toBe(404);
  expect((await otherCall('/platform/school-sms/top-ups')).status).toBe(403);
  await otherPage.goto('/admin/sms');
  await expect(otherPage).not.toHaveURL(/\/admin\/sms$/);
  await otherPage.context().close();
});
