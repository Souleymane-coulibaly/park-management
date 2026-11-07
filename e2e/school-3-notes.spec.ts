import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  type CreatedMember,
  chooseSchool,
  loginTo,
  memberPage,
  requireSchool,
  seedSchool,
  seedSchoolClient,
  seedStudent,
  seeder,
} from './school-support';

/**
 * Ocall School — évaluations, notes, résultats et bulletins (Sprint 4) : saisie journalisée, validation
 * par la direction qui verrouille la saisie, bulletins PDF ; l'enseignant reste limité à ses matières.
 */
requireSchool();
test.use({ acceptDownloads: true });

test('notes : saisie, validation qui verrouille, bulletins PDF ; enseignant restreint', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'notes');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École Notes' }, [
    ['mathematiques', 3],
    ['francais', 2],
  ]);
  for (const [lastName, firstName] of [
    ['Ba', 'Awa'],
    ['Cisse', 'Fatou'],
    ['Diop', 'Mariam'],
  ]) {
    await seedStudent(call, school, lastName, firstName);
  }
  const teacher = await call<CreatedMember>('/school/members', 'POST', {
    firstName: 'Seydou',
    lastName: 'Diallo',
    role: 'TEACHER',
    schoolIds: [school.id],
  });
  await call('/school/teaching-assignments', 'POST', {
    classId: school.classId,
    subjectId: school.subjects.mathematiques,
    memberId: teacher.member.id,
  });
  await chooseSchool(page, school.id);

  await page.goto('/school/evaluations');
  const form = page.getByTestId('evaluation-form');
  await form.getByLabel('Intitulé', { exact: true }).fill('Devoir 1');
  await form.getByLabel('Date').fill(`${school.startYear}-10-20`);
  await form.getByRole('button', { name: 'Créer l’évaluation' }).click();
  await expect(page.getByTestId('evaluation-list').getByText('Devoir 1')).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('link', { name: 'Saisir les notes' }).first().click();
  const rows = page.getByTestId('grade-sheet').getByTestId('grade-row');
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  await rows.nth(0).getByLabel('Saisie').selectOption('SCORED');
  await rows.nth(0).getByLabel('Note').fill('15');
  await rows.nth(1).getByLabel('Saisie').selectOption('ABSENT');
  await rows.nth(2).getByLabel('Saisie').selectOption('EXEMPT');
  await expect(rows.nth(1).getByLabel('Note')).toBeDisabled();
  await page.getByRole('button', { name: 'Enregistrer les notes' }).click();
  await expect(page.getByText('Modifications enregistrées : 3')).toBeVisible({ timeout: 20_000 });
  // Toute correction est journalisée avec l'ancienne valeur, la nouvelle et le motif.
  await rows.nth(0).getByLabel('Note').fill('16,5');
  await page.getByLabel('Motif de la modification (facultatif)').fill('Erreur de report');
  await page.getByRole('button', { name: 'Enregistrer les notes' }).click();
  await expect(page.getByText('Modifications enregistrées : 1')).toBeVisible({ timeout: 20_000 });
  await rows.nth(0).getByRole('button', { name: 'Historique' }).click();
  const history = page.getByTestId('grade-history');
  await expect(history.locator('li')).toHaveCount(2, { timeout: 20_000 });
  await expect(history).toContainText('Modification');
  await expect(history).toContainText('16,50');
  await expect(history).toContainText('Erreur de report');
  const sheetUrl = page.url();

  await page.goto('/school/resultats');
  const table = page.getByTestId('results-table');
  await expect(table).toContainText('16,50', { timeout: 30_000 });
  await expect(table).toContainText('Moyenne générale');
  await page.getByRole('button', { name: 'Valider les résultats' }).click();
  await expect(page.getByText(/Validés le/).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(sheetUrl);
  await expect(page.getByText('Résultats validés')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('grade-sheet').locator('select')).toHaveCount(0);

  await page.goto('/school/bulletins');
  const card = page.getByTestId('report-card').first();
  await card.getByLabel('Appréciation de la direction').fill('Très bon trimestre.');
  await page.getByRole('button', { name: 'Enregistrer les appréciations' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible({ timeout: 20_000 });
  const [classPdf] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('download-class').click(),
  ]);
  const pdf = readFileSync(await classPdf.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(3); // un bulletin par élève

  // L'enseignant : ses matières seulement, sans moyenne générale ; bulletins refusés par l'API.
  const tpage = await memberPage(browser, teacher, school.id, errors);
  await tpage.goto('/school/resultats');
  await expect(tpage.getByText('Vous voyez les matières de vos affectations')).toBeVisible({
    timeout: 30_000,
  });
  const tTable = tpage.getByTestId('results-table');
  await expect(tTable).toContainText('Mathématiques');
  await expect(tTable).not.toContainText('Français');
  await expect(tTable).not.toContainText('Moyenne générale');
  await tpage.goto('/school/bulletins');
  await expect(tpage.getByText(/Vous n.avez pas les droits nécessaires/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(tpage.getByTestId('download-class')).toHaveCount(0);
  await tpage.context().close();
  expect(errors).toEqual([]);
});
