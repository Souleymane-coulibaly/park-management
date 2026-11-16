import { type Page, expect, test } from '@playwright/test';
import { startFactureTrial } from './facture-support';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite étape 5 — tableau de bord de l'organisation, parcours navigateur : accès depuis le portail,
 * un bloc par application, filtre par établissement et « Non rattaché », lien vers le rapport détaillé
 * de l'application (même période, même établissement), lisible sur téléphone (mesure par bloc).
 * Données fictives, bases de test locales jetables.
 */
test.skip(
  !process.env.TEST_FACTURE_DATABASE_URL || !process.env.TEST_STOCK_DATABASE_URL,
  'Bases Facture et Stock de test absentes.',
);

async function call(page: Page, method: 'post' | 'put', path: string, data: unknown) {
  const res = await page.request[method](`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Aucun bloc ne déborde de sa colonne (la largeur du document ne voit pas ce débordement). */
async function noBlockOverflow(page: Page) {
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="org-block-"]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.dataset.testid),
  );
  expect(overflowing).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

test('Ocall Suite : tableau de bord de l’organisation, par établissement et sur téléphone', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('suite-s5');
  await signupOrganization(page, { metier: 'Parc + Restaurant', orgName: 'Groupe Kayes', email });
  await startFactureTrial(email);
  await startStockTrial(email);

  const kayes = await call(page, 'post', '/establishments', {
    name: 'Agence Kayes',
    businessType: 'NONE',
    city: 'Kayes',
  });
  await call(page, 'put', '/facture/settings', {
    legalName: 'Groupe Kayes SARL',
    tradeName: 'Groupe Kayes',
    address: 'Avenue du Fleuve',
    city: 'Bamako',
    phone: '+223 70 00 00 03',
    email: `contact.${Date.now()}@test.ocallpark.local`,
    nif: '084123456A',
    defaultVatRate: 18,
    paymentTermsDays: 30,
    quoteValidityDays: 15,
  });
  const client = await call(page, 'post', '/facture/clients', {
    kind: 'COMPANY',
    name: 'Clinique Lumière',
  });
  const draft = await call(page, 'post', '/facture/documents', {
    type: 'INVOICE',
    clientId: client.id,
    establishmentId: kayes.id,
    lines: [{ label: 'Maintenance', unit: 'unité', quantity: 1, unitPrice: 10_000, vatRate: 18 }],
  });
  await call(page, 'post', `/facture/documents/${draft.id}/issue`, {});
  await call(page, 'post', '/ocall-stock/sites', {
    code: 'KAY',
    name: 'Boutique Kayes',
    kind: 'STORE',
    establishmentId: kayes.id,
  });

  // Portail → tableau de bord de l'organisation.
  await page.goto('/suite');
  await page.getByTestId('suite-dashboard-link').click();
  await expect(page).toHaveURL(/\/suite\/tableau-de-bord$/);
  const dashboard = page.getByTestId('org-dashboard');
  await expect(dashboard.getByTestId('org-block-OCALL_FACTURE')).toBeVisible();
  await expect(dashboard.getByTestId('org-block-OCALL_STOCK')).toBeVisible();
  await expect(dashboard.getByTestId('org-block-OCALL_PARK_RESTAURANT')).toBeVisible();
  const invoiced = dashboard.getByTestId('org-metric-OCALL_FACTURE-invoiced');
  await expect(invoiced).toContainText('11 800');
  // Aucun total entre applications.
  await expect(dashboard.getByText(/total général/i)).toHaveCount(0);

  // Un établissement, puis « Non rattaché ».
  const filters = page.getByTestId('org-dashboard-filters');
  await filters.getByLabel('Établissement').selectOption({ label: 'Agence Kayes — Kayes' });
  await expect(invoiced).toContainText('11 800');
  await expect(dashboard.getByTestId('org-site-table')).toContainText('Agence Kayes');
  await filters.getByLabel('Établissement').selectOption({ label: 'Non rattaché' });
  await expect(invoiced).toContainText(/^0/);

  // Téléphone : chaque bloc tient dans sa colonne, le tableau défile dans son cadre.
  await filters.getByLabel('Établissement').selectOption({ label: 'Agence Kayes — Kayes' });
  await expect(invoiced).toContainText('11 800');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dashboard.getByTestId('org-block-OCALL_FACTURE')).toBeVisible();
  await noBlockOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Rapport détaillé Facture : même période, même établissement.
  await dashboard
    .getByTestId('org-block-OCALL_FACTURE')
    .getByRole('link', { name: 'Détail' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/facture\\?.*establishmentId=${kayes.id}`));
  const facture = page.getByTestId('facture-dashboard-filters');
  await expect(facture.getByLabel('Établissement émetteur')).toHaveValue(kayes.id);
  await expect(facture.getByLabel('Période')).toHaveValue('custom');
  await expect(page.getByTestId('facture-kpi-invoiced')).toContainText('10 000');

  // Rapport détaillé Restaurant : lien sans établissement (lieu sans restaurant), période reprise.
  await page.goto('/suite/tableau-de-bord');
  await page
    .getByTestId('org-dashboard-filters')
    .getByLabel('Période')
    .selectOption({ label: '7 derniers jours' });
  await page
    .getByTestId('org-block-OCALL_PARK_RESTAURANT')
    .getByRole('link', { name: 'Détail' })
    .click();
  await expect(page).toHaveURL(/\/app\/analytics\/restaurant\?period=custom/);
  await expect(page.getByTestId('analytics-filters').getByLabel('Période')).toHaveValue('custom');
});
