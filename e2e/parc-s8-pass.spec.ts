import { type Page, devices, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Parc sprint 8 — pass et abonnements, de bout en bout dans le navigateur (bureau et téléphone).
 * Le scan caméra exige un appareil réel : il est remplacé par la saisie manuelle du code, qui suit
 * exactement le même chemin côté serveur. Données fictives uniquement.
 */

const NETWORK_WAIT = { timeout: 30_000 };
/** Photo fictive (PNG 1 × 1) : le serveur la réencode en JPEG sans métadonnées. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function openCashRegister(page: Page) {
  await page.getByLabel('Fond de caisse (FCFA)').fill('0');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(page.getByRole('region', { name: 'Offres de pass' })).toBeVisible(NETWORK_WAIT);
}

async function newCustomer(page: Page, firstName: string, lastName: string) {
  await page.getByRole('button', { name: 'Nouveau client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await dialog.getByLabel('Prénom').fill(firstName);
  await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill(lastName);
  await dialog.getByText(/Le client accepte que ses informations/).click();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByTestId('pass-holder')).toHaveText(
    `${firstName} ${lastName}`,
    NETWORK_WAIT,
  );
}

async function pay(page: Page, amount: string) {
  const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
  await payment.getByLabel('Montant remis par le client (FCFA)').fill(amount);
  await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();
}

async function scan(page: Page, qr: string) {
  await page.getByLabel('Saisie manuelle du code').fill(qr);
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
}

/** Aucun débordement horizontal, ni de la page, ni d'un bloc dans sa colonne. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    // Un tableau large dans un cadre qui défile (overflow-x auto) est voulu : seul compte ce qui dépasse
    // de l'écran sans cadre de défilement.
    const inScroller = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const wide = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.right > doc.clientWidth + 1 &&
        getComputedStyle(el).position !== 'fixed' &&
        !inScroller(el)
      );
    });
    return {
      page: doc.scrollWidth - doc.clientWidth,
      elements: wide.slice(0, 3).map((e) => e.outerHTML.slice(0, 160)),
    };
  });
  expect(overflow).toEqual({ page: 0, elements: [] });
}

test.describe('Ocall Parc sprint 8 — pass et abonnements', () => {
  test.setTimeout(300_000);

  test('bureau : offre mensuelle, vente avec photo, lien personnel au QR dynamique, contrôle visuel, suspension, carte', async ({
    page,
    context,
  }) => {
    await signupOrganization(page, {
      metier: 'Parc',
      orgName: 'Aqua Pass',
      email: uniqueEmail('pass'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();

    // Offre mensuelle créée depuis l'écran (valeurs par défaut du type : QR dynamique, photo obligatoire).
    await page.goto('/app/billetterie/pass/offres');
    await page.getByRole('button', { name: 'Nouvelle offre' }).click();
    const offerDialog = page.getByRole('dialog', { name: 'Nouvelle offre de pass' });
    await offerDialog.getByLabel('Type de pass').selectOption('MONTHLY');
    await offerDialog.getByLabel('Nom de l’offre').fill('Mensuel Aqua');
    await offerDialog.getByLabel('Prix de base (FCFA)').fill('25000');
    await expect(offerDialog.getByLabel('QR code')).toHaveValue('DYNAMIC');
    await offerDialog.getByLabel('Suspension max. (jours)').fill('10');
    await offerDialog.getByRole('checkbox', { name: establishment.name }).check();
    await offerDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(offerDialog).toBeHidden(NETWORK_WAIT);
    await expect(page.getByRole('heading', { name: 'Mensuel Aqua' })).toBeVisible();

    // Vente : caisse ouverte, fiche client créée sur place, photo obligatoire.
    await page.goto('/app/billetterie/pass');
    await openCashRegister(page);
    await page
      .getByRole('region', { name: 'Offres de pass' })
      .getByRole('button', { name: /Mensuel Aqua/ })
      .click();
    await expect(page.getByTestId('pass-total')).toHaveText(/25\s?000 FCFA/);
    await newCustomer(page, 'Mariam', 'Keïta');
    const checkout = page.getByRole('button', { name: 'Encaisser', exact: true });
    await expect(checkout).toBeDisabled(); // photo manquante
    await page.getByTestId('pass-photo-input').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    await expect(page.getByTestId('pass-photo-preview')).toBeVisible(NETWORK_WAIT);
    await checkout.click();
    await pay(page, '25000');

    // Pass actif après paiement ; lien personnel montré une seule fois.
    const sold = page.getByRole('dialog', { name: 'Pass vendu' });
    await expect(sold.getByText('Actif', { exact: true })).toBeVisible(NETWORK_WAIT);
    await expect(sold.getByText(/QR dynamique/)).toBeVisible();
    await sold.getByRole('button', { name: 'Créer le lien personnel' }).click();
    const link = (await sold.getByTestId('pass-link-url').textContent({ timeout: 30_000 }))!;
    expect(link).toMatch(/\/pass\/[A-Za-z0-9_-]{32}$/);
    await sold.getByRole('link', { name: 'Voir la fiche du pass' }).click();
    await expect(page.getByTestId('pass-holder-name')).toHaveText('Mariam Keïta', NETWORK_WAIT);
    const passUrl = page.url();

    // Page du titulaire, sans compte : QR dynamique signé par le serveur, ni clé ni photo dans la page.
    const holder = await context.browser()!.newContext({ locale: 'fr-FR' });
    const holderPage = await holder.newPage();
    const responses: string[] = [];
    holderPage.on('response', async (r) => {
      if (r.url().includes('/api/v1/public/passes/')) responses.push(await r.text());
    });
    await holderPage.goto(link);
    const qrImg = holderPage.getByTestId('public-pass-qr').locator('img[data-qr]');
    await expect(qrImg).toBeVisible(NETWORK_WAIT);
    const dynamicQr = (await qrImg.getAttribute('data-qr'))!;
    expect(dynamicQr).toMatch(/^OCPD-[A-Za-z0-9_-]{16}\.\d+\.[A-Za-z0-9_-]{22}$/);
    await expect(holderPage.getByText(/Nouveau QR dans \d+ s/)).toBeVisible();
    await expect(holderPage.getByText('Mariam', { exact: false })).toBeVisible();
    expect(responses.join('')).not.toMatch(/Keïta|photo|phone|secret|key/i);
    expect(await holderPage.content()).not.toMatch(/Keïta/);

    // Contrôle : entrée acceptée avec photo et nom ; même QR refusé ensuite ; QR falsifié inconnu.
    await page.goto('/app/controle-acces');
    const result = page.getByTestId('scan-result');
    await scan(page, dynamicQr);
    await expect(result).toHaveAttribute('data-result', 'ACCEPTED', NETWORK_WAIT);
    await expect(result.getByTestId('scan-pass-holder')).toHaveText('Mariam Keïta');
    await expect(result.getByTestId('scan-pass-photo')).toBeVisible();
    await scan(page, dynamicQr);
    await expect(result).toHaveAttribute('data-result', 'REFUSED', NETWORK_WAIT);
    const forged = dynamicQr.slice(0, -1) + (dynamicQr.endsWith('A') ? 'B' : 'A');
    await scan(page, forged);
    await expect(result).toHaveAttribute('data-result', 'REFUSED', NETWORK_WAIT);
    await expect(result).not.toContainText('Mariam');

    // Fiche : suspension (motif obligatoire), réactivation, carte physique préparée pour Ocall Print.
    await page.goto(passUrl);
    await page.getByRole('button', { name: 'Suspendre' }).click();
    const reason = page.getByRole('dialog', { name: 'Suspendre le pass' });
    await expect(reason.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    await reason.getByLabel('Motif (obligatoire)').fill('Voyage du titulaire');
    await reason.getByRole('button', { name: 'Confirmer' }).click();
    await expect(reason).toBeHidden(NETWORK_WAIT);
    await expect(page.getByText('Voyage du titulaire').first()).toBeVisible();
    await page.getByRole('button', { name: 'Réactiver' }).click();
    await expect(page.getByRole('button', { name: 'Suspendre' })).toBeVisible(NETWORK_WAIT);
    await page.getByRole('button', { name: 'Émettre une carte' }).click();
    await expect(page.getByRole('button', { name: 'Préparer l’impression' })).toBeVisible(
      NETWORK_WAIT,
    );
    await expect(page.getByRole('button', { name: 'Émettre une carte' })).toBeHidden();
    await page.getByRole('button', { name: 'Préparer l’impression' }).click();
    const print = page.getByRole('dialog', { name: 'Carte prête pour Ocall Print' });
    await expect(print).toContainText('ocall-print/pass-card@1', NETWORK_WAIT);
    await expect(print).toContainText('Mariam Keïta');
    const cardQr = (await print.locator('img[data-qr]').getAttribute('data-qr'))!;
    expect(cardQr).toMatch(/^OCPC-/);
    await print.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await expect(page.getByText('Carte préparée pour impression')).toBeVisible();

    // Révocation du lien : la page du titulaire devient invalide.
    await page.getByRole('button', { name: 'Révoquer le lien' }).click();
    await expect(page.getByText('Aucun lien personnel actif.')).toBeVisible(NETWORK_WAIT);
    await holderPage.reload();
    await expect(holderPage.getByText('Lien invalide ou révoqué')).toBeVisible(NETWORK_WAIT);
    await holder.close();

    // Le titulaire figure dans la liste ; aucun débordement sur bureau.
    await page.goto('/app/billetterie/pass');
    await expect(page.getByRole('link', { name: /Mariam Keïta/ })).toBeVisible(NETWORK_WAIT);
    await expectNoHorizontalOverflow(page);
  });

  test.describe('téléphone', () => {
    const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
    void _ignored;
    test.use(pixel7);

    test('téléphone : vente d’un pass journalier au QR fixe, contrôle, pages sans débordement', async ({
      page,
    }) => {
      await signupOrganization(page, {
        metier: 'Parc',
        orgName: 'Aqua Mobile',
        email: uniqueEmail('passmobile'),
      });
      const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
      await apiPost(page, '/pass-offers', {
        kind: 'DAY',
        name: 'Journée',
        price: 3000,
        sites: [{ establishmentId: establishment.id }],
      });

      await page.goto('/app/billetterie/pass');
      await openCashRegister(page);
      await page.getByRole('button', { name: /Journée/ }).click();
      await newCustomer(page, 'Ibrahim', 'Sanogo');
      await page.getByRole('button', { name: 'Encaisser', exact: true }).click();
      await pay(page, '5000');
      const sold = page.getByRole('dialog', { name: 'Pass vendu' });
      const qrImg = sold.locator('img[data-qr]').first();
      await expect(qrImg).toBeVisible(NETWORK_WAIT);
      const staticQr = (await qrImg.getAttribute('data-qr'))!;
      expect(staticQr).toMatch(/^OCPS-/);
      await sold.getByRole('button', { name: 'Nouvelle vente' }).click();
      await expectNoHorizontalOverflow(page);

      // Navigation du bas : l'onglet « Pass » est présent sur téléphone.
      await expect(page.getByRole('link', { name: 'Pass', exact: true })).toBeVisible();

      await page.goto('/app/controle-acces');
      await scan(page, staticQr);
      const result = page.getByTestId('scan-result');
      await expect(result).toHaveAttribute('data-result', 'ACCEPTED', NETWORK_WAIT);
      await expect(result.getByTestId('scan-pass-holder')).toHaveText('Ibrahim Sanogo');
      await scan(page, staticQr);
      await expect(result).toHaveAttribute('data-result', 'REFUSED', NETWORK_WAIT);
      await expect(result).toContainText('entrée du jour déjà utilisée');

      await page.goto('/app/billetterie/pass');
      await page.getByRole('link', { name: /Ibrahim Sanogo/ }).click();
      await expect(page.getByTestId('pass-holder-name')).toHaveText('Ibrahim Sanogo', NETWORK_WAIT);
      await expectNoHorizontalOverflow(page);
    });
  });
});
