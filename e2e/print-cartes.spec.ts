import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type Page, devices, expect, test } from '@playwright/test';
import { PrintPrismaClient } from '@ocall/print-database';
import {
  chooseSchool,
  loginTo,
  requireSchool,
  seedSchool,
  seedSchoolClient,
  seedStudent,
  seeder,
} from './school-support';
import { superAdminPage } from './suite-support';
import { expectNoHorizontalOverflow, signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Print × Ocall School (lots PR-1 à SC-3), de bout en bout dans le navigateur :
 * - School (ordinateur) : modèle recto verso, carte depuis la fiche de l'élève, commande (prix unitaire,
 *   quantité, total), atelier (imprimeur avec double authentification) jusqu'à la livraison et
 *   l'encaissement en espèces, suivi côté école, lecture du QR ;
 * - accès autonome gratuit (téléphone) : fiche, photo, carte, commande, suivi, sans débordement.
 * Données fictives uniquement ; photos générées par le test.
 */

const printUrl = process.env.TEST_PRINT_DATABASE_URL;
const apiRequire = createRequire(join(process.cwd(), 'apps/api/package.json'));
/** sharp vient des dépendances de l'API (absent de la racine) : signature minimale utilisée ici. */
const sharp = apiRequire('sharp') as (input: {
  create: { width: number; height: number; channels: 3; background: string };
}) => { jpeg(): { toBuffer(): Promise<Buffer> } };

const photo = () =>
  sharp({ create: { width: 480, height: 600, channels: 3, background: '#6688AA' } })
    .jpeg()
    .toBuffer();

/** QR d'une carte, lu dans la ligne de commande figée (base Print de TEST). */
async function qrOf(cardNumber: string): Promise<string> {
  const db = new PrintPrismaClient({ datasourceUrl: printUrl });
  try {
    const item = await db.printOrderItem.findFirstOrThrow({ where: { cardNumber } });
    return (item.data as { qr: string }).qr;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Débordement sur téléphone mesuré par rapport à l'écran : en mode mobile, un contenu trop large fait
 * dézoomer la page et `innerWidth` grandit avec lui (mesure classique aveugle).
 */
async function expectFitsPhone(page: Page) {
  const r = await page.evaluate(() => ({
    over: Math.max(document.documentElement.scrollWidth, window.innerWidth) - screen.width,
    // Éléments les plus profonds qui dépassent de l'écran (diagnostic en cas d'échec).
    offenders: [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > screen.width + 1)
      .filter(
        (e) => ![...e.children].some((c) => c.getBoundingClientRect().right > screen.width + 1),
      )
      .slice(0, 5)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}.${e.className} → ${Math.round(e.getBoundingClientRect().right)}px`,
      ),
  }));
  expect(r.over, r.offenders.join(' | ')).toBeLessThanOrEqual(0);
}

test.describe('Ocall Print — cartes scolaires et badges', () => {
  test.skip(!printUrl, 'Base Print de test absente (TEST_PRINT_DATABASE_URL)');
  test.setTimeout(420_000);

  test('School : modèle, carte depuis la fiche, commande, atelier, livraison, encaissement, QR', async ({
    page,
    request,
    browser,
  }) => {
    requireSchool();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const client = await seedSchoolClient(request, 'print');
    await loginTo(page, client.email);
    const call = seeder(page);
    const school = await seedSchool(call, { name: 'École Les Baobabs E2E' });
    const { studentId } = await seedStudent(call, school, 'Diallo', 'Aminata');
    await chooseSchool(page, school.id);
    // Photo du dossier (obligatoire pour commander), envoyée comme un document PHOTO.
    const up = await page.request.post(`/api/v1/school/students/${studentId}/documents`, {
      multipart: {
        category: 'PHOTO',
        file: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await photo() },
      },
    });
    expect(up.status(), await up.text()).toBe(201);

    // 1. Modèle recto verso, personnalisé puis prévisualisé.
    await page.goto('/school/cartes/modeles');
    await page.getByLabel('Nom du nouveau modèle').fill('Carte élève 2026');
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page).toHaveURL(/\/school\/cartes\/modeles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.getByLabel('Titre du recto').fill('CARTE D’ÉLÈVE');
    await page.getByTestId('print-template-save').click();
    await expect(page.getByText('Modèle enregistré')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByAltText('Recto de la carte')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 2. Carte créée depuis la fiche de l'élève.
    await page.goto(`/school/eleves/${studentId}`);
    await page.getByRole('tab', { name: 'Carte' }).click();
    await page.getByTestId('student-card-create').click();
    const cardNumber = (await page.getByTestId('student-card-number').innerText()).trim();
    expect(cardNumber).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    await page.getByRole('button', { name: 'Aperçu' }).click();
    await expect(page.getByAltText('Verso de la carte')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');

    // 3. Commande : prix unitaire, quantité, montant total.
    await page.goto('/school/cartes');
    await page
      .getByRole('checkbox', { name: /Sélectionner/ })
      .first()
      .check();
    await page.getByTestId('cards-order-open').click();
    const summary = page.getByTestId('print-order-summary');
    await expect(summary).toContainText('3 000');
    await expect(summary).toContainText('Quantité');
    await page.getByLabel('Adresse de livraison').fill('Hamdallaye ACI, Bamako');
    await page.getByLabel('Personne à contacter').fill('Direction');
    await page.getByLabel('Téléphone').fill('+223 70 11 22 33');
    await page.getByTestId('print-order-submit').click();
    await expect(page).toHaveURL(/\/school\/cartes\/commandes\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const orderUrl = page.url();
    await expect(page.getByTestId('print-order-detail')).toContainText('IMP-');
    await expect(page.getByTestId('print-order-amount').first()).toContainText('3 000');
    await expect(page.getByTestId('print-proof-link')).toBeVisible();

    // 4. Atelier : l'imprimeur arrive sur sa file, produit, livre, encaisse.
    const printer = await superAdminPage(browser, 'imprimeur', 'PRINT_OPERATOR');
    printer.on('pageerror', (e) => errors.push(e.message));
    await printer.goto('/admin');
    await expect(printer).toHaveURL(/\/admin\/impression$/, { timeout: 30_000 });
    const orderId = orderUrl.split('/').pop()!;
    await printer.goto(`/admin/impression/${orderId}`);
    for (const step of ['Acceptée', 'En production', 'Prête', 'Livrée']) {
      await printer.getByTestId('print-advance').click();
      // Badge de statut (la frise affiche toujours toutes les étapes).
      await expect(printer.getByTestId('print-order-status')).toHaveText(step, {
        timeout: 30_000,
      });
    }
    await printer.getByTestId('print-pay-open').click();
    await printer.getByLabel('N° du reçu remis').fill('REC-E2E-001');
    await printer.getByTestId('print-dialog-confirm').click();
    await expect(printer.getByTestId('print-order-detail')).toContainText('REC-E2E-001', {
      timeout: 30_000,
    });

    // 5. Suivi côté école, puis lecture du QR de la carte.
    await page.goto(orderUrl);
    await expect(page.getByTestId('print-order-status')).toHaveText('Livrée');
    await expect(page.getByTestId('print-order-payment')).toHaveText('Réglée');
    await page.goto('/school/cartes/verifier');
    const scan = page.getByLabel('Scanner ou coller le QR de la carte');
    await scan.fill(await qrOf(cardNumber));
    await scan.press('Enter');
    await expect(page.getByTestId('card-verify-status')).toHaveText('Carte valide', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('card-verify-result')).toContainText('DIALLO Aminata');
    expect(errors).toEqual([]);
  });

  test('accès autonome gratuit sur téléphone : fiche, photo, carte, commande, suivi', async ({
    browser,
  }) => {
    const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
    const context = await browser.newContext({ ...pixel7, locale: 'fr-FR' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signupOrganization(page, {
      metier: 'Parc',
      orgName: 'Entreprise Badges',
      email: uniqueEmail('print-auto'),
    });
    const call = seeder(page);
    await page.goto('/suite');
    await page.getByTestId('suite-print-link').click();
    await expect(page).toHaveURL(/\/print$/, { timeout: 30_000 });
    await expectFitsPhone(page);

    await page.goto('/print/modeles');
    await page.getByLabel('Nom du nouveau modèle').fill('Badge du personnel');
    await page.getByLabel('Type de carte').selectOption('STAFF');
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page).toHaveURL(/\/print\/modeles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByAltText('Recto de la carte')).toBeVisible({ timeout: 30_000 });
    await expectFitsPhone(page);

    await page.goto('/print/fiches');
    await page.getByLabel('Type').selectOption('STAFF');
    await page.getByTestId('print-person-new').click();
    await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Coulibaly');
    await page.getByLabel('Prénom').fill('Bakary');
    await page.getByLabel('Fonction').fill('Gardien');
    await page.getByTestId('print-person-save').click();
    const row = page.getByTestId('print-person-row').filter({ hasText: 'COULIBALY Bakary' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const persons = await call<{ id: string }[]>('/ocall-print/persons?kind=STAFF');
    const put = await page.request.put(`/api/v1/ocall-print/persons/${persons[0]!.id}/photo`, {
      multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await photo() } },
    });
    expect(put.status(), await put.text()).toBe(200);
    await page.reload();
    await page.getByLabel('Type').selectOption('STAFF');
    await row.getByRole('checkbox').check();
    await page.getByTestId('print-issue-cards').click();
    await expect(row).toContainText('Active', { timeout: 30_000 });
    await row.getByRole('checkbox').check();
    await page.getByTestId('print-order-open').click();
    await expect(page.getByTestId('print-order-summary')).toContainText('3 000');
    await page.getByLabel('Adresse de livraison').fill('Zone industrielle, Bamako');
    await page.getByLabel('Personne à contacter').fill('Accueil');
    await page.getByLabel('Téléphone').fill('+223 66 00 00 00');
    await expectFitsPhone(page);
    await page.getByTestId('print-order-submit').click();
    await expect(page).toHaveURL(/\/print\/commandes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByTestId('print-order-status')).toHaveText('Envoyée');
    await expectFitsPhone(page);
    expect(errors).toEqual([]);
    await context.close();
  });
});
