import { expect, test } from '@playwright/test';
import { TINY_PNG, startFactureTrial } from './facture-support';
import { signupOrganization, uniqueEmail } from './support';

/**
 * Ocall Facture — site vitrine F5, parcours navigateur : offre « avec vitrine », création du site,
 * contenu et prestation du catalogue (prix affiché), logo, mise en ligne ; visite publique (données
 * structurées LocalBusiness, bouton WhatsApp) ; demande de devis d'un visiteur, reçue dans la boîte de
 * l'entreprise. Données fictives, bases de test locales jetables.
 */
test.skip(!process.env.TEST_FACTURE_DATABASE_URL, 'Base Facture de test absente.');

test('Ocall Facture : site vitrine publié, demande d’un visiteur reçue', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const email = uniqueEmail('facture-f5');
  const slug = `froid-${Date.now().toString(36)}`;
  await signupOrganization(page, { metier: 'Parc', orgName: 'Froid Services', email });
  await startFactureTrial(email, { showcase: true });

  await page.goto('/facture/parametres');
  await page
    .getByTestId('facture-settings-form')
    .getByRole('button', { name: 'Enregistrer' })
    .click();
  await expect(page.getByText('Identité de l’entreprise enregistrée.')).toBeVisible();

  await page.goto('/facture/catalogue');
  const itemForm = page.getByTestId('facture-item-form');
  await itemForm.getByLabel('Désignation').fill('Entretien climatiseur');
  await itemForm.getByLabel('Prix unitaire HT (FCFA)').fill('25000');
  await itemForm.getByRole('button', { name: 'Ajouter au catalogue' }).click();
  await expect(page.getByTestId('facture-item-list')).toContainText('Entretien climatiseur');

  // Création du site, contenu, prestation (prix affiché), logo.
  await page.goto('/facture/site');
  await page.getByLabel('Adresse du site').fill(slug);
  await page.getByRole('button', { name: 'Créer le site' }).click();
  const content = page.getByTestId('facture-site-content');
  await content.getByLabel('Titre principal').fill('Climatisation et froid à Bamako');
  await content.getByLabel('Accroche').fill('Installation, entretien, dépannage');
  await content.getByLabel('WhatsApp (+223 …)').fill('+223 70 11 22 33');
  await content.getByLabel('Ville').fill('Bamako');
  await content.getByLabel('Couleur principale du site').fill('#7c2d12');
  await content.getByLabel('Entretien climatiseur', { exact: true }).check();
  await content.getByLabel('Afficher le prix — Entretien climatiseur').check();
  await content.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(content.getByText('Brouillon enregistré.')).toBeVisible();
  await page.getByLabel('Type d’image').selectOption({ label: 'Logo' });
  await page
    .getByTestId('facture-site-media-input')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByTestId('facture-site-media').locator('img')).toHaveCount(1);
  await page.getByTestId('facture-site-publish').click();
  await expect(page.getByText('Site en ligne')).toBeVisible();

  // Visite publique, sans session.
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`/v/${slug}`);
  const site = pub.getByTestId('facture-site');
  await expect(site.getByRole('heading', { level: 1 })).toHaveText(
    'Climatisation et froid à Bamako',
  );
  await expect(pub.getByTestId('facture-site-services')).toContainText(/29\s500\sFCFA TTC/);
  // Mise en page des sites Park, à la couleur choisie ; lisible sur téléphone.
  await expect(site).toHaveAttribute('style', /--brand:\s*#7c2d12/i);
  if (process.env.E2E_SHOTS) {
    await pub.screenshot({
      path: `${process.env.E2E_SHOTS}/facture-vitrine-bureau.png`,
      fullPage: true,
    });
  }
  await pub.setViewportSize({ width: 390, height: 844 });
  expect(await pub.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (process.env.E2E_SHOTS) {
    await pub.screenshot({
      path: `${process.env.E2E_SHOTS}/facture-vitrine-telephone.png`,
      fullPage: true,
    });
  }
  await pub.setViewportSize({ width: 1280, height: 900 });
  await expect(pub.getByTestId('facture-site-whatsapp')).toHaveAttribute(
    'href',
    'https://wa.me/22370112233',
  );
  const ld = JSON.parse((await pub.locator('script[type="application/ld+json"]').textContent())!);
  expect(ld['@type']).toBe('LocalBusiness');
  expect(ld.name).toMatch(/^Froid Services/);
  await expect(pub).toHaveTitle(/^Froid Services.* — Bamako$/);

  // Demande de devis (durée minimale de saisie respectée).
  const form = pub.getByTestId('facture-site-request-form');
  await form.getByLabel('Objet').selectOption({ label: 'Demande de devis' });
  await form.getByLabel('Votre nom').fill('Awa Traoré');
  await form.getByLabel('Téléphone').fill('+223 76 00 00 01');
  await form.getByLabel('Message').fill('Devis pour deux climatiseurs, svp.');
  await pub.waitForTimeout(3_500);
  await form.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(pub.getByTestId('facture-site-request-sent')).toBeVisible();
  await visitor.close();

  // Boîte des demandes de l'entreprise.
  await page.goto('/facture/demandes');
  const inbox = page.getByTestId('facture-requests');
  await expect(inbox).toContainText('Demande de devis · Awa Traoré');
  await expect(inbox).toContainText('Devis pour deux climatiseurs');
});
