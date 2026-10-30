import { type Page, expect, test } from '@playwright/test';
import { PASSWORD, signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 5 — restaurant de bout en bout dans le navigateur : tables et QR code, commande sur place
 * avec instruction, envoi explicite en cuisine, écran cuisine en temps réel (sans rechargement),
 * coupure réseau de l'écran cuisine, service, encaissement, demande QR d'un client sans compte,
 * réservation sans double réservation, stocks et tableau de bord.
 * Imprimante cuisine « Simulation » (aucun matériel).
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Base de test Neon en us-east-2 : plusieurs allers-retours par action. */
const NETWORK_WAIT = { timeout: 30_000 };

const simulated = (page: Page) =>
  page.evaluate(() => window.__ocallSimulated ?? { prints: [], drawerOpenings: 0 });

async function addProduct(page: Page, name: string) {
  await page
    .getByRole('region', { name: 'Articles' })
    .getByRole('button', { name: new RegExp(name) })
    .click();
}

test.describe('Sprint 5 — restaurant', () => {
  test.setTimeout(420_000);

  test('commande, cuisine en direct, QR client, service, encaissement, réservation, stocks', async ({
    page,
    browser,
  }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Maquis du Fleuve',
      email: uniqueEmail('resto'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const category = await apiPost(page, '/catalog/categories', { name: 'Plats' });
    for (const [name, price] of [
      ['Poulet braisé', 4000],
      ['Jus de bissap', 1000],
    ] as const) {
      await apiPost(page, '/catalog/products', {
        name,
        categoryId: category.id,
        variants: [{ name: 'Standard', prices: [{ establishmentId: establishment.id, price }] }],
      });
    }
    await apiPost(page, '/pos-terminals', {
      establishmentId: establishment.id,
      name: 'Imprimante cuisine',
      printerConnection: 'SIMULATED',
      paperWidth: 80,
      kitchenPrinter: true,
    });

    // ─── Salles et tables : une terrasse, la table 4 et son QR code ───
    await page.goto('/app/restaurant/tables');
    await page.getByRole('button', { name: 'Nouvelle zone' }).click();
    const zoneDialog = page.getByRole('dialog', { name: 'Nouvelle zone' });
    await zoneDialog.getByLabel('Nom').fill('Terrasse');
    await zoneDialog.getByLabel('Type').selectOption('TERRACE');
    await zoneDialog.getByRole('button', { name: 'Créer la zone' }).click();
    await expect(zoneDialog).toBeHidden(NETWORK_WAIT);
    await page.getByRole('button', { name: 'Nouvelle table' }).click();
    const tableDialog = page.getByRole('dialog', { name: 'Nouvelle table' });
    await tableDialog.getByLabel('Nom ou numéro').fill('Table 4');
    await tableDialog.getByLabel('Zone').selectOption({ label: 'Terrasse' });
    await tableDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(tableDialog).toBeHidden(NETWORK_WAIT);
    const tableCard = page.getByTestId('dining-table').filter({ hasText: 'Table 4' });
    await expect(tableCard).toContainText('Libre');
    await tableCard.getByRole('button', { name: 'QR code' }).click();
    const qrDialog = page.getByRole('dialog', { name: /QR code — Terrasse · Table 4/ });
    await expect(qrDialog.locator('img[data-qr]')).toBeVisible();
    const qrUrl = (await qrDialog.getByTestId('qr-url').textContent())!.trim();
    expect(qrUrl).toMatch(/\/commande\/[A-Za-z0-9_-]{22}$/);
    await qrDialog.getByRole('button', { name: 'Fermer' }).click();

    // ─── Écran cuisine dans un second navigateur (employé « Cuisine ») ───
    const cook = await apiPost(page, '/employees', {
      firstName: 'Bintou',
      lastName: 'Cuisine',
      role: 'KITCHEN',
      establishmentIds: [establishment.id],
    });
    const kitchenContext = await browser.newContext({ baseURL: 'http://localhost:3000' });
    const kitchen = await kitchenContext.newPage();
    await kitchen.request.post('/api/v1/auth/login', {
      data: { identifier: cook.employee.loginId, password: cook.temporaryPassword },
    });
    await kitchen.request.post('/api/v1/auth/change-password', {
      data: { currentPassword: cook.temporaryPassword, newPassword: PASSWORD },
    });
    await kitchen.goto('/app/cuisine');
    await expect(kitchen.getByRole('status').filter({ hasText: 'En direct' })).toBeVisible(
      NETWORK_WAIT,
    );
    await expect(kitchen.getByText('Aucune commande en cuisine')).toBeVisible();

    // ─── Caisse : commande sur place, table 4, instruction, envoi explicite en cuisine ───
    await page.goto('/app/caisse');
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await page.getByRole('radio', { name: 'Sur place' }).click();
    await page.getByLabel('Table').selectOption({ label: 'Terrasse · Table 4' });
    await addProduct(page, 'Poulet braisé');
    await page.getByRole('button', { name: 'Ajouter une instruction' }).click();
    const noteDialog = page.getByRole('dialog', { name: /Poulet braisé/ });
    await noteDialog.getByLabel('Instruction').fill('Bien cuit');
    await noteDialog.getByRole('button', { name: 'Enregistrer l’instruction' }).click();
    await page.getByLabel('Instructions pour la commande').fill('Allergie arachide');
    await expect(page.getByTestId('cart-total')).toHaveText(/4\s?000 FCFA/, NETWORK_WAIT);
    await page
      .getByRole('button', { name: 'Envoyer en cuisine' })
      .filter({ visible: true })
      .first()
      .click();
    const saved = page.getByRole('dialog', { name: /Commande n° \d+ enregistrée/ });
    await expect(saved).toBeVisible(NETWORK_WAIT);
    await expect(saved).toContainText('Envoyée en cuisine.');
    await expect(saved).toContainText('Non payée');
    await expect(saved).toContainText('Ticket cuisine imprimé.', NETWORK_WAIT);
    const orderNumber = Number(
      (await saved.getByRole('heading').textContent())!.match(/n° (\d+)/)![1],
    );
    const kitchenTicket = (await simulated(page)).prints.at(-1)!.join('\n');
    expect(kitchenTicket).toContain('CUISINE');
    expect(kitchenTicket).toContain('1 x Poulet braisé');
    expect(kitchenTicket).toContain('>> Bien cuit');
    expect(kitchenTicket).toContain('Terrasse · Table 4');
    expect(kitchenTicket).not.toMatch(/FCFA/);
    await saved.getByRole('button', { name: 'Nouvelle commande' }).click();

    // ─── L'écran cuisine reçoit la commande en direct, sans rechargement ───
    const card = kitchen.locator(
      `[data-testid="kitchen-order"][data-order-number="${orderNumber}"]`,
    );
    await expect(card).toBeVisible(NETWORK_WAIT);
    await expect(card).toContainText('Poulet braisé');
    await expect(card).toContainText('Bien cuit');
    await expect(card).toContainText('Allergie arachide');
    await expect(card).toContainText('Terrasse · Table 4');
    await expect(card).not.toContainText('FCFA');

    // ─── Paiement sans envoi : une vente encaissée au comptoir n'arrive jamais en cuisine ───
    await addProduct(page, 'Jus de bissap');
    await expect(page.getByTestId('cart-total')).toHaveText(/1\s?000 FCFA/, NETWORK_WAIT);
    await page
      .getByRole('button', { name: 'Encaisser', exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
    await payment.getByLabel('Montant remis par le client (FCFA)').fill('1000');
    await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();
    const receipt = page.getByRole('dialog', { name: 'Paiement enregistré' });
    await expect(receipt).toContainText('Préparation : non envoyée en cuisine', NETWORK_WAIT);
    await receipt.getByRole('button', { name: 'Nouvelle vente' }).click();
    await kitchen.waitForTimeout(2000);
    await expect(kitchen.getByTestId('kitchen-order')).toHaveCount(1);

    // ─── Coupure réseau de l'écran cuisine : rien n'est perdu au retour ───
    await kitchenContext.setOffline(true);
    await expect(kitchen.getByText(/Hors connexion/)).toBeVisible();
    const catalog = await (
      await page.request.get(`/api/v1/pos/catalog?establishmentId=${establishment.id}`)
    ).json();
    const juice = catalog[0].products.find((p: { name: string }) => p.name === 'Jus de bissap');
    const offlineOrder = await apiPost(page, '/orders', {
      establishmentId: establishment.id,
      channel: 'TAKEAWAY',
      lines: [{ variantId: juice.variants[0].id, quantity: 2 }],
    });
    await apiPost(page, `/orders/${offlineOrder.id}/send-to-kitchen`, {});
    await kitchenContext.setOffline(false);
    await expect(
      kitchen.locator(`[data-testid="kitchen-order"][data-order-number="${offlineOrder.number}"]`),
    ).toBeVisible(NETWORK_WAIT);
    await expect(kitchen.getByRole('status').filter({ hasText: 'En direct' })).toBeVisible(
      NETWORK_WAIT,
    );

    // ─── La cuisine fait avancer la préparation ───
    await card.getByRole('button', { name: 'En préparation' }).click();
    await expect(
      kitchen
        .getByRole('region', { name: 'En préparation' })
        .locator(`[data-order-number="${orderNumber}"]`),
    ).toBeVisible(NETWORK_WAIT);
    await kitchen
      .locator(`[data-testid="kitchen-order"][data-order-number="${orderNumber}"]`)
      .getByRole('button', { name: 'Prête' })
      .click();
    await expect(
      kitchen
        .getByRole('region', { name: 'Prêtes' })
        .locator(`[data-order-number="${orderNumber}"]`),
    ).toBeVisible(NETWORK_WAIT);

    // ─── Salle : la commande est prête (mise à jour en direct), servie puis encaissée ───
    await page.goto('/app/commandes');
    const orderCard = page.locator(
      `[data-testid="order-card"][data-order-number="${orderNumber}"]`,
    );
    await expect(orderCard).toContainText('Prête', NETWORK_WAIT);
    await expect(orderCard).toContainText('Non payée');
    await orderCard.getByRole('button', { name: 'Marquer servie' }).click();
    await expect(orderCard).toContainText('Servie', NETWORK_WAIT);
    await orderCard.getByRole('button', { name: 'Encaisser' }).click();
    const pay2 = page.getByRole('dialog', { name: /Encaisser la vente/ });
    await pay2.getByLabel('Montant remis par le client (FCFA)').fill('5000');
    await pay2.getByRole('button', { name: /Valider l.encaissement/ }).click();
    const receipt2 = page.getByRole('dialog', { name: 'Paiement enregistré' });
    await expect(receipt2).toContainText('Préparation : servie', NETWORK_WAIT);
    await receipt2.getByRole('button', { name: 'Nouvelle vente' }).click();
    await expect(orderCard).toBeHidden(NETWORK_WAIT);
    await expect(kitchen.locator(`[data-order-number="${orderNumber}"]`)).toBeHidden(NETWORK_WAIT);

    // ─── Client sans compte : QR code de la table 4 ───
    const customerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const customer = await customerContext.newPage();
    await customer.goto(qrUrl);
    await expect(customer.getByRole('heading', { name: 'Terrasse · Table 4' })).toBeVisible(
      NETWORK_WAIT,
    );
    await customer.getByRole('button', { name: /Jus de bissap/ }).click();
    const productDialog = customer.getByRole('dialog', { name: 'Jus de bissap' });
    await productDialog.getByLabel('Instruction (facultatif)').fill('Sans glaçons');
    await productDialog.getByRole('button', { name: /Ajouter/ }).click();
    await customer.getByRole('button', { name: 'Voir ma commande' }).click();
    const review = customer.getByRole('dialog', { name: 'Ma commande' });
    await review.getByLabel('Votre prénom (facultatif)').fill('Awa');
    await review.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await expect(customer).toHaveURL(/\/commande\/suivi\/[A-Za-z0-9_-]{22}$/, NETWORK_WAIT);
    await expect(customer.getByText(/attend la validation du personnel/)).toBeVisible();
    const overflow = await customer.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'défilement horizontal du suivi sur téléphone').toBeLessThanOrEqual(0);

    // La demande apparaît en direct côté salle ; validée, elle devient une commande non payée.
    const request = page.getByTestId('qr-request').filter({ hasText: 'Awa' });
    await expect(request).toBeVisible(NETWORK_WAIT);
    await expect(request).toContainText('Sans glaçons');
    await request.getByRole('button', { name: 'Valider' }).click();
    await expect(
      page.getByText(/Demande validée : commande n° \d+ \(non payée, non envoyée en cuisine\)/),
    ).toBeVisible(NETWORK_WAIT);
    await expect(customer.locator('[aria-current="step"]')).toContainText('Validée', {
      timeout: 20_000,
    });
    await expect(customer.getByText(/à régler auprès du personnel/)).toBeVisible();
    await customerContext.close();

    // ─── Réservations : une table ne peut pas être réservée deux fois sur le même créneau ───
    await page.goto('/app/reservations');
    const tomorrow = new Date(Date.now() + 86_400_000);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    for (const [name, time] of [
      ['Mariam Diallo', '19:30'],
      ['Ousmane Keita', '20:00'],
    ] as const) {
      await page.getByRole('button', { name: 'Nouvelle réservation' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nouvelle réservation' });
      await dialog.getByLabel('Nom du client').fill(name);
      await dialog.getByLabel('Date').fill(date);
      await dialog.getByLabel('Heure').fill(time);
      await dialog.getByLabel('Personnes').fill('4');
      await dialog
        .getByLabel('Table ou zone')
        .selectOption({ label: 'Terrasse · Table 4 (4 couverts)' });
      await dialog.getByRole('button', { name: 'Enregistrer' }).click();
      if (name === 'Mariam Diallo') await expect(dialog).toBeHidden(NETWORK_WAIT);
      else {
        await expect(dialog.getByRole('alert')).toContainText('déjà réservée', NETWORK_WAIT);
        await dialog.getByRole('button', { name: 'Fermer' }).click();
      }
    }
    const tomorrowInWeek = page.getByTestId('reservation').filter({ hasText: 'Mariam Diallo' });
    // La réservation est dans la semaine affichée, ou dans la suivante si demain est lundi.
    if (!(await tomorrowInWeek.isVisible()))
      await page.getByRole('button', { name: 'Semaine suivante' }).click();
    await expect(
      page.getByTestId('reservation').filter({ hasText: 'Mariam Diallo' }),
    ).toContainText('Confirmée', NETWORK_WAIT);
    await page.getByRole('tab', { name: 'Calendrier' }).click();
    await expect(page.getByRole('button', { name: /19:30 Mariam Diallo/ })).toBeVisible();

    // ─── Stocks : un article, une entrée ───
    await page.goto('/app/stocks');
    await page.getByRole('button', { name: 'Nouvel article' }).click();
    const itemDialog = page.getByRole('dialog', { name: 'Nouvel article' });
    await itemDialog.getByLabel('Nom').fill('Poulet entier');
    await itemDialog.getByLabel('Seuil d’alerte (facultatif)').fill('3');
    await itemDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(itemDialog).toBeHidden(NETWORK_WAIT);
    const item = page.getByTestId('stock-item').filter({ hasText: 'Poulet entier' });
    await expect(item).toContainText('Alerte');
    await expect(item).toContainText('Inconnu');
    await item.getByRole('button', { name: 'Mouvement' }).click();
    const moveDialog = page.getByRole('dialog', { name: 'Poulet entier' });
    await moveDialog.getByLabel(/^Quantité/).fill('10');
    await moveDialog.getByRole('button', { name: 'Enregistrer le mouvement' }).click();
    await expect(moveDialog).toBeHidden(NETWORK_WAIT);
    await expect(item).toContainText('10 pièce');
    await expect(item).toContainText('OK');

    // ─── Tableau de bord : seul l'encaissé compte (1 000 + 4 000 FCFA) ───
    await page.goto('/app/restaurant/tableau');
    await expect(page.getByTestId('revenue-collected')).toHaveText(/5\s?000 FCFA/, NETWORK_WAIT);
    await expect(page.getByText('2 vente(s) encaissée(s)')).toBeVisible();

    await kitchenContext.close();
  });
});
