import { devices, expect, test } from '@playwright/test';
import {
  apiCaller,
  expectNoOverflow,
  loginTo,
  requireSchool,
  seedSchoolClient,
} from './school-support';

/**
 * Ocall School — accès sur contrat et structure de l'établissement (Sprint 1), sur téléphone.
 * Données fictives, base School de test uniquement.
 */
requireSchool();
test.use({ ...devices['Pixel 7'] });

test('client sur contrat : portail, établissement bilingue, année, matière et équipe', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'structure');

  await loginTo(page, client.email);
  await page.getByTestId('suite-apps').getByText('Ocall School').click();
  await expect(page).toHaveURL(/\/school$/, { timeout: 30_000 });
  // Client sans activité Park : l'espace Park le renvoie au portail.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/suite$/, { timeout: 30_000 });

  await page.goto('/school/etablissements');
  const form = page.getByTestId('school-form');
  await form.getByLabel('Nom officiel').fill('Medersa Annour');
  await expect(form.getByLabel('Nom en arabe')).toHaveCount(0); // français par défaut
  await form.getByLabel('Langue de l’établissement').selectOption('BILINGUAL');
  const ar = form.getByLabel('Nom en arabe');
  await ar.fill('مدرسة النور');
  await expect(ar).toHaveAttribute('dir', 'rtl');
  await form.getByLabel('Type').selectOption('FRANCO_ARABIC');
  await form.getByRole('button', { name: 'Créer l’établissement' }).click();
  const name = page.getByTestId('school-list').getByTestId('arabic-name');
  await expect(name).toHaveText('مدرسة النور', { timeout: 30_000 });
  expect(await name.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');

  await page.goto('/school/annees');
  const yf = page.getByTestId('year-form');
  await yf.getByLabel('Libellé (ex. 2026-2027)').fill('2026-2027');
  await yf.getByLabel('Début').fill('2026-10-01');
  await yf.getByLabel('Fin').fill('2027-06-30');
  await yf.getByRole('button', { name: 'Créer l’année' }).click();
  await page.getByRole('button', { name: 'Ouvrir l’année' }).click();
  await expect(page.getByText('En cours')).toBeVisible({ timeout: 30_000 });

  await page.goto('/school/matieres');
  const sf = page.getByTestId('subject-form');
  await sf.getByRole('textbox', { name: /^Nom(?! en)/ }).fill('Coran');
  await sf.getByLabel('Nom en arabe').fill('القرآن');
  await sf.getByLabel('Matière religieuse').check();
  await sf.getByRole('button', { name: 'Ajouter la matière' }).click();
  await expect(page.getByTestId('subject-list').getByText('Religieuse')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/school/equipe');
  const mf = page.getByTestId('member-form');
  await mf.getByLabel('Prénom').fill('Fanta');
  await mf.getByRole('textbox', { name: /^Nom/ }).fill('Prof');
  await mf.getByLabel('Rôle').selectOption('TEACHER');
  await mf.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.getByTestId('member-created')).toBeVisible({ timeout: 15_000 });

  await page.goto('/school');
  await expect(page.getByTestId('school-cards')).toBeVisible({ timeout: 30_000 });
  await expectNoOverflow(page);
  expect(errors).toEqual([]);
});

test('contrat suspendu : consultation seule, aucun formulaire d’écriture', async ({
  page,
  request,
}) => {
  const client = await seedSchoolClient(request, 'suspendu', 'SUSPENDED');
  await loginTo(page, client.email);
  await expect(page.getByText('Consultation seule')).toBeVisible({ timeout: 30_000 });
  await page.goto('/school');
  await expect(page.getByTestId('school-read-only')).toBeVisible({ timeout: 30_000 });
  await page.goto('/school/etablissements');
  await expect(page.getByTestId('school-list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('school-form')).toHaveCount(0);
  // L'API refuse aussi l'écriture : le masquage du formulaire n'est pas la seule protection.
  const write = await apiCaller(page)('/school/schools', 'POST', {
    name: 'Interdite',
    type: 'FRANCO_ARABIC',
    countryCode: 'SN',
  });
  expect(write.status).toBe(403);
  expect(write.body.code).toBe('CONTRACT_READ_ONLY');
});

test('site public : aucun tarif Ocall School', async ({ page }) => {
  await page.goto('/tarifs');
  await expect(page.locator('main')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/school/i);
});
