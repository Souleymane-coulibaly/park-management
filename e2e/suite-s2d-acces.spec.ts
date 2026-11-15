import { type Browser, type Page, expect, test } from '@playwright/test';
import { startStockTrial } from './stock-support';
import { PASSWORD, signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite — Sprint 2, étape D, parcours navigateur : le portail ne présente à chacun que les
 * applications où il a un rôle (caissier Park : Park ; compte réservé à Stock : Stock) ; le propriétaire
 * désactive le compte réservé à Stock depuis la page Employés, ses sessions sont fermées. Lisible sur
 * téléphone. Données fictives, bases de test locales.
 */
test.skip(!process.env.TEST_STOCK_DATABASE_URL, 'Base Stock de test absente.');

async function post<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json().catch(() => null)) as T;
}

async function signIn(browser: Browser, loginId: string, temporaryPassword: string) {
  const page = await (await browser.newContext()).newPage();
  await post(page, '/auth/login', { identifier: loginId, password: temporaryPassword });
  const changed = await page.request.post('/api/v1/auth/change-password', {
    data: { currentPassword: temporaryPassword, newPassword: PASSWORD },
  });
  expect(changed.status()).toBe(204);
  return page;
}

test('Ocall Suite S2D : portail selon les rôles, désactivation d’un compte réservé à Stock', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await (await browser.newContext()).newPage();
  const email = uniqueEmail('s2d');
  await signupOrganization(owner, { metier: 'Parc', orgName: 'Parc Delta', email });
  await startStockTrial(email);
  const [site] = (await (await owner.request.get('/api/v1/establishments')).json()) as {
    id: string;
  }[];
  const cashier = await post<{ employee: { loginId: string }; temporaryPassword: string }>(
    owner,
    '/employees',
    { firstName: 'Awa', lastName: 'Caisse', role: 'CASHIER', establishmentIds: [site!.id] },
  );
  const stockOnly = await post<{ member: { loginId: string }; temporaryPassword: string }>(
    owner,
    '/ocall-stock/members',
    { firstName: 'Oumar', lastName: 'Magasin', role: 'SALES' },
  );

  // Propriétaire : Park et Stock ouverts.
  await owner.goto('/suite');
  const ownerApps = owner.getByTestId('suite-apps');
  await expect(ownerApps).toContainText('Ocall Park');
  await expect(ownerApps).toContainText('Ocall Stock');

  // Caissier Park : seulement Park, ni catalogue ni application sans rôle.
  const cashierPage = await signIn(browser, cashier.employee.loginId, cashier.temporaryPassword);
  await cashierPage.goto('/suite');
  await expect(cashierPage.getByTestId('suite-apps')).toContainText('Ocall Park');
  await expect(cashierPage.getByTestId('suite-apps')).not.toContainText('Ocall Stock');
  await expect(cashierPage.getByTestId('suite-catalog')).toHaveCount(0);

  // Compte réservé à Stock : seulement Stock.
  const stockPage = await signIn(browser, stockOnly.member.loginId, stockOnly.temporaryPassword);
  await stockPage.goto('/suite');
  await expect(stockPage.getByTestId('suite-apps')).toContainText('Ocall Stock');
  await expect(stockPage.getByTestId('suite-apps')).not.toContainText('Ocall Park');

  // Propriétaire : désactivation depuis la page Employés.
  await owner.goto('/app/employes');
  const row = owner.getByRole('row').filter({ hasText: stockOnly.member.loginId });
  await expect(row).toContainText('Actif');
  owner.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Désactiver Oumar Magasin' }).click();
  await expect(row).toContainText('Désactivé');
  await expect(row.getByRole('button', { name: 'Réactiver Oumar Magasin' })).toBeVisible();

  // Sessions du compte fermées ; nouvelle connexion refusée.
  expect((await stockPage.request.get('/api/v1/auth/me')).status()).toBe(401);
  const again = await stockPage.request.post('/api/v1/auth/login', {
    data: { identifier: stockOnly.member.loginId, password: PASSWORD },
  });
  expect(again.ok()).toBeFalsy();

  // Téléphone : le portail du caissier reste dans l'écran.
  await cashierPage.setViewportSize({ width: 390, height: 844 });
  await cashierPage.reload();
  await expect(cashierPage.getByTestId('suite-apps')).toBeVisible();
  expect(
    await cashierPage.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
