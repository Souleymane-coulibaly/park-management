import { devices, expect, test } from '@playwright/test';
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

/**
 * Ocall School — portail parents (Sprint 6) : invitation, activation, appel et annonce de
 * l'établissement, absence vue et justifiée par le parent ; le compte parent n'atteint aucune route
 * du personnel. Le parent est sur téléphone.
 */
requireSchool();

const PARENT_PASSWORD = 'Parent2026Secure';

test('portail parents : activation, absence notifiée, justificatif accepté ; routes du personnel fermées', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`personnel : ${e.message}`));
  const client = await seedSchoolClient(request, 'parents');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École Portail', nameAr: 'مدرسة البوابة' }, []);
  const mother = await call('/school/guardians', 'POST', {
    schoolId: school.id,
    lastName: 'Ba',
    firstName: 'Aminata',
    phone: '+221 77 111 11 11',
  });
  const children: string[] = [];
  for (const [firstName, birthDate] of [
    ['Awa', '2016-03-14'],
    ['Fatou', '2018-05-02'],
  ]) {
    const st = await call('/school/students', 'POST', {
      schoolId: school.id,
      lastName: 'Ba',
      firstName,
      birthDate,
    });
    await call(`/school/students/${st.id}/guardians`, 'POST', {
      guardianId: mother.id,
      relation: 'MOTHER',
      canViewSchoolInfo: true,
    });
    const e = await call('/school/enrollments', 'POST', {
      studentId: st.id,
      schoolYearId: school.yearId,
      levelId: school.levelId,
      classId: school.classId,
      submit: true,
    });
    await call(`/school/enrollments/${e.id}/status`, 'POST', { status: 'VALIDATED' });
    children.push(st.id);
  }
  await chooseSchool(page, school.id);

  await page.goto('/school/portail-parents');
  await page.getByTestId('portal-guardians').getByText('Ba Aminata').click();
  await page.getByTestId('invite').click();
  const link = (await page.getByTestId('invitation-link').innerText()).trim();
  expect(link).toMatch(/\/parents\/activation\?token=/);

  const parentCtx = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
  const parent = await parentCtx.newPage();
  parent.on('pageerror', (e) => errors.push(`parent : ${e.message}`));
  await parent.goto(link);
  await expect(parent.getByText(/Bonjour Aminata, École Portail/)).toBeVisible({
    timeout: 30_000,
  });
  await parent.getByLabel('Choisissez un mot de passe').fill(PARENT_PASSWORD);
  await parent.getByLabel('Confirmez le mot de passe').fill(PARENT_PASSWORD);
  await parent.getByRole('button', { name: 'Activer mon accès' }).click();
  const done = parent.getByTestId('activation-done');
  await expect(done).toContainText(/[A-Z0-9]+-\d{4}/, { timeout: 20_000 });
  const loginId = /([A-Z0-9]+-\d{4})/.exec(await done.innerText())![1];

  await parent.goto('/connexion');
  await parent.getByLabel('E-mail ou identifiant').fill(loginId);
  await parent.getByLabel('Mot de passe').fill(PARENT_PASSWORD);
  await parent.getByRole('button', { name: 'Se connecter' }).click();
  await expect(parent).toHaveURL(/\/parents$/, { timeout: 30_000 });
  await expect(parent.getByTestId('parent-children').locator('h2')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expectNoOverflow(parent);
  // Le compte parent n'a aucun droit sur les routes du personnel.
  expect((await apiCaller(parent)('/school/students')).status).toBe(403);

  await page.goto('/school/presences');
  const firstRow = page.getByTestId('attendance-sheet').locator('li').first();
  await firstRow.getByRole('radio', { name: 'Absent' }).click();
  await page.getByTestId('attendance-save').click();
  await expect(page.getByText('Appel enregistré.')).toBeVisible({ timeout: 20_000 });
  await page.goto('/school/communication');
  await page.getByTestId('announcement-new').click();
  const editor = page.getByTestId('announcement-editor');
  await editor.getByLabel('Titre', { exact: true }).fill('Réunion des parents');
  await editor.getByLabel('Message', { exact: true }).fill('Jeudi à 17 h, salle polyvalente.');
  await page.getByTestId('announcement-publish').click();
  await expect(page.getByTestId('announcement-list').getByText('Réunion des parents')).toBeVisible({
    timeout: 20_000,
  });

  await parent.goto('/parents/notifications');
  const notes = parent.getByTestId('notifications');
  await expect(notes).toContainText(/Absence enregistrée/, { timeout: 30_000 });
  await expect(notes).toContainText('Nouvelle annonce : Réunion des parents');

  // L'élève noté absent est le premier de la feuille d'appel (ordre alphabétique : Awa).
  await parent.goto(`/parents/enfants/${children[0]}/presences`);
  const records = parent.getByTestId('attendance-records');
  await expect(records.getByText('Absent')).toHaveCount(1, { timeout: 30_000 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date());
  await parent.getByTestId('justify-form').getByLabel('Du').fill(today);
  await parent.getByTestId('justify-form').getByLabel('Motif').fill('Rendez-vous médical');
  await parent.getByRole('button', { name: 'Envoyer' }).click();
  await expect(parent.getByText('Motif transmis')).toBeVisible({ timeout: 20_000 });

  await page.goto('/school/presences/justificatifs');
  await page.getByRole('button', { name: 'Accepter' }).first().click();
  await expect(page.getByText('Aucun justificatif.')).toBeVisible({ timeout: 20_000 });
  await parent.reload();
  await expect(records.getByText('Absence justifiée')).toHaveCount(1, { timeout: 30_000 });
  await parentCtx.close();
  expect(errors).toEqual([]);
});
