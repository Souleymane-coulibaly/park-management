import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiCaller, seeder } from './school-support';
import { E2E_SUFFIX, PASSWORD, signupOrganization, uniqueEmail } from './support';
import { loginWithMfa, superAdminPage, withTestDb } from './suite-support';

/**
 * Sprint S3 — Ocall Partner, parcours navigateur de bout en bout : candidature publique, validation
 * Super Admin, invitation et création du compte, connexion (double authentification), prospect,
 * attribution d'un client (lien parrainé), souscription préparée, paiement confirmé par Ocall (quatre
 * yeux), prime calculée, demande de règlement, règlement validé, refus d'accès d'un autre partenaire.
 * Données fictives, base de test.
 */
test('Ocall Partner : de la candidature au règlement de la prime', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const candidate = uniqueEmail('s3-revendeur');

  // 1. Dépôt de candidature publique (formulaire, anti-robot : délai minimal de remplissage).
  await page.goto('/devenir-partenaire');
  const form = page.getByTestId('partner-application-form');
  await form.getByText('Revendeur agréé', { exact: true }).click();
  await form.getByLabel('Prénom').fill('Aïssata');
  await form.getByRole('textbox', { name: 'Nom', exact: true }).fill('Revendeuse E2E');
  await form.getByLabel('Entreprise (facultatif)').fill(`Distrib ${E2E_SUFFIX}`);
  await form.getByLabel('E-mail').fill(candidate);
  await form.getByLabel('Ville').fill('Bamako');
  await form.getByLabel('Téléphone (avec indicatif)').fill('+223 70 12 34 56');
  await form
    .getByLabel('Expérience commerciale')
    .fill('Huit ans de vente de solutions aux écoles.');
  await form.getByLabel('Secteurs ou types de clients ciblés').fill('Écoles privées, parcs');
  await form
    .getByLabel('Motivation')
    .fill('Construire un réseau Ocall solide dans la région de Bamako.');
  await form.getByRole('checkbox').check();
  await page.waitForTimeout(3_500);
  await form.getByRole('button', { name: 'Envoyer ma candidature' }).click();
  await expect(page.getByTestId('partner-application-done')).toBeVisible();

  // 2. Validation par le Super Admin (approbation = agrément), lien d'invitation affiché une fois.
  const admin = await superAdminPage(browser, 's3admin', 'PLATFORM_ADMIN');
  await admin.goto('/admin/partenaires/candidatures');
  const row = admin
    .getByTestId('partner-application')
    .filter({ hasText: 'Revendeuse E2E' })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Approuver et inviter' }).click();
  const link = admin.getByTestId('invitation-link');
  await expect(link).toContainText('/activation-partenaire?token=');
  const path = (await link.innerText()).match(/\/activation-partenaire\?token=[A-Za-z0-9_-]+/)![0];

  // 3. Invitation : création du compte (usage unique).
  const partnerPage = await (await browser.newContext()).newPage();
  await partnerPage.goto(path);
  await partnerPage.getByLabel('Mot de passe').fill(PASSWORD);
  await partnerPage.getByLabel('Confirmation').fill(PASSWORD);
  await partnerPage.getByRole('button', { name: 'Créer mon espace partenaire' }).click();
  await expect(partnerPage.getByTestId('partner-activated')).toBeVisible();
  // Lien rejoué : refusé.
  await partnerPage.goto(path);
  await expect(partnerPage.getByText('Lien invalide ou expiré')).toBeVisible();

  // 4. Connexion du partenaire (double authentification obligatoire), portail revendeur.
  await loginWithMfa(partnerPage, candidate);
  await partnerPage.goto('/partenaire');
  await expect(partnerPage.getByText('Revendeur agréé', { exact: false }).first()).toBeVisible();
  await expect(partnerPage.getByTestId('partner-balance')).toBeVisible();
  const code = await withTestDb((db) =>
    db.partner.findFirstOrThrow({
      where: { user: { email: candidate } },
      select: { code: true, id: true },
    }),
  );

  // 5. Création d'un prospect (CRM).
  await partnerPage.goto('/partenaire/prospects');
  await partnerPage.getByRole('button', { name: 'Nouveau prospect' }).click();
  await partnerPage.getByLabel('Entreprise').fill(`École Horizon ${E2E_SUFFIX}`);
  await partnerPage.getByLabel('Contact').fill('Directeur Test');
  await partnerPage.getByLabel('Téléphone').fill('+223 65 43 21 09');
  await partnerPage.getByLabel('Secteur d’activité').fill('Enseignement');
  await partnerPage.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(partnerPage.getByText(`École Horizon ${E2E_SUFFIX}`)).toBeVisible();

  // 6. Attribution d'un client : inscription par le lien parrainé, confirmée par Ocall.
  // Parcours réel du lien affiché dans le portail (« Liens de recommandation »).
  const clientEmail = uniqueEmail('s3-client');
  const clientPage = await (await browser.newContext()).newPage();
  await clientPage.goto(`/inscription?ref=${code.code}`);
  await expect(clientPage.getByTestId('signup-ref')).toContainText(code.code);
  await signupOrganization(clientPage, {
    metier: 'Parc',
    orgName: 'Client parrainé',
    email: clientEmail,
    ref: code.code,
  });
  const organizationId = (
    await withTestDb((db) =>
      db.organization.findFirstOrThrow({
        where: { memberships: { some: { user: { email: clientEmail } } } },
        select: { id: true },
      }),
    )
  ).id;
  await admin.goto('/admin/partenaires/attributions');
  const attribution = admin
    .getByRole('row')
    .filter({ hasText: `Client parrainé ${E2E_SUFFIX}` })
    .first();
  await attribution.getByRole('button', { name: 'Confirmer' }).click();
  await expect(attribution).toContainText('Confirmée');

  // 7. Souscription : le revendeur prépare l'activation depuis « Mes clients ».
  await partnerPage.goto('/partenaire/clients');
  const client = partnerPage
    .getByTestId('partner-clients')
    .getByText(`Client parrainé ${E2E_SUFFIX}`);
  await expect(client).toBeVisible();
  await partnerPage.getByRole('button', { name: 'Demander l’activation' }).first().click();
  await expect(partnerPage.getByText('Demande d’activation transmise à Ocall.')).toBeVisible();

  // 8. Confirmation administrative du paiement (saisi par une personne, confirmé par une autre) et
  // 9. calcul de la prime selon une règle validée par le propriétaire.
  const owner = await superAdminPage(browser, 's3owner', 'PLATFORM_OWNER');
  const billing = await superAdminPage(browser, 's3billing', 'BILLING_MANAGER');
  const ownerApi = seeder(owner);
  const billingApi = seeder(billing);
  const rule = await ownerApi('/platform/commission-rules', 'POST', {
    name: `Revendeur ${E2E_SUFFIX}-${randomUUID().slice(0, 6)}`,
    setupRateBps: 1500,
    monthlyRateBps: 1000,
    monthlyWindowMonths: null,
    partnerType: 'RESELLER',
  });
  await ownerApi(`/platform/commission-rules/${rule.id}/activate`, 'POST');
  const sub = await withTestDb((db) =>
    db.subscription.findFirstOrThrow({ where: { organizationId }, select: { id: true } }),
  );
  const invoice = await billingApi('/platform/invoices', 'POST', {
    subscriptionId: sub.id,
    lines: [{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 1 }],
    idempotencyKey: randomUUID(),
  });
  const today = new Date().toISOString().slice(0, 10);
  const payment = await billingApi('/platform/subscription-payments', 'POST', {
    organizationId,
    invoiceId: invoice.id,
    amount: invoice.total,
    currency: 'XOF',
    method: 'MANUAL_TRANSFER',
    reference: `VIR-${randomUUID().slice(0, 8)}`,
    paidAt: today,
    periodStart: today,
    periodEnd: today,
  });
  await ownerApi(`/platform/subscription-payments/${payment.id}/confirm`, 'POST');
  const commissions = await withTestDb((db) =>
    db.commission.findMany({ where: { subscriptionPaymentId: payment.id } }),
  );
  expect(commissions.reduce((t, c) => t + c.amount, 0)).toBe(35_000); // 15 % de 200 000 + 10 % de 50 000
  await partnerPage.goto('/partenaire/commissions');
  await expect(partnerPage.getByTestId('balance-accrued')).toContainText('35');

  // 10. Demande de règlement : primes validées, date de règlement (fin du mois suivant) atteinte.
  await billingApi('/platform/commissions/validate', 'POST', { ids: commissions.map((c) => c.id) });
  await withTestDb((db) =>
    db.commission.updateMany({
      where: { id: { in: commissions.map((c) => c.id) } },
      data: { payableFrom: new Date(Date.now() - 86_400_000) },
    }),
  );
  await partnerPage.reload();
  await expect(partnerPage.getByTestId('balance-payable-main')).toContainText('35');
  await partnerPage.getByRole('button', { name: 'Demander le règlement' }).click();
  await expect(partnerPage.getByText('En attente')).toBeVisible();

  // 11. Validation du règlement : versement saisi puis confirmé par une autre personne.
  const payout = await billingApi('/platform/commission-payouts', 'POST', {
    partnerId: code.id,
    commissionIds: commissions.map((c) => c.id),
    method: 'Mobile money',
    reference: `OM-${randomUUID().slice(0, 6)}`,
    paidAt: today,
  });
  await ownerApi(`/platform/commission-payouts/${payout.id}/confirm`, 'POST');
  await admin.goto('/admin/partenaires/commissions');
  await admin.getByRole('button', { name: `Réglée par ${payout.number}` }).click();
  await partnerPage.reload();
  await expect(partnerPage.getByTestId('balance-paid')).toContainText('35');
  await expect(partnerPage.getByText('Réglée', { exact: true })).toBeVisible();

  // 12. Refus d'accès aux données d'un autre partenaire.
  const other = await seeder(admin)('/platform/partners', 'POST', {
    companyName: `Autre partenaire ${E2E_SUFFIX}`,
    firstName: 'Autre',
    lastName: 'Partenaire',
    email: uniqueEmail('s3-autre'),
    phone: '+223 76 00 00 01',
    country: 'Mali',
  });
  const otherPage = await (await browser.newContext()).newPage();
  await otherPage.goto('/connexion');
  const otherApi = apiCaller(otherPage);
  const otherLogin = await otherApi('/auth/login', 'POST', {
    identifier: other.partner.user.email,
    password: other.temporaryPassword,
  });
  expect(otherLogin.status).toBe(200);
  const prospect = await withTestDb((db) =>
    db.prospect.findFirstOrThrow({ where: { partnerId: code.id }, select: { id: true } }),
  );
  // Sans mot de passe changé ni double authentification : aucune donnée ; et jamais celles d'un autre.
  expect(
    (await otherApi(`/partner/prospects/${prospect.id}/history`)).status,
  ).toBeGreaterThanOrEqual(400);
  expect((await otherApi('/partner/clients')).status).toBeGreaterThanOrEqual(400);
  // Le revendeur lui-même ne valide ni prime ni règlement.
  const partnerApi = apiCaller(partnerPage);
  expect(
    (await partnerApi(`/platform/commission-payouts/${payout.id}/confirm`, 'POST')).status,
  ).toBe(403);
  expect((await partnerApi('/platform/partner-applications')).status).toBe(403);
});
