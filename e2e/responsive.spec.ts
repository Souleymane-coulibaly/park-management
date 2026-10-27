import { expect, test } from '@playwright/test';

/** Pages publiques sur mobile : aucun défilement horizontal de la page. */
for (const path of ['/', '/metiers', '/fonctionnalites', '/tarifs', '/connexion', '/inscription']) {
  test(`pas de défilement horizontal sur mobile : ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
