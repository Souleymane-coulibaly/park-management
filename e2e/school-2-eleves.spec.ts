import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import {
  chooseSchool,
  expectNoOverflow,
  loginTo,
  requireSchool,
  seedSchool,
  seedSchoolClient,
  seeder,
} from './school-support';

/**
 * Ocall School — dossier élève et inscription (Sprint 2), sur téléphone : matricule, saisie arabe,
 * validation exigeant un responsable, liste de classe exportée sans données de contact.
 */
requireSchool();
test.use({ ...devices['Pixel 7'], acceptDownloads: true });

const AR_FIRST = 'فاطمة';

test('inscription d’un élève : matricule, responsable obligatoire, validation, export de classe', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'eleves');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await seedSchool(call, {
    name: 'Medersa Annour',
    nameAr: 'مدرسة النور',
    defaultLocale: 'BILINGUAL',
  });
  await chooseSchool(page, school.id);

  await page.goto('/school/reglages-eleves');
  await page.getByLabel(/Préfixe/).fill('ECO');
  await page.getByLabel('Nombre de chiffres').fill('4');
  await expect(page.getByTestId('matricule-example')).toHaveText(/^ECO-/);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible({ timeout: 20_000 });

  await page.goto('/school/responsables');
  const gf = page.getByTestId('guardian-form');
  await gf.getByRole('textbox', { name: /^Nom/ }).fill('Traoré');
  await gf.getByLabel('Prénom').fill('Moussa');
  await gf.getByLabel('Téléphone').fill('+221 70 00 00 01');
  await gf.getByRole('button', { name: 'Créer le responsable' }).click();
  await expect(page.getByTestId('guardian-row').first()).toBeVisible({ timeout: 20_000 });

  await page.goto('/school/inscriptions');
  const sf = page.getByTestId('new-student-form');
  await sf.getByRole('textbox', { name: /^Nom(?! en)/ }).fill('Traoré');
  await sf.getByRole('textbox', { name: /^Prénom(?! en)/ }).fill('Fatoumata');
  const ar = sf.getByLabel('Prénom en arabe');
  await ar.fill(AR_FIRST);
  await expect(ar).toHaveAttribute('dir', 'rtl');
  await sf.getByLabel('Date de naissance').fill('2018-03-14');
  await sf.getByRole('button', { name: /Créer le dossier/ }).click();
  const matriculeCell = page.getByTestId('placement-matricule');
  await expect(matriculeCell).toHaveText(/^ECO-\d{4}-\d{4}$/, { timeout: 20_000 });
  const matricule = (await matriculeCell.textContent())!;
  const pf = page.getByTestId('placement-form');
  // Établissement bilingue : la classe est libellée en français et en arabe.
  const classOption = pf.getByLabel('Classe').locator('option', { hasText: 'CM1 A' });
  await pf.getByLabel('Classe').selectOption({ label: (await classOption.innerText()).trim() });
  await pf.getByRole('button', { name: 'Soumettre l’inscription' }).click();
  await expect(page.getByTestId('enrollment-queue')).toContainText('En attente', {
    timeout: 20_000,
  });
  await expectNoOverflow(page);

  // Règle métier : aucune validation sans responsable, message compréhensible.
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await expect(page.getByText(/au moins un responsable/)).toBeVisible({ timeout: 20_000 });

  // Recherche arabe sans diacritique, puis rattachement du responsable depuis la fiche.
  await page.goto('/school/eleves');
  await page.getByLabel('Rechercher').fill('فاطمه');
  await expect(page.getByTestId('student-row')).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId('student-row').first().getByRole('link').click();
  await expect(page.getByTestId('student-matricule')).toHaveText(matricule, { timeout: 20_000 });
  await page.getByRole('tab', { name: 'Responsables' }).click();
  await page.getByLabel('Rechercher par nom ou téléphone').fill('traore');
  await page.getByTestId('guardian-results').getByRole('button').first().click();
  const lf = page.getByTestId('link-guardian-form');
  await lf.getByLabel('Lien avec l’élève').selectOption('FATHER');
  await lf.getByRole('button', { name: 'Rattacher' }).click();
  await expect(page.getByTestId('guardian-links').getByText('Principal')).toBeVisible({
    timeout: 20_000,
  });

  await page.goto('/school/inscriptions');
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
  await page.getByLabel('Statut').selectOption('VALIDATED');
  await expect(page.getByTestId('enrollment-queue')).toContainText('Validée', { timeout: 20_000 });

  // Liste de classe exportée : l'arabe intact, ni téléphone ni adresse.
  await page.goto('/school/effectifs');
  await page.getByTestId('class-row').first().click();
  await expect(page.getByTestId('roster').getByText('Fatoumata')).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Exporter en CSV' }).click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain(AR_FIRST);
  expect(csv).toContain(matricule);
  expect(csv).not.toContain('+221');
  expect(csv).not.toMatch(/Adresse/);
  expect(errors).toEqual([]);
});
