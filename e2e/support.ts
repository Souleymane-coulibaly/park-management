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

/** Aucun débordement horizontal, ni de la page, ni d'un bloc dans sa colonne. */
export async function expectNoHorizontalOverflow(page: Page) {
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
