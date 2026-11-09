import { type Page, expect } from '@playwright/test';

/** Marqueur des données E2E : toutes les organisations créées se terminent par ce suffixe. */
export const E2E_SUFFIX = 'E2E-OCP';
export const PASSWORD = 'Bamako2026Secure';
/** Domaine des comptes internes Ocall créés par les E2E (supprimés par global-teardown). */
export const E2E_INTERNAL_DOMAIN = '@e2e-internal.ocallpark.local';

export function uniqueEmail(label: string): string {
  return `${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.ocallpark.local`;
}

export async function signupOrganization(
  page: Page,
  opts: {
    metier: 'Parc' | 'Restaurant' | 'Parc + Restaurant';
    orgName: string;
    email: string;
    /** Code de recommandation d'un partenaire (lien `/inscription?ref=CODE`). */
    ref?: string;
  },
) {
  await page.goto(opts.ref ? `/inscription?ref=${opts.ref}` : '/inscription');
  await page.getByText(opts.metier, { exact: true }).click();
  await page.getByLabel('Nom commercial').fill(`${opts.orgName} ${E2E_SUFFIX}`);
  await page.getByLabel('Premier établissement').fill(`${opts.orgName} — Site principal`);
  await page.getByLabel('Prénom').fill('Awa');
  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill('Traoré');
  await page.getByLabel('E-mail professionnel').fill(opts.email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon organisation' }).click();
  // L'inscription est une transaction de plusieurs requêtes vers Neon : délai adapté au réseau.
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
}

export async function login(page: Page, identifier: string, password: string) {
  await page.goto('/connexion');
  await page.getByLabel('E-mail ou identifiant').fill(identifier);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

export function sidebar(page: Page) {
  return page.getByRole('navigation', { name: 'Navigation de l’espace' });
}
