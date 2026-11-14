import { type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite — Sprint 2, étape A, parcours navigateur : un employé Park existant est ajouté à l'équipe
 * Ocall Stock sans nouveau compte (aucun mot de passe affiché), puis reçoit un rôle propre à une boutique,
 * conservé après rechargement. Lisible sur téléphone. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test('Ocall Suite S2A : employé Park ajouté à Stock, rôle propre à une boutique', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('suite-s2a');
  await signupOrganization(page, { metier: 'Parc', orgName: 'Parc Djoliba', email });
  await startStockTrial(email);

  const establishments = await (await page.request.get('/api/v1/establishments')).json();
  const employee = await post<{ employee: { loginId: string } }>(page, '/employees', {
    firstName: 'Awa',
    lastName: 'Diarra',
    role: 'CASHIER',
    establishmentIds: [establishments[0].id],
  });
  for (const [code, name] of [
    ['BKO', 'Boutique Bamako'],
    ['SEG', 'Boutique Ségou'],
  ]) {
    await post(page, '/ocall-stock/sites', {
      code,
      name,
      kind: 'STORE',
      address: `Rue ${code}`,
      city: 'Bamako',
    });
  }

  // Ajout de l'employé Park à l'équipe Stock : pas de nouveau compte, pas de mot de passe.
  await page.goto('/stock/equipe');
  const existing = page.getByTestId('stock-member-existing');
  await existing
    .getByLabel('Personne')
    .selectOption({ label: `Awa Diarra · ${employee.employee.loginId}` });
  await existing.getByLabel('Rôle Stock').selectOption({ label: 'Responsable de magasin' });
  await existing.getByRole('button', { name: 'Ajouter à l’équipe' }).click();
  const list = page.getByTestId('stock-member-list');
  await expect(list).toContainText('Awa Diarra');
  await expect(list).toContainText(employee.employee.loginId);
  await expect(page.getByText('mot de passe temporaire')).toHaveCount(0);
  await expect(page.getByTestId('stock-member-existing-empty')).toBeVisible();

  // Rôle propre à Ségou : caissière (restreint son rôle de responsable).
  const row = list.locator('tr').filter({ hasText: 'Awa Diarra' });
  await row.getByRole('button', { name: /^Sites/ }).click();
  const sites = page.getByTestId('stock-member-sites');
  for (const code of ['BKO', 'SEG']) {
    await sites.locator(`[data-site="${code}"]`).getByRole('checkbox').check();
  }
  await sites.getByLabel('Rôle à Boutique Ségou').selectOption({ label: 'Caissier' });
  await expect(sites.getByLabel('Rôle à Boutique Bamako')).toHaveValue('');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(row.getByRole('button', { name: 'Sites (2)' })).toBeVisible();

  // Rechargé : rôle de Ségou conservé, Bamako au rôle principal.
  await page.reload();
  await page
    .getByTestId('stock-member-list')
    .locator('tr')
    .filter({ hasText: 'Awa Diarra' })
    .getByRole('button', { name: 'Sites (2)' })
    .click();
  const reloaded = page.getByTestId('stock-member-sites');
  await expect(reloaded.getByLabel('Rôle à Boutique Ségou')).toHaveValue('CASHIER');
  await expect(reloaded.getByLabel('Rôle à Boutique Bamako')).toHaveValue('');

  // Téléphone : l'éditeur des boutiques reste dans l'écran.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const box of await Promise.all(
    (await page.getByTestId('stock-member-site').all()).map((l) => l.boundingBox()),
  )) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
