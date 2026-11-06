import { expect, test } from '@playwright/test';
import {
  type CreatedMember,
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
 * Ocall School — emplois du temps (Sprint 7), isolation entre clients et interface arabe.
 */
requireSchool();

test('emploi du temps : créé et publié, conflit enseignant rejeté ; l’enseignant consulte sans créer', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'planning');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École Planning' }, [
    ['mathematiques', 1],
    ['francais', 1],
  ]);
  const classB = await call('/school/classes', 'POST', {
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
  // Le même enseignant de mathématiques dans les deux classes : source du conflit à détecter.
  for (const classId of [school.classId, classB.id]) {
    await call('/school/teaching-assignments', 'POST', {
      classId,
      subjectId: school.subjects.mathematiques,
      memberId: teacher.member.id,
    });
  }
  await call('/school/rooms', 'POST', { schoolId: school.id, name: 'Salle 1', capacity: 30 });
  const validFrom = `${school.startYear}-09-01`;
  const validTo = `${school.startYear + 1}-07-31`;
  await chooseSchool(page, school.id);

  await page.goto('/school/emplois-du-temps');
  const version = page.getByTestId('new-version');
  await version.getByLabel('Valable du').fill(validFrom);
  await version.getByLabel('Valable jusqu’au').fill(validTo);
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('slot-add').click();
  await page
    .getByTestId('slot-form')
    .getByLabel('Matière et enseignant')
    .selectOption({ index: 1 });
  await page.getByTestId('slot-form').getByLabel('Salle').selectOption({ label: 'Salle 1' });
  await page.getByRole('button', { name: 'Enregistrer le créneau' }).click();
  await expect(page.getByTestId('slots').getByText('Mathématiques')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('versions').getByText('Publié')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('week-schedule').getByText('Mathématiques').first()).toBeVisible();

  // Même créneau en CM1 B avec le même enseignant : rejeté, avec la classe en cause.
  await page.getByLabel('Classe', { exact: true }).selectOption({ label: 'CM1 B' });
  await version.getByLabel('Valable du').fill(validFrom);
  await version.getByLabel('Valable jusqu’au').fill(validTo);
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await page.getByTestId('slot-add').click();
  const form = page.getByTestId('slot-form');
  const subjectSelect = form.getByLabel('Matière et enseignant');
  await expect(subjectSelect.locator('option', { hasText: 'Mathématiques' })).toHaveCount(1, {
    timeout: 30_000,
  });
  await subjectSelect.selectOption({
    label: (await subjectSelect.locator('option', { hasText: 'Mathématiques' }).innerText()).trim(),
  });
  await page.getByRole('button', { name: 'Enregistrer le créneau' }).click();
  const conflicts = form.getByTestId('conflicts');
  await expect(conflicts).toContainText(/l’enseignant a déjà cours/, { timeout: 20_000 });
  await expect(conflicts).toContainText('CM1 A');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  // Un brouillon sans créneau ne peut pas être publié.
  await page.getByTestId('publish').click();
  await expect(
    page.getByText('Un emploi du temps sans créneau ne peut pas être publié.'),
  ).toBeVisible({ timeout: 20_000 });

  const tpage = await memberPage(browser, teacher, school.id, errors);
  await tpage.goto('/school/mon-planning');
  const week = tpage.getByTestId('week-schedule');
  await expect(week.getByText('Mathématiques').first()).toBeVisible({ timeout: 30_000 });
  await expect(week.getByText('CM1 A').first()).toBeVisible();
  const forbidden = await apiCaller(tpage)('/school/timetables', 'POST', {
    classId: school.classId,
    validFrom,
    validTo,
  });
  expect(forbidden.status).toBe(403);
  await tpage.context().close();
  expect(errors).toEqual([]);
});

test('isolation : un autre client ne voit aucune donnée School du premier (404)', async ({
  page,
  request,
  browser,
}) => {
  const clientA = await seedSchoolClient(request, 'isolation-a');
  await loginTo(page, clientA.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École A' }, []);
  const { studentId, guardianId } = await seedStudent(call, school, 'Ba', 'Awa');

  const clientB = await seedSchoolClient(request, 'isolation-b');
  const ctxB = await browser.newContext({ locale: 'fr-FR' });
  const pageB = await ctxB.newPage();
  await loginTo(pageB, clientB.email);
  const asB = apiCaller(pageB);
  const statuses = [
    (await asB(`/school/students/${studentId}`)).status,
    (await asB(`/school/students/${studentId}/sensitive`)).status,
    (await asB(`/school/students/${studentId}/guardians`)).status,
    (await asB(`/school/guardians/${guardianId}/portal`)).status,
    (await asB(`/school/classes/${school.classId}`)).status,
    (await asB(`/school/classes/${school.classId}/students`)).status,
    (await asB(`/school/timetables?classId=${school.classId}`)).status,
    (await asB(`/school/rooms?schoolId=${school.id}`)).status,
  ];
  expect(statuses).toEqual(statuses.map(() => 404));
  // Écriture refusée de même : aucune inscription dans la classe d'un autre client.
  const write = await asB('/school/enrollments', 'POST', {
    studentId,
    schoolYearId: school.yearId,
    levelId: school.levelId,
    classId: school.classId,
  });
  expect(write.status).toBe(404);
  await ctxB.close();
});

test('établissement en arabe : interface de droite à gauche, titres traduits', async ({
  page,
  request,
}) => {
  const client = await seedSchoolClient(request, 'arabe');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, {
    name: 'Ecole Nour',
    nameAr: 'مدرسة النور',
    defaultLocale: 'AR',
  });
  await seedStudent(call, school, 'Ndiaye', 'Khadija', {
    lastNameAr: 'انجاي',
    firstNameAr: 'خديجة',
  });
  await chooseSchool(page, school.id);
  for (const [route, heading] of [
    ['/school/periodes', 'الفترات الدراسية'],
    ['/school/resultats', 'النتائج والمعدلات'],
    ['/school/finances', 'لوحة القيادة المالية'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-school-locale="AR"]').first()).toHaveAttribute('dir', 'rtl');
  }
  await page.goto('/school/emplois-du-temps');
  await expect(page.getByText('استعمالات الزمن').first()).toBeVisible({ timeout: 30_000 });
});
