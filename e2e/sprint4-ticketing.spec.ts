import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 4 — billetterie, QR codes et contrôle d'accès, de bout en bout dans le navigateur.
 * Imprimante « Simulation » (aucun matériel). Le scan par caméra exige un appareil réel : il est
 * remplacé ici par la saisie manuelle du code, qui suit exactement le même chemin côté serveur.
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Base de test Neon en us-east-2 : un encaissement de billets enchaîne une douzaine d'allers-retours. */
const NETWORK_WAIT = { timeout: 30_000 };

const simulated = (page: Page) =>
  page.evaluate(() => window.__ocallSimulated ?? { prints: [], drawerOpenings: 0 });

test.describe('Sprint 4 — billetterie et contrôle d’accès', () => {
  test.setTimeout(300_000);

  test('tarifs, vente avec prénoms, billets QR imprimés, entrée unique, tableau de bord', async ({
    page,
    context,
  }) => {
    await signupOrganization(page, {
      metier: 'Parc',
      orgName: 'Aqua Djoliba',
      email: uniqueEmail('park'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();

    // Tarifs créés depuis l'écran de configuration.
    await page.goto('/app/billetterie/configuration');
    for (const c of [
      { kind: 'ADULT', name: 'Adulte', price: '3000', people: '1' },
      { kind: 'FAMILY', name: 'Famille 3', price: '9000', people: '3' },
    ]) {
      await page.getByRole('button', { name: 'Nouvelle catégorie' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nouvelle catégorie de billet' });
      await dialog.getByLabel('Type').selectOption(c.kind);
      await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill(c.name);
      await dialog.getByLabel('Prix (FCFA)').fill(c.price);
      await dialog.getByLabel('Personnes incluses').fill(c.people);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(dialog).toBeHidden(NETWORK_WAIT);
    }
    await expect(page.getByText('Famille 3')).toBeVisible();

    // Poste avec imprimante simulée 80 mm, rattaché à cet appareil.
    const terminal = await apiPost(page, '/pos-terminals', {
      establishmentId: establishment.id,
      name: 'Guichet 1',
      printerConnection: 'SIMULATED',
      paperWidth: 80,
    });
    await page.goto('/app/billetterie');
    await page.evaluate(
      ([estId, terminalId]) => localStorage.setItem(`ocp.pos.terminal.${estId}`, terminalId!),
      [establishment.id, terminal.id],
    );
    await page.reload();
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByTestId('device-terminal')).toContainText('Guichet 1', NETWORK_WAIT);

    // Vente : 1 adulte + 1 famille de 3 → 4 prénoms obligatoires, total calculé par le serveur.
    const tiles = page.getByRole('region', { name: 'Catégories de billets' });
    await tiles.getByRole('button', { name: /Adulte/ }).click();
    await tiles.getByRole('button', { name: /Famille 3/ }).click();
    await expect(page.getByTestId('ticket-total')).toHaveText(/12\s?000 FCFA/, NETWORK_WAIT);
    const checkout = page
      .getByRole('button', { name: 'Encaisser', exact: true })
      .filter({ visible: true });
    await expect(checkout).toBeDisabled();
    await page.getByLabel('Prénom du visiteur 1 (Adulte)').fill('Awa');
    for (const [i, name] of ['Seydou', 'Kadi', 'Oumou'].entries()) {
      await page.getByLabel(`Prénom du visiteur ${i + 1} (Famille 3)`).fill(name);
    }
    await checkout.click();
    const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
    await expect(payment.getByTestId('payment-total')).toHaveText(/12\s?000 FCFA/);
    await payment.getByLabel('Montant remis par le client (FCFA)').fill('15000');
    await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();

    const issued = page.getByRole('dialog', { name: 'Billets émis' });
    await expect(issued.getByTestId('change-given')).toHaveText(/3\s?000 FCFA/, NETWORK_WAIT);
    await expect(issued.getByTestId('issued-ticket')).toHaveCount(4, NETWORK_WAIT);
    await expect(issued.getByTestId('print-step')).toHaveAttribute(
      'data-status',
      'SUCCEEDED',
      NETWORK_WAIT,
    );
    const log = await simulated(page);
    expect(log.prints).toHaveLength(1);
    const printed = log.prints[0]!.join('\n');
    expect(printed.match(/BILLET D.ENTR/g)).toHaveLength(4);
    expect(printed.match(/\[QR [0-9A-F]{8}\]/g)).toHaveLength(4);
    expect(log.prints[0]!.every((line) => line.length <= 48)).toBe(true);

    // Chaque billet a son propre QR, qui ne contient que le jeton.
    const qrs = await issued
      .locator('img[data-qr]')
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute('data-qr')!));
    expect(new Set(qrs).size).toBe(4);
    for (const qr of qrs) expect(qr).toMatch(/^OCP1-[A-Za-z0-9_-]{22}$/);
    await issued.getByRole('button', { name: 'Nouvelle vente' }).click();

    // Contrôle d'accès (saisie manuelle, même chemin serveur que la caméra).
    await page.goto('/app/controle-acces');
    const code = page.getByLabel('Saisie manuelle du code');
    const result = page.getByTestId('scan-result');
    await code.fill(qrs[0]!);
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect(result).toHaveAttribute('data-result', 'ACCEPTED', NETWORK_WAIT);
    await expect(result).toContainText('Entrée autorisée');
    await expect(result).toContainText('Awa');

    await code.fill(qrs[0]!);
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect(result).toContainText('Billet déjà utilisé', NETWORK_WAIT);
    await expect(result).toHaveAttribute('data-result', 'REFUSED');

    await code.fill('OCP1-AAAAAAAAAAAAAAAAAAAAAA');
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect(result).toContainText('Billet inconnu', NETWORK_WAIT);
    await expect(page.getByTestId('scan-history').locator('li')).toHaveCount(3, NETWORK_WAIT);

    // Hors connexion : aucune validation possible.
    await context.setOffline(true);
    await expect(page.getByText(/Hors connexion : validation impossible/)).toBeVisible();
    await code.fill(qrs[1]!);
    await expect(page.getByRole('button', { name: 'Valider', exact: true })).toBeDisabled();
    await context.setOffline(false);

    // Tableau de bord : 4 billets vendus, 1 entrée, chiffre d'affaires du jour.
    await page.goto('/app/billetterie/tableau');
    await expect(page.getByTestId('park-tickets-sold')).toHaveText('4', NETWORK_WAIT);
    await expect(page.getByTestId('park-entries')).toHaveText('1');
    await expect(page.getByTestId('park-revenue')).toHaveText(/12\s?000 FCFA/);
    await expect(page.getByText('Famille 3')).toBeVisible();

    // Tableau de bord principal : revenus du parc affichés.
    await page.goto('/app');
    await expect(page.getByTestId('revenue-PARK-today')).toHaveText(/12\s?000 FCFA/, NETWORK_WAIT);
  });
});
