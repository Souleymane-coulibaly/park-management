import { expect, test } from '@playwright/test';
import { signupOrganization, uniqueEmail } from './support';

/** Montant FCFA tel qu'affiché (espace fine insécable entre les milliers). */
const fcfa = (digits: string) =>
  new RegExp(`${digits.replace(/(\d)(?=(\d{3})+$)/g, '$1\\s?')} FCFA`);

test.describe('Sprint 2 — caisse POS', () => {
  test('catalogue, ouverture de caisse, vente, encaissement en espèces et fermeture avec écart', async ({
    page,
  }) => {
    // Parcours complet (catalogue → caisse → fermeture → historique → tableau de bord) : budget dédié.
    test.setTimeout(150_000);
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Chez Awa',
      email: uniqueEmail('pos'),
    });

    // Catalogue : une catégorie et un produit à deux variantes.
    await page.goto('/app/catalogue');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const categoryDialog = page.getByRole('dialog', { name: 'Nouvelle catégorie' });
    await categoryDialog.getByLabel('Nom').fill('Boissons');
    await categoryDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Boissons', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Nouveau produit' }).click();
    const productDialog = page.getByRole('dialog', { name: 'Nouveau produit' });
    await productDialog.getByLabel('Nom du produit').fill('Jus de bissap');
    await productDialog.getByLabel('Variante 1').fill('Petit');
    await productDialog.getByLabel(/^Prix/).first().fill('500');
    await productDialog.getByRole('button', { name: 'Ajouter une variante' }).click();
    await productDialog.getByLabel('Variante 2').fill('Grand');
    await productDialog.getByLabel(/^Prix/).nth(1).fill('1000');
    await productDialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Jus de bissap')).toBeVisible();

    // Ouverture de caisse avec un fond de 10 000 FCFA.
    await page.goto('/app/caisse');
    await page.getByLabel('Fond de caisse (FCFA)').fill('10000');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByTestId('expected-cash')).toHaveText(fcfa('10000'));

    // Ticket : Grand ×2 + Petit ×1 — total calculé par le serveur.
    await page
      .getByRole('region', { name: 'Articles' })
      .getByRole('button', { name: /Jus de bissap/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Jus de bissap' })
      .getByRole('button', { name: /Grand/ })
      .click();
    await page
      .getByRole('region', { name: 'Articles' })
      .getByRole('button', { name: /Jus de bissap/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Jus de bissap' })
      .getByRole('button', { name: /Petit/ })
      .click();
    await expect(page.getByTestId('cart-total')).toHaveText(fcfa('1500'));
    await page.getByRole('button', { name: 'Ajouter un Jus de bissap' }).first().click();
    await expect(page.getByTestId('cart-total')).toHaveText(fcfa('2500'));

    // Encaissement en espèces : 5 000 remis, 2 500 rendus (montant confirmé par le serveur).
    await page
      .getByRole('button', { name: 'Encaisser', exact: true })
      .filter({ visible: true })
      .click();
    const payment = page.getByRole('dialog', { name: /Encaisser la vente/ });
    await expect(payment.getByTestId('payment-total')).toHaveText(fcfa('2500'));
    await expect(payment.getByText('Non activé')).toBeVisible(); // Wave annoncé, non simulé
    await payment.getByLabel('Montant remis par le client (FCFA)').fill('5000');
    await payment.getByRole('button', { name: /Valider l.encaissement/ }).click();
    const receipt = page.getByRole('dialog', { name: 'Paiement enregistré' });
    await expect(receipt.getByTestId('change-given')).toHaveText(fcfa('2500'));
    await expect(receipt.getByText(/ne déclenche jamais la préparation/)).toBeVisible();
    await receipt.getByRole('button', { name: 'Nouvelle vente' }).click();
    await expect(page.getByTestId('expected-cash')).toHaveText(fcfa('12500'));

    // Fermeture : 12 000 comptés pour 12 500 attendus → écart de -500.
    await page.getByRole('button', { name: 'Fermer la caisse' }).click();
    const closing = page.getByRole('dialog', { name: 'Fermer la caisse' });
    await closing.getByLabel('Espèces comptées (FCFA)').fill('12000');
    await closing.getByRole('button', { name: 'Valider la fermeture' }).click();
    await expect(page.getByTestId('cash-variance')).toHaveText(fcfa('-500'));
    await page.getByRole('button', { name: 'Terminer' }).click();
    await expect(page.getByRole('button', { name: 'Ouvrir la caisse' })).toBeVisible();

    // Historique et sessions.
    await page.goto('/app/caisse/ventes');
    const row = page.getByRole('row', { name: /000001/ });
    await expect(row).toContainText('Payée');
    await expect(row).toContainText('Non envoyée en cuisine');
    await page.goto('/app/caisse/sessions');
    await expect(page.getByText(/Manque\s500\sFCFA/)).toBeVisible();

    // Tableau de bord : chiffre d'affaires réel du jour.
    await page.goto('/app');
    await expect(page.getByTestId('revenue-RESTAURANT-today')).toHaveText(fcfa('2500'));
  });

  test('écran de caisse utilisable sur tablette (portrait et paysage)', async ({ page }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Tablette',
      email: uniqueEmail('tab'),
    });
    await page.goto('/app/caisse');
    await page.getByLabel('Fond de caisse (FCFA)').fill('0');
    await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
    await expect(page.getByRole('button', { name: 'Fermer la caisse' })).toBeVisible();

    for (const viewport of [
      { width: 800, height: 1280 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(
        overflow,
        `défilement horizontal en ${viewport.width}×${viewport.height}`,
      ).toBeLessThanOrEqual(0);
      // Le bouton d'encaissement visible respecte une cible tactile d'au moins 44 px.
      const checkout = page
        .getByRole('button', { name: 'Encaisser', exact: true })
        .filter({ visible: true });
      const box = await checkout.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
