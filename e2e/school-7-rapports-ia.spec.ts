import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import {
  type CreatedMember,
  type SchoolFixture,
  apiCaller,
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
 * Ocall School — rapports (Sprint 8) et Ocall School AI, fournisseur SIMULÉ uniquement (aucun appel
 * réel, aucun coût). Les chiffres de l'IA viennent du serveur et sont sourcés ; l'enseignant n'a accès
 * à aucun rapport.
 */
requireSchool();
test.use({ acceptDownloads: true });

/** Trois élèves notés en mathématiques : T1 12/8/14 (11,33), T2 15/11/16 (14), une absence du jour. */
async function seedResults(page: Page, label: string) {
  const call = seeder(page);
  const school: SchoolFixture = await seedSchool(call, { name: `École ${label}` });
  await call('/school/classes', 'POST', {
    schoolYearId: school.yearId,
    levelId: school.levelId,
    name: 'CM1 B',
    capacity: 30,
  });
  const teacher = await call<CreatedMember>('/school/members', 'POST', {
    firstName: 'Ibrahima',
    lastName: 'Diallo',
    role: 'TEACHER',
    schoolIds: [school.id],
  });
  await call('/school/teaching-assignments', 'POST', {
    classId: school.classId,
    subjectId: school.subjects.mathematiques,
    memberId: teacher.member.id,
  });
  const students: string[] = [];
  for (const [last, first] of [
    ['Ba', 'Awa'],
    ['Diop', 'Fatou'],
    ['Fall', 'Moussa'],
  ]) {
    students.push((await seedStudent(call, school, last, first)).studentId);
  }
  const y = school.startYear;
  for (const [periodId, heldOn, scores] of [
    [school.periodIds[0], `${y}-10-20`, [12, 8, 14]],
    [school.periodIds[1], `${y + 1}-01-20`, [15, 11, 16]],
  ] as const) {
    const ev = await call('/school/evaluations', 'POST', {
      classId: school.classId,
      periodId,
      subjectId: school.subjects.mathematiques,
      kind: 'HOMEWORK',
      title: `Devoir ${heldOn}`,
      heldOn,
      maxScore: 20,
    });
    await call(`/school/evaluations/${ev.id}/grades`, 'PUT', {
      grades: students.map((studentId, i) => ({ studentId, status: 'SCORED', score: scores[i] })),
    });
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date());
  await call('/school/attendance/sheet', 'PUT', {
    classId: school.classId,
    date: today,
    records: students.map((studentId, i) => ({
      studentId,
      status: i === 0 ? 'ABSENT' : 'PRESENT',
    })),
  });
  await chooseSchool(page, school.id);
  return { school, teacher };
}

test('rapports : indicateurs, tendance, export PDF ; enseignant refusé (403)', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'rapports');
  await loginTo(page, client.email);
  const { school, teacher } = await seedResults(page, 'Rapports');

  await page.goto('/school/rapports');
  const kpis = page.getByTestId('overview-kpis');
  await expect(kpis).toContainText(/Élèves actifs\s*3/, { timeout: 30_000 });
  await expect(kpis).toContainText(/Classes\s*2/);
  // Le tableau de bord montre la dernière période commencée : T1 (11,33) jusqu'au 3 janvier, puis T2 (14).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date());
  await expect(kpis).toContainText(
    today >= `${school.startYear + 1}-01-04` ? /14(,00)? \/ 20/ : /11,33 \/ 20/,
  );

  await page.getByTestId('report-tab-pedagogy').click();
  const ped = page.getByTestId('pedagogy-classes');
  await expect(ped).toContainText('Hausse', { timeout: 30_000 });
  // La classe vide est signalée, jamais remplie d'un chiffre inventé.
  await expect(ped).toContainText('Données insuffisantes');
  const [pdf] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('export-pdf').click(),
  ]);
  expect(
    readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');

  const tpage = await memberPage(browser, teacher, school.id, errors);
  await tpage.goto('/school/rapports');
  await expect(tpage.getByText('Votre rôle n’a accès à aucun rapport.')).toBeVisible({
    timeout: 30_000,
  });
  const forbidden = await apiCaller(tpage)(
    `/school/reports/overview?schoolYearId=${school.yearId}`,
  );
  expect(forbidden.status).toBe(403);
  await tpage.context().close();
  expect(errors).toEqual([]);
});

test('Ocall School AI (simulé) : désactivé par défaut, activé par la direction, réponse sourcée', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'ia');
  await loginTo(page, client.email);
  await seedResults(page, 'IA');

  await page.goto('/school/ia');
  await expect(page.getByText('Ocall School AI est désactivé pour cet établissement')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('ai-space-settings').click();
  await page.getByTestId('ai-setting-enabled').check();
  await page.getByTestId('ai-settings-save').click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('ai-space-copilot').click();
  await page
    .getByTestId('ai-suggestions')
    .getByText('Combien d’élèves sont inscrits cette année ?')
    .click();
  await expect(page.getByTestId('ai-answer').first()).toBeVisible({ timeout: 30_000 });
  // Réponse vérifiable : sources métier citées et chiffres calculés par le serveur.
  await expect(page.getByTestId('ai-sources').first()).toContainText(
    'Tableau de bord de direction',
  );
  await page.getByText('Chiffres calculés par le serveur').first().click();
  await expect(page.locator('pre').first()).toContainText('"activeStudents": 3');

  await page.getByTestId('ai-space-analysis').click();
  await expect(page.getByTestId('ai-analysis-classes')).toContainText('Hausse', {
    timeout: 30_000,
  });
  await page.getByTestId('ai-summarize').click();
  await expect(page.getByTestId('ai-summary')).toContainText('aucune décision', {
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});
