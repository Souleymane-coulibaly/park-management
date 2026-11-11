import { expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * « Mes applications » sur téléphone : l'en-tête masque ce lien sous 1 024 px, le menu de l'espace le
 * reprend. Sans lui, un client Ocall Park qui a aussi Ocall Facture ne pouvait pas l'ouvrir sur mobile.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

test('mobile : de l’espace Park à Ocall Facture par le menu « Mes applications »', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('mobile-apps');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Mobile', email });
  await startFactureTrial(email);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  // L'en-tête ne l'affiche pas sur téléphone : seul le menu y mène.
  await expect(page.getByRole('link', { name: 'Mes applications' })).toBeHidden();
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('link', { name: 'Mes applications' })
    .click();
  await expect(page).toHaveURL(/\/suite$/);

  const tile = page.getByTestId('suite-app-OCALL_FACTURE');
  await tile.getByRole('link', { name: 'Ouvrir' }).click();
  await expect(page).toHaveURL(/\/facture$/);

  // Et retour au portail depuis Ocall Facture.
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await page
    .getByRole('dialog', { name: 'Menu' })
    .getByRole('link', { name: 'Mes applications' })
    .click();
  await expect(page).toHaveURL(/\/suite$/);

  // Grand écran : inchangé, le lien est dans l'en-tête.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Mes applications' })).toBeVisible();
});
