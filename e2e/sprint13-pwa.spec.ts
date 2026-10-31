import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 13 — PWA du parc : installation, caméra, réseau instable, navigation mobile. Vente et QR
 * réels sur la base de test. L'installation effective et la caméra d'un vrai téléphone relèvent de la
 * recette manuelle (docs/PWA-PARC.md).
 */
const NETWORK_WAIT = { timeout: 30_000 };
const FAKE_CAMERA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// Option de lancement du navigateur : uniquement au niveau du fichier (elle impose un nouveau worker).
test.use({ launchOptions: { args: FAKE_CAMERA } });

const json = async (page: Page, path: string, data: unknown) => {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
};

/** Parc avec un billet payé par visiteur demandé ; renvoie les QR. */
async function parkWithTickets(page: Page, visitors: string[]): Promise<string[]> {
  await signupOrganization(page, {
    metier: 'Parc',
    orgName: 'Aqua PWA',
    email: uniqueEmail('pwa'),
  });
  const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
  const category = await json(page, '/ticketing/categories', {
    establishmentId: establishment.id,
    kind: 'ADULT',
    name: 'Adulte',
    price: 3000,
  });
  await json(page, '/cash-sessions', { establishmentId: establishment.id, openingFloat: 0 });
  const sale = await json(page, '/ticketing/orders', {
    establishmentId: establishment.id,
    lines: [{ ticketCategoryId: category.id, quantity: visitors.length, visitorNames: visitors }],
  });
  await json(page, `/sales/${sale.id}/payments`, { method: 'CASH', amountTendered: sale.total });
  const tickets = await (await page.request.get(`/api/v1/tickets?saleId=${sale.id}`)).json();
  return tickets.map((t: { qr: string }) => t.qr);
}

const submitCode = async (page: Page, qr: string) => {
  await page.getByLabel('Saisie manuelle du code').fill(qr);
  await page.getByRole('button', { name: 'Valider', exact: true }).click();
};

test.describe('Sprint 13 — PWA du parc', () => {
  test.setTimeout(180_000);

  test('installable : manifeste, icônes, métadonnées iPhone', async ({ page, request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    await page.goto('/connexion');
    const apple = page.locator('link[rel="apple-touch-icon"]');
    await expect(apple).toHaveAttribute('href', /apple-touch-icon\.png/);
    expect((await request.get((await apple.getAttribute('href'))!)).status()).toBe(200);
    const splash = await page
      .locator('link[rel="apple-touch-startup-image"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href')!));
    expect(splash.length).toBe(5);
    for (const href of splash) expect((await request.get(href)).status(), href).toBe(200);
    const sw = await request.get('/sw.js');
    expect(sw.headers()['content-type']).toContain('javascript');
    expect(sw.headers()['cache-control']).toContain('no-cache');
  });

  test('Service Worker : page hors ligne, reprise, et aucune donnée applicative en cache', async ({
    page,
    context,
  }) => {
    await parkWithTickets(page, ['Awa']);
    await page.goto('/app/parc/parametres');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), NETWORK_WAIT)
      .toBe(true);

    // Navigation pendant la coupure : page explicative, à l'adresse demandée.
    await context.setOffline(true);
    await page.goto('/app/controle-acces');
    await expect(page.getByRole('heading', { name: 'Pas de connexion' })).toBeVisible();
    await expect(page.getByText('Aucune entrée ne peut être validée')).toBeVisible();

    // Retour du réseau : la page demandée revient d'elle-même.
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Contrôle des entrées' })).toBeVisible(
      NETWORK_WAIT,
    );

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const r of await cache.keys()) urls.push(new URL(r.url).pathname);
      }
      return urls;
    });
    expect(cached).toContain('/hors-ligne');
    const forbidden = cached.filter(
      (u) => !u.startsWith('/_next/static/') && !u.startsWith('/icons/') && u !== '/hors-ligne',
    );
    expect(forbidden).toEqual([]);
  });

  test('le scanner obtient le flux de la caméra', async ({ page }) => {
    await parkWithTickets(page, ['Awa']);
    await page.goto('/app/controle-acces');
    await page.getByRole('button', { name: 'Activer la caméra' }).click();
    await expect(page.getByRole('button', { name: 'Arrêter la caméra' })).toBeVisible(NETWORK_WAIT);
    await expect(page.getByText('Accès à la caméra refusé')).toBeHidden();
  });

  test.describe('réseau simulé', () => {
    // Playwright n'intercepte pas de façon fiable les requêtes d'une page contrôlée par un Service Worker.
    test.use({ serviceWorkers: 'block' });

    test('réponse perdue : orange, puis résultat initial sans faux « déjà utilisé »', async ({
      page,
    }) => {
      const [qr] = await parkWithTickets(page, ['Awa']);
      await page.goto('/app/controle-acces');
      const result = page.getByTestId('scan-result');

      // Le serveur enregistre l'entrée, mais la réponse n'arrive jamais à l'appareil.
      const keys: string[] = [];
      await page.route('**/api/v1/access/scans', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        keys.push(route.request().postDataJSON().clientRequestId);
        await route.fetch();
        await route.abort('connectionfailed');
      });
      await submitCode(page, qr!);
      await expect(result).toHaveAttribute('data-result', 'UNCERTAIN', NETWORK_WAIT);
      await expect(result).toContainText('Ne laissez pas entrer');
      await expect(result).toContainText('a peut-être été enregistrée');
      await expect(page.getByText('Entrée autorisée')).toBeHidden();

      await page.unroute('**/api/v1/access/scans');
      await page.route('**/api/v1/access/scans', async (route) => {
        if (route.request().method() === 'POST') {
          keys.push(route.request().postDataJSON().clientRequestId);
        }
        await route.fallback();
      });
      await page.getByRole('button', { name: 'Vérifier à nouveau' }).click();
      await expect(result).toHaveAttribute('data-result', 'ACCEPTED', NETWORK_WAIT);
      await expect(result).toContainText('Awa');
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
    });

    test('serveur muet : l’agent n’attend pas plus de 10 s et n’obtient jamais de vert', async ({
      page,
    }) => {
      const [qr] = await parkWithTickets(page, ['Awa']);
      await page.goto('/app/controle-acces');
      await page.route('**/api/v1/access/scans', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        await route.abort().catch(() => undefined);
      });
      await submitCode(page, qr!);
      const started = Date.now();
      await expect(page.getByTestId('scan-result')).toHaveAttribute('data-result', 'UNCERTAIN', {
        timeout: 15_000,
      });
      expect(Date.now() - started).toBeLessThan(12_000);
    });

    test('Wi-Fi sans Internet : serveur injoignable détecté malgré navigator.onLine', async ({
      page,
    }) => {
      await parkWithTickets(page, ['Awa']);
      await page.goto('/app/controle-acces');
      await expect(page.getByRole('button', { name: 'Activer la caméra' })).toBeVisible(
        NETWORK_WAIT,
      );
      await page.route('**/api/v1/health', (route) => route.abort('connectionfailed'));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.getByTestId('connectivity-badge')).toBeVisible(NETWORK_WAIT);
      await page.unroute('**/api/v1/health');
      await expect(page.getByTestId('connectivity-badge')).toBeHidden(NETWORK_WAIT);
    });

    test('une seule réponse lente ou en échec ne déclare pas de coupure', async ({ page }) => {
      await parkWithTickets(page, ['Awa']);
      await page.goto('/app/controle-acces');
      await expect(page.getByRole('button', { name: 'Activer la caméra' })).toBeVisible(
        NETWORK_WAIT,
      );
      let failed = 0;
      await page.route('**/api/v1/health', async (route) => {
        if (failed++ === 0) return route.abort('connectionfailed');
        return route.fallback();
      });
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => failed, NETWORK_WAIT).toBeGreaterThanOrEqual(2);
      await expect(page.getByTestId('connectivity-badge')).toBeHidden();
    });
  });

  test('coupure puis reconnexion : indicateur, blocage, reprise automatique', async ({
    page,
    context,
  }) => {
    const [qr] = await parkWithTickets(page, ['Awa']);
    await page.goto('/app/controle-acces');
    await context.setOffline(true);
    await expect(page.getByTestId('connectivity-badge')).toBeVisible();
    await expect(page.getByTestId('scan-result')).toHaveAttribute('data-result', 'UNCERTAIN');
    await page.getByLabel('Saisie manuelle du code').fill(qr!);
    await expect(page.getByRole('button', { name: 'Valider', exact: true })).toBeDisabled();

    await context.setOffline(false);
    await expect(page.getByTestId('connectivity-badge')).toBeHidden(NETWORK_WAIT);
    await page.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect(page.getByTestId('scan-result')).toHaveAttribute(
      'data-result',
      'ACCEPTED',
      NETWORK_WAIT,
    );
  });

  test('responsable : visiteurs, historique et billets encore valables', async ({ page }) => {
    const [qr] = await parkWithTickets(page, ['Awa', 'Seydou']);
    await page.goto('/app/controle-acces');
    await submitCode(page, qr!);
    await expect(page.getByTestId('scan-result')).toHaveAttribute(
      'data-result',
      'ACCEPTED',
      NETWORK_WAIT,
    );

    await page.goto('/app/parc/visiteurs');
    await expect(page.getByTestId('visitors-total')).toHaveText('2', NETWORK_WAIT);
    await page.getByLabel('Prénom ou n° de vente').fill('seyd');
    await expect(page.getByTestId('visitors-total')).toHaveText('1', NETWORK_WAIT);
    await expect(page.getByTestId('visitors-list')).toContainText('Seydou');

    await page.goto('/app/parc/historique');
    await expect(page.getByTestId('scan-history').locator('li')).toHaveCount(1, NETWORK_WAIT);

    await page.goto('/app/billetterie/tableau');
    await expect(page.getByTestId('park-valid-unused')).toHaveText('1', NETWORK_WAIT);
  });

  for (const [name, viewport] of [
    ['téléphone', { width: 390, height: 844 }],
    ['tablette', { width: 820, height: 1180 }],
  ] as const) {
    test(`barre mobile sur ${name} : gros boutons, aucun débordement, pages accessibles`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await parkWithTickets(page, ['Awa']);
      const hrefs = ['/app/controle-acces', '/app/billetterie', '/app/parc/parametres'];
      for (const href of hrefs) {
        await page.goto(href);
        const nav = page.getByTestId('park-mobile-nav');
        await expect(nav).toBeVisible(NETWORK_WAIT);
        const boxes = await nav
          .locator('a, button')
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        for (const height of boxes) expect(height).toBeGreaterThanOrEqual(44);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, href).toBeLessThanOrEqual(0);
      }
    });
  }

  test('agent d’entrée : seuls le scanner, les entrées et les paramètres sont proposés', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await parkWithTickets(page, ['Awa']);
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const created = await json(page, '/employees', {
      firstName: 'Fanta',
      lastName: 'Agent',
      role: 'GATE_AGENT',
      establishmentIds: [establishment.id],
    });
    await page.request.post('/api/v1/auth/logout');
    await page.goto('/connexion');
    await page.getByLabel('E-mail ou identifiant').fill(created.employee.loginId);
    await page.getByLabel('Mot de passe').fill(created.temporaryPassword);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL(/changer-mot-de-passe/, NETWORK_WAIT);
    await page.request.post('/api/v1/auth/change-password', {
      data: { currentPassword: created.temporaryPassword, newPassword: 'Bamako2026Secure' },
    });
    await page.goto('/app/controle-acces');
    const nav = page.getByTestId('park-mobile-nav');
    await expect(nav).toBeVisible(NETWORK_WAIT);
    await expect(nav.locator('a')).toHaveText(['Scanner', 'Entrées', 'Paramètres']);
    await page.goto('/app/parc/visiteurs');
    await expect(page.getByTestId('visitors-list')).toBeHidden();
    const res = await page.request.get(
      `/api/v1/tickets/search?establishmentId=${establishment.id}`,
    );
    expect(res.status()).toBe(403);
  });
});
