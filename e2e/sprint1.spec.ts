import { expect, test } from '@playwright/test';
import { PASSWORD, login, sidebar, signupOrganization, uniqueEmail } from './support';

test.describe('Sprint 1 — parcours propriétaire', () => {
  test('inscription, accès au tableau de bord, déconnexion puis connexion', async ({ page }) => {
    const email = uniqueEmail('owner');
    await signupOrganization(page, { metier: 'Parc', orgName: 'Aqua Splash', email });

    await expect(page.getByRole('heading', { name: 'Bonjour Awa' })).toBeVisible();
    await expect(page.getByText('Établissements actifs')).toBeVisible();
    await expect(page.getByText('Revenus Parc')).toBeVisible();

    // Navigation PARK : modules parc annoncés « à venir », aucun module restaurant.
    const nav = sidebar(page).first();
    await expect(nav.getByRole('link', { name: /Billetterie/ })).toContainText('À venir');
    await expect(nav.getByRole('link', { name: /Caisse POS/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/connexion/);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/connexion/);

    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'Bonjour Awa' })).toBeVisible();
  });

  test('employé : mot de passe initial imposé, navigation et accès restreints', async ({
    page,
    browser,
  }) => {
    await signupOrganization(page, {
      metier: 'Restaurant',
      orgName: 'Chez Fanta',
      email: uniqueEmail('resto'),
    });

    // Navigation RESTAURANT : caisse et cuisine, pas de billetterie.
    const nav = sidebar(page).first();
    await expect(nav.getByRole('link', { name: /Caisse POS/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Billetterie/ })).toHaveCount(0);

    await page.goto('/app/employes');
    await page.getByRole('button', { name: 'Nouvel employé' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Prénom').fill('Moussa');
    await dialog.getByRole('textbox', { name: 'Nom', exact: true }).fill('Diarra');
    await dialog.getByLabel('Rôle').selectOption('CASHIER');
    await dialog.getByRole('button', { name: 'Créer le compte' }).click();

    const credentials = page.getByRole('dialog', { name: 'Identifiants de connexion' });
    const loginId = (await credentials.locator('dd').first().textContent())!.trim();
    const tempPassword = (await credentials
      .getByTestId('temporary-password')
      .textContent())!.trim();
    expect(loginId).toMatch(/-0002$/);

    const employeeContext = await browser.newContext();
    const employee = await employeeContext.newPage();
    await login(employee, loginId, tempPassword);
    await expect(employee).toHaveURL(/\/changer-mot-de-passe/);

    // Toute page de l'espace renvoie vers le changement imposé.
    await employee.goto('/app');
    await expect(employee).toHaveURL(/\/changer-mot-de-passe/);

    await employee.getByLabel('Mot de passe actuel').fill(tempPassword);
    await employee.getByLabel('Nouveau mot de passe').fill(PASSWORD);
    await employee.getByLabel('Confirmation').fill(PASSWORD);
    await employee.getByRole('button', { name: 'Enregistrer et continuer' }).click();
    await expect(employee).toHaveURL(/\/app$/);

    await expect(sidebar(employee).first().getByRole('link', { name: 'Employés' })).toHaveCount(0);
    await employee.goto('/app/employes');
    await expect(employee.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();

    // Module hors métier : refusé par l'API.
    await employee.goto('/app/modules/ticketing');
    await expect(employee.getByRole('heading', { name: 'Accès refusé' })).toBeVisible();
    await employeeContext.close();
  });

  test('connexion invalide : message générique', async ({ page }) => {
    await login(page, uniqueEmail('inconnu'), 'MauvaisMotDePasse1');
    await expect(page.getByText('Identifiant ou mot de passe incorrect.')).toBeVisible();
    await expect(page).toHaveURL(/\/connexion/);
  });
});
