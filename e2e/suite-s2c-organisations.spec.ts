import { type Browser, type Page, expect, test } from '@playwright/test';
import { E2E_SUFFIX, PASSWORD, signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Suite — Sprint 2, étape C, parcours navigateur : un administrateur de l'organisation A est invité
 * par l'organisation B ; il accepte depuis son portail, passe dans B (rôle caissier), puis revient dans A
 * par le sélecteur d'organisation. Lisible sur téléphone. Données fictives, bases de test locales.
 */
async function freshPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function post<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} : ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json().catch(() => null)) as T;
}

test('Ocall Suite S2C : invitation acceptée, passage d’une organisation à l’autre', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // Organisation A et son administrateur (employé Park).
  const ownerA = await freshPage(browser);
  await signupOrganization(ownerA, {
    metier: 'Parc',
    orgName: 'Parc Alpha',
    email: uniqueEmail('s2c-a'),
  });
  const [siteA] = (await (await ownerA.request.get('/api/v1/establishments')).json()) as {
    id: string;
  }[];
  const employee = await post<{ employee: { loginId: string }; temporaryPassword: string }>(
    ownerA,
    '/employees',
    { firstName: 'Moussa', lastName: 'Diallo', role: 'ADMIN', establishmentIds: [siteA!.id] },
  );

  // Organisation B : invitation par l'identifiant, rôle caissier dans son établissement.
  const ownerB = await freshPage(browser);
  await signupOrganization(ownerB, {
    metier: 'Parc',
    orgName: 'Parc Beta',
    email: uniqueEmail('s2c-b'),
  });
  await ownerB.goto('/suite');
  await ownerB.getByTestId('suite-invite-link').click();
  const form = ownerB.getByTestId('suite-invitation-form');
  await form.getByLabel('E-mail ou identifiant de la personne').fill(employee.employee.loginId);
  await form.getByLabel('Rôle dans votre organisation').selectOption({ label: 'Caissier' });
  await form.getByTestId('suite-invitation-establishments').getByRole('checkbox').first().check();
  await form.getByRole('button', { name: 'Inviter' }).click();
  await expect(form.getByText('Invitation enregistrée')).toBeVisible();
  await expect(ownerB.getByTestId('suite-invitation-list')).toContainText('En attente');

  // L'administrateur de A : invitation visible dans son portail, acceptée, passage dans B.
  const person = await freshPage(browser);
  await post(person, '/auth/login', {
    identifier: employee.employee.loginId,
    password: employee.temporaryPassword,
  });
  const changed = await person.request.post('/api/v1/auth/change-password', {
    data: { currentPassword: employee.temporaryPassword, newPassword: PASSWORD },
  });
  expect(changed.status()).toBe(204);
  await person.goto('/suite');
  await expect(person.getByTestId('suite-organization')).toContainText('Parc Alpha');
  const invitation = person.getByTestId('suite-invitation');
  await expect(invitation).toContainText(`Parc Beta ${E2E_SUFFIX}`);
  await invitation.getByRole('button', { name: 'Accepter' }).click();
  await person
    .getByTestId('suite-invitation-joined')
    .getByRole('button', { name: 'Passer à cette organisation' })
    .click();
  await expect(person.getByTestId('suite-organization')).toContainText('Parc Beta');

  // Sélecteur d'organisation : retour dans A.
  const switcher = person.getByTestId('organization-switcher').getByLabel('Organisation');
  await expect(switcher.locator('option')).toHaveCount(2);
  await switcher.selectOption({ label: `Parc Alpha ${E2E_SUFFIX}` });
  await expect(person.getByTestId('suite-organization')).toContainText('Parc Alpha');
  await expect(ownerB.getByTestId('suite-invitation-list')).toBeVisible();
  await ownerB.reload();
  await expect(ownerB.getByTestId('suite-invitation-list')).toContainText('Acceptée');

  // Téléphone : l'en-tête et le sélecteur restent dans l'écran.
  await person.setViewportSize({ width: 390, height: 844 });
  await person.reload();
  const box = await person.getByTestId('organization-switcher').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await person.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});
