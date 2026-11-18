import { type Page, expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Parc — événements et billetterie événementielle (lots E1 à E4), de bout en bout dans le
 * navigateur : création, séance, tarifs, publication, vente au guichet sans prénom, billet imprimé,
 * contrôle QR, séance complète, suivi, acheteurs, annulation, puis affichage sur téléphone.
 * Imprimante « Simulation » ; le scan caméra est remplacé par la saisie manuelle (même chemin serveur).
 * Données fictives uniquement.
 */

const NETWORK_WAIT = { timeout: 30_000 };
const TZ = 'Africa/Bamako';

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const simulated = (page: Page) =>
  page.evaluate(() => window.__ocallSimulated ?? { prints: [], drawerOpenings: 0 });

/** Séance en cours dans le fuseau du parc : début il y a 30 min, fin dans 2 h. */
function currentSession() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const hhmm = (m: number) => {
    const v = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    start: hhmm(Math.max(0, minutes - 30)),
    end: hhmm(minutes + 120),
  };
}

async function scan(page: Page, qr: string) {
  await page.getByLabel('Saisie manuelle du code').fill(qr);
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
}

test.describe('Ocall Parc — événements', () => {
  test.setTimeout(300_000);

  test('création, vente au guichet, billet imprimé, entrée, complet, suivi, annulation, téléphone', async ({
    page,
  }) => {
    await signupOrganization(page, {
      metier: 'Parc',
      orgName: 'Aqua Gala',
      email: uniqueEmail('event'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();

    // E1 — événement en brouillon, séance de 2 places en cours, deux tarifs, publication.
    await page.goto('/app/billetterie/evenements');
    await page.getByRole('button', { name: 'Nouvel événement' }).click();
    const create = page.getByRole('dialog', { name: 'Nouvel événement' });
    await create.getByRole('textbox', { name: 'Nom', exact: true }).fill('Gala du Djoliba');
    await create.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByTestId('event-name')).toHaveText('Gala du Djoliba', NETWORK_WAIT);
    await expect(page.getByTestId('event-status')).toHaveText('Brouillon');

    const s = currentSession();
    await page.getByRole('button', { name: 'Nouvelle séance' }).click();
    const sessionDialog = page.getByRole('dialog', { name: 'Nouvelle séance' });
    await sessionDialog.getByLabel('Date').fill(s.date);
    await sessionDialog.getByLabel('Capacité (places)').fill('2');
    await sessionDialog.getByLabel('Début').fill(s.start);
    await sessionDialog.getByLabel('Fin').fill(s.end);
    await sessionDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(sessionDialog).toBeHidden(NETWORK_WAIT);
    await expect(page.getByTestId('session-places')).toHaveText(/0 \/ 2/);

    await page.getByRole('button', { name: 'Nouveau tarif' }).click();
    const tariff = page.getByRole('dialog', { name: 'Nouveau tarif' });
    await tariff.getByRole('textbox', { name: 'Nom', exact: true }).fill('Standard');
    await tariff.getByLabel('Prix (FCFA)').fill('5000');
    await tariff.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(tariff).toBeHidden(NETWORK_WAIT);
    await expect(page.getByTestId('event-tariffs')).toContainText('prénom facultatif');

    await page.getByRole('button', { name: 'Publier (mettre en vente)' }).click();
    await expect(page.getByTestId('event-status')).toHaveText('Publié', NETWORK_WAIT);

    // E2 — guichet : onglet Événements, deux billets non nominatifs, impression simulée.
    const terminal = await apiPost(page, '/pos-terminals', {
      establishmentId: establishment.id,
      name: 'Guichet gala',
      printerConnection: 'SIMULATED',
      paperWidth: 58,
    });
    await page.goto('/app/billetterie');
    await page.evaluate(
      ([estId, terminalId]) => localStorage.setItem(`ocp.pos.terminal.${estId}`, terminalId!),
      [establishment.id, terminal.id],
    );
    await page.reload();
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await page.getByRole('tab', { name: 'Événements' }).click();
    const panel = page.getByTestId('event-sale-panel');
    await expect(panel).toContainText('Gala du Djoliba', NETWORK_WAIT);
    await expect(panel.getByRole('button', { name: /2 place\(s\)/ })).toBeVisible();
    const standard = panel.getByRole('button', { name: /Standard/ });
    await standard.click();
    await standard.click();
    await expect(standard).toBeDisabled(); // les 2 places sont dans la commande
    await expect(page.getByTestId('ticket-total')).toHaveText(/10\s?000 FCFA/, NETWORK_WAIT);
    await expect(page.getByLabel('Prénom du visiteur 1 (Standard), facultatif')).toBeVisible();
    const checkout = page
      .getByRole('button', { name: 'Encaisser', exact: true })
      .filter({ visible: true });
    await expect(checkout).toBeEnabled(); // aucun prénom exigé
    await checkout.click();
    const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
    await payment.getByLabel('Montant remis par le client (FCFA)').fill('10000');
    await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();

    const issued = page.getByRole('dialog', { name: 'Billets émis' });
    await expect(issued.getByTestId('issued-ticket')).toHaveCount(2, NETWORK_WAIT);
    await expect(issued.getByTestId('ticket-event').first()).toContainText('Gala du Djoliba');
    await expect(issued.getByText('Billet non nominatif').first()).toBeVisible();
    await expect(issued.getByTestId('print-step')).toHaveAttribute(
      'data-status',
      'SUCCEEDED',
      NETWORK_WAIT,
    );
    const printed = (await simulated(page)).prints[0]!;
    expect(printed.join('\n').match(/BILLET ÉVÉNEMENT/g)).toHaveLength(2);
    expect(printed.join('\n')).toContain('Gala du Djoliba');
    expect(printed.every((line) => line.length <= 32)).toBe(true);
    const qrs = await issued
      .locator('img[data-qr]')
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute('data-qr')!));
    expect(qrs).toHaveLength(2);
    await issued.getByRole('button', { name: 'Nouvelle vente' }).click();
    // Séance complète : le guichet l'affiche et n'autorise plus de vente.
    await expect(panel.getByRole('button', { name: /Complet/ }).first()).toBeVisible(NETWORK_WAIT);
    await expect(panel.getByRole('button', { name: /Standard/ })).toBeDisabled();

    // E3 — contrôle : entrée acceptée avec l'événement affiché, une seule fois.
    await page.goto('/app/controle-acces');
    const result = page.getByTestId('scan-result');
    await scan(page, qrs[0]!);
    await expect(result).toHaveAttribute('data-result', 'ACCEPTED', NETWORK_WAIT);
    await expect(result.getByTestId('scan-event')).toContainText('Gala du Djoliba');
    await scan(page, qrs[0]!);
    await expect(result).toHaveAttribute('data-result', 'REFUSED', NETWORK_WAIT);

    // E4 — suivi, acheteurs, puis annulation de la séance avec la liste des acheteurs.
    await page.goto('/app/billetterie/evenements');
    await page.getByRole('link', { name: /Gala du Djoliba/ }).click();
    await expect(page.getByTestId('event-sold')).toHaveText('2', NETWORK_WAIT);
    await expect(page.getByTestId('event-follow-up')).toContainText('100 %');
    await page.getByRole('button', { name: 'Acheteurs' }).click();
    const buyers = page.getByRole('dialog', { name: /Acheteurs/ });
    await expect(buyers.getByTestId('buyers-total')).toContainText(
      '1 vente(s) · 2 billet(s)',
      NETWORK_WAIT,
    );
    await buyers.getByRole('button', { name: 'Fermer' }).first().click();
    await page.getByRole('button', { name: 'Annuler la séance' }).click();
    const cancel = page.getByRole('dialog', { name: /Annuler la séance/ });
    await cancel.getByLabel('Motif').fill('Orage annoncé');
    await cancel.getByRole('button', { name: 'Annuler la séance' }).click();
    await expect(page.getByRole('dialog', { name: /Acheteurs/ })).toContainText(
      'Séance annulée',
      NETWORK_WAIT,
    );
    await page
      .getByRole('dialog', { name: /Acheteurs/ })
      .getByRole('button', { name: 'Fermer' })
      .first()
      .click();
    await expect(page.getByText('Annulée : Orage annoncé')).toBeVisible(NETWORK_WAIT);

    await page.goto('/app/controle-acces');
    await scan(page, qrs[1]!);
    await expect(result).toHaveAttribute('data-result', 'REFUSED', NETWORK_WAIT);
    await expect(result).toContainText('annulé');

    // Téléphone (390 px) : aucune page des événements ne déborde.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/billetterie/evenements');
    await expect(page.getByTestId('event-list')).toBeVisible(NETWORK_WAIT);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('link', { name: /Gala du Djoliba/ }).click();
    await expect(page.getByTestId('event-sessions')).toBeVisible(NETWORK_WAIT);
    await expectNoHorizontalOverflow(page);
  });
});
