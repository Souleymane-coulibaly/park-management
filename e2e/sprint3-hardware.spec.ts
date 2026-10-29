import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 3 — impression et tiroir-caisse, avec l'imprimante « Simulation » (aucun matériel).
 * Ces tests valident le parcours logiciel ; ils ne remplacent PAS la validation sur matériel réel
 * décrite dans docs/MATERIEL-POS.md.
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Restaurant avec un produit à 1 000 FCFA dans son établissement. */
async function setupRestaurant(page: Page, orgName: string) {
  await signupOrganization(page, { metier: 'Restaurant', orgName, email: uniqueEmail('hw') });
  const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
  const category = await apiPost(page, '/catalog/categories', { name: 'Boissons' });
  await apiPost(page, '/catalog/products', {
    name: 'Jus de gingembre',
    categoryId: category.id,
    variants: [{ name: 'Standard', prices: [{ establishmentId: establishment.id, price: 1000 }] }],
  });
  return establishment.id as string;
}

async function sellAndPay(page: Page) {
  await page
    .getByRole('region', { name: 'Articles' })
    .getByRole('button', { name: /Jus de gingembre/ })
    .click();
  await expect(page.getByTestId('cart-total')).toHaveText(/1\s?000 FCFA/);
  await page
    .getByRole('button', { name: 'Encaisser', exact: true })
    .filter({ visible: true })
    .click();
  const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
  await payment.getByLabel('Montant remis par le client (FCFA)').fill('2000');
  await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();
  return page.getByRole('dialog', { name: 'Paiement enregistré' });
}

/**
 * Chaque étape matérielle enchaîne une demande au serveur, l'exécution et le compte rendu. Avec la
 * base de test Neon en us-east-2 (~300 ms par aller-retour mesurés), une étape prend 5 à 8 s.
 */
const HARDWARE_WAIT = { timeout: 30_000 };

const simulated = (page: Page) =>
  page.evaluate(() => window.__ocallSimulated ?? { prints: [], drawerOpenings: 0 });

test.describe('Sprint 3 — impression et tiroir [simulation matérielle]', () => {
  test.setTimeout(180_000);

  test('configuration du poste, test d’impression, ticket et tiroir après paiement en espèces', async ({
    page,
  }) => {
    await setupRestaurant(page, 'Chez Binta');

    // Configuration du matériel : poste avec imprimante simulée 58 mm et tiroir.
    await page.goto('/app/caisse/materiel');
    await page.getByRole('button', { name: 'Nouveau poste' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau poste de caisse' });
    await dialog.getByLabel('Nom du poste').fill('Caisse 1');
    await dialog.getByLabel('Imprimante').selectOption('SIMULATED');
    await dialog.getByLabel('Largeur du papier').selectOption('58');
    await dialog.getByLabel('Tiroir-caisse relié à l’imprimante').check();
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    const row = page.getByRole('row', { name: /Caisse 1/ });
    await expect(row).toContainText('Simulation (aucun matériel)');
    await row.getByRole('button', { name: 'Tester' }).click();
    await expect(page.getByTestId('test-result-Caisse 1')).toHaveText('Test réussi', HARDWARE_WAIT);
    await row.getByRole('button', { name: 'Utiliser sur cet appareil' }).click();

    // Caisse : vente encaissée → tiroir ouvert une fois, ticket imprimé une fois.
    await page.goto('/app/caisse');
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByTestId('device-terminal')).toContainText('Caisse 1');
    const receipt = await sellAndPay(page);
    await expect(receipt.getByTestId('drawer-step')).toHaveAttribute(
      'data-status',
      'SUCCEEDED',
      HARDWARE_WAIT,
    );
    await expect(receipt.getByTestId('print-step')).toHaveAttribute(
      'data-status',
      'SUCCEEDED',
      HARDWARE_WAIT,
    );
    const log = await simulated(page);
    expect(log.drawerOpenings).toBe(1);
    // La navigation recharge la page : seul le ticket de vente est consigné ici (58 mm, 32 caractères).
    expect(log.prints).toHaveLength(1);
    const ticket = log.prints[0]!.join('\n');
    expect(ticket).toMatch(/TOTAL\s+1\s000 FCFA/);
    expect(ticket).toMatch(/Monnaie rendue\s+1\s000 FCFA/);
    expect(log.prints[0]!.every((line) => line.length <= 32)).toBe(true);
    await receipt.getByRole('button', { name: 'Nouvelle vente' }).click();

    // Ouverture manuelle justifiée (propriétaire).
    await page.getByRole('button', { name: 'Ouvrir le tiroir' }).click();
    const manual = page.getByRole('dialog', { name: 'Ouvrir le tiroir-caisse' });
    await manual.getByLabel('Justification').fill('Dépôt de monnaie');
    await manual.getByRole('button', { name: 'Ouvrir le tiroir' }).click();
    await expect(manual.getByText('Tiroir ouvert.')).toBeVisible();
    expect((await simulated(page)).drawerOpenings).toBe(2);
  });

  test('imprimante indisponible : la vente reste encaissée, l’échec est historisé et la nouvelle tentative réussit', async ({
    page,
  }) => {
    const establishmentId = await setupRestaurant(page, 'Chez Kadi');
    const terminal = await apiPost(page, '/pos-terminals', {
      establishmentId,
      name: 'Caisse A',
      printerConnection: 'SIMULATED',
    });
    await page.goto('/app/caisse');
    await page.evaluate(
      ([estId, terminalId]) => {
        localStorage.setItem(`ocp.pos.terminal.${estId}`, terminalId!);
        localStorage.setItem('ocp.hardware.simulateFailure', 'true');
      },
      [establishmentId, terminal.id],
    );
    await page.reload();
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();

    const receipt = await sellAndPay(page);
    await expect(receipt.getByTestId('print-step')).toHaveAttribute(
      'data-status',
      'FAILED',
      HARDWARE_WAIT,
    );
    await expect(receipt.getByTestId('print-step')).toContainText('indisponible');
    // Le paiement est confirmé malgré l'échec d'impression.
    await expect(receipt.getByTestId('change-given')).toHaveText(/1\s?000 FCFA/);

    // Retour de l'imprimante : nouvelle tentative réussie.
    await page.evaluate(() => localStorage.removeItem('ocp.hardware.simulateFailure'));
    await receipt.getByRole('button', { name: /Réessayer l.impression/ }).click();
    await expect(receipt.getByTestId('print-step')).toHaveAttribute(
      'data-status',
      'SUCCEEDED',
      HARDWARE_WAIT,
    );
    await receipt.getByRole('button', { name: 'Nouvelle vente' }).click();

    await page.goto('/app/caisse/ventes');
    await expect(page.getByRole('row', { name: /000001/ })).toContainText('Payée');
    await page.getByRole('button', { name: '000001' }).click();
    const attempts = page.getByTestId('print-attempts');
    await expect(attempts).toContainText('échec (PRINTER_UNREACHABLE)');
    await expect(attempts).toContainText('imprimé');
  });
});
