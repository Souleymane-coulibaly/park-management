import { expect, test } from '@playwright/test';
import { E2E_SUFFIX, signupOrganization, uniqueEmail } from './support';
import { withTestDb } from './suite-support';

/**
 * Ocall Facture — socle F0, parcours navigateur : essai ouvert, tuile au portail, identité légale du
 * vendeur (Mali : NIF, régime d'imposition, TVA par liste de 0 à 20 %), logo, aperçu PDF de l'en-tête,
 * équipe. Données fictives, bases de test locales jetables (Suite et Facture distinctes).
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

test('Ocall Facture : essai, identité légale, logo, aperçu PDF et équipe', async ({ page }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('facture-f0');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Services', email });
  // Essai ouvert par Ocall (le produit reste « à venir » au catalogue) : offre inactive dédiée.
  await withTestDb(async (db) => {
    const org = await db.organization.findFirstOrThrow({
      where: { memberships: { some: { user: { email } } } },
      select: { id: true },
    });
    const product = await db.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_FACTURE' } });
    const plan = await db.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `Facture E2E ${E2E_SUFFIX} ${Date.now()}`,
        monthlyPrice: 50_000,
        setupFee: 200_000,
        isActive: false,
      },
    });
    await db.productTrial.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * 86_400_000),
        startedByOcall: true,
      },
    });
    await db.subscription.create({
      data: { organizationId: org.id, productId: product.id, planId: plan.id, status: 'TRIALING' },
    });
  });

  // Portail : tuile Ocall Facture ouverte.
  await page.goto('/suite');
  const tile = page.getByTestId('suite-app-OCALL_FACTURE');
  await expect(tile).toBeVisible();
  await tile.getByRole('link', { name: 'Ouvrir' }).click();
  await expect(page).toHaveURL(/\/facture$/);
  await expect(page.getByTestId('facture-role')).toContainText('Propriétaire (gérant)');
  await expect(page.getByTestId('facture-legal-missing')).toContainText('NIF');

  // Identité légale : TVA par liste (18 % par défaut), mentions exigées au Mali.
  await page.goto('/facture/parametres');
  const form = page.getByTestId('facture-settings-form');
  const vat = form.getByLabel('TVA par défaut');
  await expect(vat).toHaveValue('18');
  await expect(vat.locator('option')).toHaveCount(21);
  await form.getByLabel('Adresse').fill('Rue 310, ACI 2000');
  await form.getByLabel('Ville').fill('Bamako');
  await form.getByLabel('Numéro d’identification fiscale (NIF)').fill('084123456A');
  await form.getByLabel('Régime d’imposition').fill('Régime du réel normal');
  await vat.selectOption('0');
  await form.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();
  await expect(vat).toHaveValue('0');

  // Logo puis aperçu PDF de l'en-tête.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    // PNG 1 × 1 valide.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByTestId('facture-logo')).toBeVisible();
  const pdf = await page.request.get('/api/v1/facture/settings/letterhead.pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await page.goto('/facture');
  await expect(page.getByTestId('facture-legal-ready')).toBeVisible();

  // Équipe : compte technicien réservé à Facture, mot de passe provisoire affiché une fois.
  await page.goto('/facture/equipe');
  const memberForm = page.getByTestId('facture-member-form');
  await memberForm.getByLabel('Prénom').fill('Moussa');
  await memberForm.getByRole('textbox', { name: 'Nom', exact: true }).fill('Technicien');
  await memberForm.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByTestId('facture-temporary-password')).not.toBeEmpty();
  await expect(page.getByTestId('facture-member-list')).toContainText('Technicien');
});
