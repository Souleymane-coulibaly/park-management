import { type Page, expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Sprint 8 — parcours IA dans le navigateur, avec le fournisseur SIMULÉ (AI_PROVIDER=simulated,
 * voir playwright.config.ts) : import de carte avec revue et publication, copilote, commande
 * vocale confirmée par l'employé, désactivation d'une fonctionnalité. Aucun appel IA réel.
 */

async function apiPost(page: Page, path: string, data: unknown) {
  const res = await page.request.post(`/api/v1${path}`, { data });
  expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

const NETWORK_WAIT = { timeout: 30_000 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sim = (value: unknown) => `OCALL-SIM:${JSON.stringify(value)}:FIN`;

test.describe('Sprint 8 — IA (fournisseur simulé)', () => {
  test.setTimeout(300_000);
  // Micro factice de Chromium : l'enregistrement fonctionne sans matériel.
  test.use({
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  });

  test('import de carte → copilote → commande vocale → désactivation', async ({ page }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Maquis IA',
      email: uniqueEmail('ia'),
    });
    const [establishment] = await (await page.request.get('/api/v1/establishments')).json();
    const category = await apiPost(page, '/catalog/categories', { name: 'Plats' });
    await apiPost(page, '/catalog/products', {
      name: 'Poulet braisé',
      categoryId: category.id,
      variants: [
        { name: 'Standard', prices: [{ establishmentId: establishment.id, price: 4000 }] },
      ],
    });

    // ─── Import de carte : revue, prix manquant saisi, publication confirmée ───
    await page.goto('/app/catalogue');
    await page.getByRole('link', { name: /Importer une carte/ }).click();
    await expect(page.getByRole('heading', { name: 'Importer une carte' })).toBeVisible();
    const menu = {
      readable: true,
      currency: 'FCFA',
      warnings: [],
      items: [
        {
          name: 'Yassa poulet',
          description: null,
          category: 'Plats du jour',
          price: 3500,
          priceText: '3 500 F',
          priceUncertain: false,
          variants: [],
          availability: null,
          sourceText: 'Yassa poulet 3 500 F',
          uncertain: false,
        },
        {
          name: 'Capitaine braisé',
          description: null,
          category: 'Plats du jour',
          price: null,
          priceText: null,
          priceUncertain: false,
          variants: [],
          availability: null,
          sourceText: 'Capitaine braisé',
          uncertain: false,
        },
      ],
    };
    await page.getByTestId('import-file').setInputFiles({
      name: 'carte.png',
      mimeType: 'image/png',
      buffer: Buffer.concat([PNG, Buffer.from(sim(menu), 'latin1')]),
    });
    await page.getByRole('button', { name: 'Analyser' }).click();
    const review = page.getByTestId('import-review');
    await expect(review.getByTestId('import-line')).toHaveCount(2, NETWORK_WAIT);
    await expect(review).toContainText('Prix absent du document');
    const publish = review.getByRole('button', { name: /Publier 2 ligne/ });
    await expect(publish).toBeDisabled();
    await review.getByTestId('import-line').nth(1).getByLabel('Prix (FCFA)').fill('5000');
    await publish.click();
    await expect(page.getByText('Import publié')).toBeVisible(NETWORK_WAIT);
    await page.goto('/app/catalogue');
    await expect(page.getByText('Capitaine braisé')).toBeVisible(NETWORK_WAIT);

    // ─── Copilote : chiffres du serveur et période affichée ───
    await page.goto('/app/copilot');
    await page
      .getByRole('button', { name: 'Quel est mon chiffre d’affaires aujourd’hui ?' })
      .click();
    const result = page.getByTestId('copilot-result').first();
    await expect(result).toContainText("Chiffre d'affaires", NETWORK_WAIT);
    await expect(result).toContainText("Aujourd'hui");
    await expect(result).toContainText('Aucune vente payée sur cette période.');

    // ─── Commande vocale : enregistrement, panier proposé, confirmation humaine ───
    await apiPost(page, '/cash-sessions', { establishmentId: establishment.id, openingFloat: 0 });
    await apiPost(page, '/restaurant/tables', {
      establishmentId: establishment.id,
      name: 'Table 5',
    });
    // Le micro factice ne dit rien : l'envoi est remplacé par un enregistrement simulé connu,
    // transmis tel quel au vrai serveur (transcription simulée), puis la revue se fait dans l'interface.
    await page.route('**/api/v1/ai/voice-orders', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const res = await page.request.post('/api/v1/ai/voice-orders', {
        multipart: {
          establishmentId: establishment.id,
          audio: {
            name: 'commande.webm',
            mimeType: 'audio/webm',
            buffer: Buffer.concat([
              Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
              Buffer.from(
                'OCALL-SIM:Deux poulets braisés et un tiramisu pour la table 5:FIN',
                'latin1',
              ),
            ]),
          },
        },
      });
      await route.fulfill({
        status: res.status(),
        contentType: 'application/json',
        body: await res.text(),
      });
    });
    await page.goto('/app/commandes');
    await page.getByRole('button', { name: 'Commande vocale' }).click(NETWORK_WAIT);
    const dialog = page.getByRole('dialog', { name: 'Commande vocale' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await dialog.getByRole('button', { name: 'Arrêter' }).click();
    const voice = dialog.getByTestId('voice-review');
    await expect(voice.getByTestId('voice-line')).toHaveCount(2, NETWORK_WAIT);
    await expect(voice).toContainText('Produit absent du catalogue');
    const validate = voice.getByRole('button', { name: 'Valider la commande' });
    // Produit inconnu : la commande ne peut pas être validée tant qu'il n'est pas choisi ou retiré.
    await expect(validate).toBeDisabled();
    await voice
      .getByTestId('voice-line')
      .nth(1)
      .getByRole('button', { name: 'Retirer la ligne' })
      .click();
    await expect(voice.getByLabel('Table')).toHaveValue(/.+/);
    await validate.click();
    await expect(
      page.getByText('Commande vocale enregistrée : non payée, non envoyée en cuisine.'),
    ).toBeVisible(NETWORK_WAIT);
    const orders = await (
      await page.request.get(`/api/v1/orders?establishmentId=${establishment.id}&view=active`)
    ).json();
    expect(orders).toEqual([
      expect.objectContaining({
        total: 8000,
        paymentStatus: 'UNPAID',
        preparationStatus: 'NOT_SENT',
      }),
    ]);

    // ─── Désactivation d'une fonctionnalité : on continue sans IA ───
    await page.goto('/app/parametres/ia');
    await page.getByLabel('Copilote analytique').uncheck();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible(NETWORK_WAIT);
    await expect(page.getByText(/Coûts ESTIMÉS/)).toBeVisible();
    await page.goto('/app/copilot');
    await expect(page.getByText('Fonctionnalité désactivée par votre administrateur')).toBeVisible(
      NETWORK_WAIT,
    );
    await expect(page.getByRole('link', { name: 'Voir le tableau de bord' })).toBeVisible();
  });
});
