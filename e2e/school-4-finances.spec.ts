import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
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
 * Ocall School — finances (Sprint 5) : frais et échéancier, encaissement avec reçu numéroté, garde
 * contre le double encaissement, annulation motivée par contrepassation ; aucun accès pour l'enseignant.
 */
requireSchool();
test.use({ acceptDownloads: true });

async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), click()]);
  return readFileSync(await d.path());
}

test('finances : échéancier, caisse, reçu, double paiement confirmé, annulation ; enseignant exclu', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'finances');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, { name: 'École Finances' }, []);
  await seedStudent(call, school, 'Ba', 'Awa');
  await seedStudent(call, school, 'Cisse', 'Fatou');
  const teacher = await call<CreatedMember>('/school/members', 'POST', {
    firstName: 'Seydou',
    lastName: 'Diallo',
    role: 'TEACHER',
    schoolIds: [school.id],
  });
  const roster = (
    await call<{
      students: { lastName: string; firstName: string; matricule: string }[];
    }>(`/school/classes/${school.classId}/students`)
  ).students;
  const first = roster.find((s) => s.lastName === 'Ba')!;
  await chooseSchool(page, school.id);

  await page.goto('/school/finances/parametres');
  await page.getByTestId('finance-settings').getByLabel('Préfixe des reçus').fill('ECF');
  await page.getByTestId('finance-settings').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible({ timeout: 20_000 });

  await page.goto('/school/finances/frais');
  const form = page.getByTestId('fee-form');
  await form.getByLabel('Intitulé', { exact: true }).fill('Scolarité');
  await form.getByLabel('Montant annuel par élève (XOF)').fill('90 000');
  await form.getByLabel('Date d’application').fill(`${school.startYear}-10-01`);
  await form.getByLabel('Premier mois').fill(`${school.startYear}-10`);
  await form.getByLabel('Dernier mois').fill(`${school.startYear + 1}-06`);
  await form.getByRole('button', { name: 'Créer le frais' }).click();
  await expect(page.getByTestId('fee').first()).toContainText('Échéances : 9', { timeout: 20_000 });

  // Génération idempotente : 9 échéances × 2 élèves, puis aucune au second clic.
  await page.goto('/school/finances/echeanciers');
  await expect(page.getByTestId('installments').locator('li')).toHaveCount(9, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Générer les échéances' }).click();
  await expect(page.getByText('Échéances créées : 18')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Générer les échéances' }).click();
  await expect(page.getByText('Échéances créées : 0')).toBeVisible({ timeout: 20_000 });

  await page.goto('/school/finances/caisse');
  await page
    .getByTestId('student-picker')
    .getByLabel('Élève')
    .selectOption({ label: `${first.lastName} ${first.firstName} · ${first.matricule}` });
  const cash = page.getByTestId('cash-form');
  await cash.getByLabel('Montant (XOF)').fill('25 000');
  await cash.getByTestId('cash-submit').click();
  await expect(page.getByText(/Encaissement enregistré : reçu ECF-\d{4}-/)).toBeVisible({
    timeout: 20_000,
  });
  const receipt = await download(page, () => page.getByTestId('receipt-download').click());
  expect(receipt.subarray(0, 5).toString()).toBe('%PDF-');
  // Un second encaissement identique exige une confirmation explicite.
  await cash.getByLabel('Montant (XOF)').fill('25 000');
  await cash.getByTestId('cash-submit').click();
  await expect(page.getByText('Un encaissement identique vient d’être enregistré')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Il s’agit bien d’un second paiement' }).click();
  await expect(page.getByText(/Encaissement enregistré : reçu ECF-\d{4}-000002/)).toBeVisible({
    timeout: 20_000,
  });

  // Annulation : motif obligatoire, contrepassation, l'original reste visible comme annulé.
  await page.goto('/school/finances/paiements');
  await expect(page.getByTestId('payment')).toHaveCount(2, { timeout: 30_000 });
  await page.getByTestId('payment').first().getByRole('button', { name: 'Annuler' }).click();
  await page.getByTestId('cancel-form').getByLabel('Motif de l’annulation').fill('Doublon');
  await page.getByRole('button', { name: 'Confirmer l’annulation' }).click();
  await expect(page.getByTestId('payment-list').getByText('Contrepassation')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('payment-list').getByText('Annulé').first()).toBeVisible();

  await page.goto('/school/finances');
  const kpis = page.getByTestId('finance-kpis');
  await expect(kpis).toContainText('Attendu', { timeout: 30_000 });
  await expect(kpis).toContainText('Encaissé');
  const xlsx = await download(page, () =>
    page.getByRole('button', { name: 'Encaissements (XLSX)' }).click(),
  );
  expect(xlsx.subarray(0, 2).toString()).toBe('PK');

  const tpage = await memberPage(browser, teacher, school.id, errors);
  await tpage.goto('/school/finances');
  await expect(tpage.getByText(/Vous n.avez pas les droits nécessaires/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(tpage.getByTestId('finance-kpis')).toHaveCount(0);
  await tpage.context().close();
  expect(errors).toEqual([]);
});
