import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 6 — parcours principaux dans le navigateur : borne libre-service (appairage, commande,
 * numéro, révocation), validation et encaissement à la caisse avec fidélité, fiche client, planning
 * du personnel avec détection de conflit.
 */

async function apiPost(page: Page, path: string, data: unknown, method: 'post' | 'put' = 'post') {
  const res = await page.request[method](`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const NETWORK_WAIT = { timeout: 30_000 };

test.describe('Sprint 6 — bornes, CRM, fidélité, planning', () => {
  test.setTimeout(360_000);

  test('borne → caisse avec fidélité → fiche client → planning → révocation', async ({
    page,
    browser,
  }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Maquis Borne',
      email: uniqueEmail('kiosk'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const category = await apiPost(page, '/catalog/categories', { name: 'Plats' });
    await apiPost(page, '/catalog/products', {
      name: 'Poulet braisé',
      categoryId: category.id,
      imageUrl: 'https://images.example.com/poulet.jpg',
      variants: [
        { name: 'Standard', prices: [{ establishmentId: establishment.id, price: 4000 }] },
      ],
    });
    await apiPost(
      page,
      '/loyalty/rules/RESTAURANT',
      { isActive: true, earnAmountStep: 1000, redeemValue: 10, minRedeemPoints: 100 },
      'put',
    );
    // Poste de caisse dont l'imprimante (simulée ici) imprimera les tickets de la borne.
    await apiPost(page, '/pos-terminals', {
      establishmentId: establishment.id,
      name: 'Comptoir',
      printerConnection: 'SIMULATED',
      paperWidth: 58,
    });

    // ─── Administration : création de la borne et code d'appairage ───
    await page.goto('/app/bornes');
    await page.getByRole('button', { name: 'Nouvelle borne' }).click();
    const create = page.getByRole('dialog', { name: 'Nouvelle borne' });
    await create.getByLabel('Nom de la borne').fill('Borne entrée');
    await create.getByRole('button', { name: 'Créer et obtenir le code' }).click();
    const code = (await page.getByTestId('pairing-code').textContent())!.trim();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    await page.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    const printerSelect = page.getByLabel('Imprimante des tickets de Borne entrée');
    await printerSelect.selectOption({ label: 'Ticket sur : Comptoir' });
    await expect(printerSelect).toHaveValue(/.+/, NETWORK_WAIT);

    // ─── Tablette : appairage puis commande en libre-service ───
    const tabletContext = await browser.newContext({
      baseURL: 'http://localhost:3000',
      viewport: { width: 1024, height: 768 },
    });
    const tablet = await tabletContext.newPage();
    await tablet.goto('/kiosk');
    await tablet.getByLabel('Code d’appairage').fill(code);
    await tablet.getByRole('button', { name: 'Appairer' }).click();
    await tablet.getByRole('button', { name: /Touchez pour commander/ }).click(NETWORK_WAIT);
    // Aucun accès à l'administration depuis la borne.
    await expect(tablet.getByRole('link')).toHaveCount(0);
    await tablet
      .getByRole('region', { name: 'Produits' })
      .getByRole('button', { name: /Poulet braisé/ })
      .click();
    await expect(tablet.locator('img[src="https://images.example.com/poulet.jpg"]')).toHaveCount(1);
    const product = tablet.getByRole('dialog', { name: 'Poulet braisé' });
    await product.getByLabel('Instruction (facultatif)').fill('Sans piment');
    await product.getByRole('button', { name: /Ajouter/ }).click();
    await tablet.getByRole('button', { name: 'Voir ma commande' }).click();
    await tablet.getByRole('button', { name: 'Valider ma commande' }).click();
    const number = (await tablet.getByTestId('kiosk-number').textContent(NETWORK_WAIT))!.trim();
    expect(number).toMatch(/^B-\d{4}$/);
    await expect(tablet.getByText(/Présentez ce numéro à la caisse/)).toBeVisible();
    // Ticket de commande imprimé par la borne (imprimante simulée) et historisé sur le poste.
    await expect(tablet.getByText('Prenez votre ticket.')).toBeVisible(NETWORK_WAIT);
    const terminals = await (await page.request.get('/api/v1/pos-terminals')).json();
    const comptoir = terminals.find((t: { name: string }) => t.name === 'Comptoir');
    const jobs = await (
      await page.request.get(`/api/v1/print-jobs?terminalId=${comptoir.id}`)
    ).json();
    expect(jobs).toEqual([expect.objectContaining({ kind: 'KIOSK_TICKET', status: 'SUCCEEDED' })]);
    // La tablette n'a aucune session d'employé.
    const admin = await tabletContext.newPage();
    await admin.goto('/app');
    await expect(admin).toHaveURL(/\/connexion/);
    await admin.close();

    // ─── Caisse : validation de la demande de la borne, client et fidélité, encaissement ───
    await page.goto('/app/commandes');
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    const request = page.getByTestId('qr-request').filter({ hasText: number });
    await expect(request).toContainText('Borne · Borne entrée', NETWORK_WAIT);
    await expect(request).toContainText('Sans piment');
    await request.getByRole('button', { name: 'Valider' }).click();
    const card = page.getByTestId('order-card').filter({ hasText: 'Borne de commande' });
    await expect(card).toContainText('Non payée', NETWORK_WAIT);
    await expect(card).toContainText('Non envoyée en cuisine');
    await card.getByRole('button', { name: 'Encaisser' }).click();
    const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
    const loyalty = payment.getByRole('region', { name: 'Client et fidélité' });
    await loyalty.getByRole('button', { name: 'Nouveau client' }).click();
    await loyalty.getByLabel('Prénom du client').fill('Aminata');
    await loyalty.getByLabel('Téléphone du client').fill('+223 70 55 44 33');
    await loyalty.getByRole('checkbox').check();
    await loyalty.getByRole('button', { name: 'Créer et rattacher' }).click();
    await expect(loyalty.getByTestId('sale-customer')).toHaveText('Aminata', NETWORK_WAIT);
    await payment.getByLabel('Montant remis par le client (FCFA)').fill('5000');
    await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();
    const receipt = page.getByRole('dialog', { name: 'Paiement enregistré' });
    await expect(receipt).toContainText('Préparation : non envoyée en cuisine', NETWORK_WAIT);
    await receipt.getByRole('button', { name: 'Nouvelle vente' }).click();

    // ─── Fiche client : 4 points Restaurant (4 000 FCFA payés), historique ───
    await page.goto('/app/clients');
    await page.getByLabel('Rechercher (nom ou téléphone)').fill('Aminata');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await page.getByTestId('customer-row').getByRole('link', { name: 'Aminata' }).click();
    await expect(page.getByTestId('wallet-RESTAURANT')).toHaveText('4 points', NETWORK_WAIT);
    await expect(page.getByText('Points gagnés')).toBeVisible();

    // ─── Planning : un créneau, puis un créneau qui chevauche refusé ───
    await page.goto('/app/personnel/planning');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    for (const [start, end, ok] of [
      ['08:00', '12:00', true],
      ['10:00', '14:00', false],
    ] as const) {
      await page.getByRole('button', { name: 'Nouveau créneau' }).click(NETWORK_WAIT);
      const dialog = page.getByRole('dialog', { name: 'Nouveau créneau' });
      await dialog.getByLabel('Poste').selectOption({ label: 'Caisse' });
      await dialog.getByLabel('Date').fill(date);
      await dialog.getByLabel('Début').fill(start);
      await dialog.getByLabel('Fin').fill(end);
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      if (ok) await expect(dialog).toBeHidden(NETWORK_WAIT);
      else {
        await expect(dialog.getByRole('alert')).toContainText('chevauche', NETWORK_WAIT);
        await dialog.getByRole('button', { name: 'Fermer' }).click();
      }
    }
    await expect(page.getByTestId('staff-assignment')).toHaveCount(1);
    await expect(page.getByTestId('staff-assignment')).toContainText('08:00 – 12:00');

    // ─── Révocation : la borne cesse immédiatement de fonctionner ───
    await page.goto('/app/bornes');
    const device = page.getByTestId('kiosk-device').filter({ hasText: 'Borne entrée' });
    await expect(device).toContainText('Appairée');
    await device.getByRole('button', { name: 'Révoquer' }).click();
    await page.getByRole('button', { name: 'Révoquer la borne' }).click();
    await expect(device).toContainText('Révoquée', NETWORK_WAIT);
    await tablet.goto('/kiosk');
    await expect(tablet.getByRole('heading', { name: 'Appairer la borne' })).toBeVisible(
      NETWORK_WAIT,
    );
    await tabletContext.close();
  });
});
