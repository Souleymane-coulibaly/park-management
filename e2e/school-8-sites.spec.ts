import { deflateSync } from 'node:zlib';
import { type Page, devices, expect, test } from '@playwright/test';
import {
  type CreatedMember,
  chooseSchool,
  expectNoOverflow,
  loginTo,
  memberPage,
  requireSchool,
  seedSchoolClient,
  seeder,
} from './school-support';

/**
 * Ocall School — sites vitrines (Sprint 10) : création et publication depuis l'administration, pages
 * publiques servies par sous-domaine LOCAL (`<slug>.ecoles.localhost`, résolu par Chromium sans DNS),
 * français et arabe de droite à gauche, réseaux sociaux et bouton WhatsApp, retrait immédiat d'une
 * photo, dépublication, routes privées introuvables sur un hôte de site. Données fictives.
 * Ne prouve RIEN sur le DNS ni le certificat réels (voir docs/SITES-VITRINES-SCHOOL.md).
 */
requireSchool();
test.use({ acceptDownloads: true });

const PORT = 3000;
const siteUrl = (slug: string, path = '/') => `http://${slug}.ecoles.localhost:${PORT}${path}`;

/** Image PNG unie (sans dépendance), assez grande pour être acceptée (64 px au moins). */
function png(width = 320, height = 200, rgb: [number, number, number] = [30, 120, 90]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profondeur
  header[9] = 2; // RVB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)]);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Requête HTTP émise par le navigateur : le client HTTP de Node ne résout pas `*.localhost` sous
 * Windows, Chromium oui. Statut, type et corps de la réponse d'une navigation dédiée.
 */
async function browserGet(page: Page, url: string) {
  const res = await page.goto(url);
  return {
    status: res?.status() ?? 0,
    type: res?.headers()['content-type'] ?? '',
    text: async () => (res ? res.text() : ''),
  };
}

async function openTab(page: Page, name: RegExp) {
  await page.getByRole('tab', { name }).click();
}

test('site vitrine : création, contenus FR/AR, liens, photo, publication, sous-domaine, retrait, dépublication', async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await seedSchoolClient(request, 'site');
  await loginTo(page, client.email);
  const call = seeder(page);
  const school = await call('/school/schools', 'POST', {
    type: 'FRANCO_ARABIC',
    countryCode: 'SN',
    name: 'Medersa Annour',
    nameAr: 'مدرسة النور',
    defaultLocale: 'BILINGUAL',
  });
  const teacher = await call<CreatedMember>('/school/members', 'POST', {
    firstName: 'Seydou',
    lastName: 'Diallo',
    role: 'TEACHER',
    schoolIds: [school.id],
  });
  await chooseSchool(page, school.id);
  const slug = `annour-${Date.now().toString(36)}`;

  // ─── Création par la direction ───
  await page.goto('/school/site');
  const create = page.getByTestId('site-create');
  await create.getByLabel('Adresse du site').fill(slug);
  await create.getByRole('button', { name: 'Créer le site' }).click();
  await expect(page.getByTestId('site-public-url')).toHaveText(`https://${slug}.ecoles.localhost`, {
    timeout: 20_000,
  });
  await page.getByTestId('site-enable').click();
  await expect(page.getByText('Site activé')).toBeVisible({ timeout: 20_000 });

  // ─── Langues : français et arabe ───
  const settings = page.getByTestId('site-settings');
  await settings.getByLabel('Arabe').check();
  await settings.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await expect(page.getByText('Enregistré.')).toBeVisible({ timeout: 20_000 });

  // ─── Contenus (repli explicite : la mission n'existe qu'en français) ───
  await openTab(page, /Contenus/);
  const content = page.getByTestId('site-content');
  await content.getByLabel('Accroche — Français').fill('Apprendre ensemble, grandir ensemble');
  await content.getByLabel('Accroche — Arabe').fill('نتعلم معا ونكبر معا');
  await content.getByLabel('Mission — Français').fill('Former des élèves curieux et responsables.');
  await content.getByLabel('Téléphone').fill('+221 33 800 00 00');
  await content.getByLabel('E-mail').fill('contact@annour.example.org');
  await content.getByTestId('site-save-draft').click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible({ timeout: 20_000 });

  // ─── Réseaux sociaux : http refusé, WhatsApp international, ordre ───
  await openTab(page, /Réseaux sociaux/);
  const linkForm = page.getByTestId('site-link-form');
  await linkForm.getByLabel('Adresse https ou numéro WhatsApp').fill('http://facebook.com/annour');
  await linkForm.getByRole('button', { name: 'Ajouter le lien' }).click();
  await expect(page.getByText(/https:\/\/ valide/)).toBeVisible({ timeout: 20_000 });
  await linkForm
    .getByLabel('Adresse https ou numéro WhatsApp')
    .fill('https://www.facebook.com/annour');
  await linkForm.getByRole('button', { name: 'Ajouter le lien' }).click();
  await expect(page.getByTestId('site-link')).toHaveCount(1, { timeout: 20_000 });
  await linkForm.getByLabel('Réseau').selectOption('WHATSAPP');
  await linkForm.getByLabel('Adresse https ou numéro WhatsApp').fill('+221 77 000 00 00');
  await linkForm.getByRole('button', { name: 'Ajouter le lien' }).click();
  await expect(page.getByTestId('site-link')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId('site-links')).toContainText('https://wa.me/221770000000');
  // WhatsApp placé en tête.
  await page.getByRole('button', { name: /Monter — WhatsApp/ }).click();
  await expect(page.getByTestId('site-link').first()).toContainText('WhatsApp', {
    timeout: 20_000,
  });

  // ─── Photo avec des mineurs : attestation obligatoire, puis galerie ───
  await openTab(page, /Photos/);
  const upload = page.getByTestId('site-media-upload');
  await upload
    .locator('input[type=file]')
    .setInputFiles({ name: 'kermesse.png', mimeType: 'image/png', buffer: png() });
  await upload.getByLabel('Description (français)').fill('Kermesse de fin d’année');
  await upload.getByLabel(/mineurs figurent/).check();
  await expect(upload.getByRole('button', { name: 'Envoyer la photo' })).toBeDisabled();
  await expect(upload.getByText(/ne remplace pas les autorisations écrites/)).toBeVisible();
  await upload
    .getByLabel('Référence de l’autorisation parentale détenue')
    .fill('Registre 2026 n°12');
  await upload.getByRole('button', { name: 'Envoyer la photo' }).click();
  const item = page.getByTestId('site-media-item').first();
  await expect(item).toContainText('Mineurs : autorisation déclarée', { timeout: 30_000 });
  await item.getByLabel('Dans la galerie').check();
  await expect(item.getByLabel('Dans la galerie')).toBeChecked({ timeout: 20_000 });

  // ─── Prévisualisation du brouillon, puis publication ───
  await page.getByTestId('site-preview').click();
  await expect(page.getByTestId('site-preview-frame')).toContainText('Apprendre ensemble', {
    timeout: 20_000,
  });
  await page.getByTestId('site-preview-close').click();
  await page.getByTestId('site-publish').click();
  await expect(page.getByText('Site publié.')).toBeVisible({ timeout: 20_000 });

  // ─── Site public sur son sous-domaine local ───
  const visitor = await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
  const pub = await visitor.newPage();
  pub.on('pageerror', (e) => errors.push(`public : ${e.message}`));
  await pub.goto(siteUrl(slug));
  await expect(pub.getByTestId('site-name')).toHaveText('Medersa Annour');
  await expect(pub.getByText('Apprendre ensemble, grandir ensemble')).toBeVisible();
  await expect(pub.locator('[data-school-site-lang="fr"]')).toHaveAttribute('dir', 'ltr');
  // Liens externes isolés : nouvel onglet, noopener noreferrer ; ordre choisi ; bouton WhatsApp.
  const socials = pub.getByTestId('site-socials').first().locator('a');
  await expect(socials).toHaveCount(2);
  await expect(socials.first()).toHaveAttribute('href', 'https://wa.me/221770000000');
  for (const a of await socials.all()) {
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(pub.getByRole('link', { name: 'Écrire sur WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/221770000000',
  );
  await expectNoOverflow(pub);

  // Arabe : de droite à gauche ; la mission non traduite s'affiche en français, signalée.
  await pub.getByTestId('site-lang-switch').click();
  await expect(pub).toHaveURL(siteUrl(slug, '/ar'));
  await expect(pub.locator('[data-school-site-lang="ar"]')).toHaveAttribute('dir', 'rtl');
  await expect(pub.getByText('نتعلم معا ونكبر معا')).toBeVisible();
  await expectNoOverflow(pub);
  await pub.goto(siteUrl(slug, '/ar/a-propos'));
  const mission = pub.locator('[data-fallback="true"]').first();
  await expect(mission).toHaveAttribute('lang', 'fr');
  await expect(mission).toHaveAttribute('dir', 'ltr');
  await expect(mission).toContainText('Former des élèves curieux');
  await expect(mission).toContainText('النص متوفر بالفرنسية فقط');

  // Galerie : image servie par l'API, réencodée en WebP.
  await pub.goto(siteUrl(slug, '/galerie'));
  const img = pub.getByTestId('site-gallery').locator('img').first();
  await expect(img).toBeVisible();
  const src = (await img.getAttribute('src'))!;
  const probe = await visitor.newPage();
  const imgRes = await browserGet(probe, siteUrl(slug, src));
  expect(imgRes.status).toBe(200);
  expect(imgRes.type).toBe('image/webp');

  // Contact : téléphone, e-mail, WhatsApp et réseaux sociaux.
  await pub.goto(siteUrl(slug, '/contact'));
  const contact = pub.getByTestId('site-contact');
  await expect(contact.getByRole('link', { name: '+221 33 800 00 00' })).toHaveAttribute(
    'href',
    'tel:+221338000000',
  );
  await expect(contact.getByRole('link', { name: 'contact@annour.example.org' })).toHaveAttribute(
    'href',
    'mailto:contact@annour.example.org',
  );

  // SEO : métadonnées, versions linguistiques, plan du site de cet hôte seulement.
  await pub.goto(siteUrl(slug));
  await expect(pub).toHaveTitle('Medersa Annour');
  await expect(pub.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
    'href',
    `https://${slug}.ecoles.localhost/ar`,
  );
  const sitemap = await (await browserGet(probe, siteUrl(slug, '/sitemap.xml'))).text();
  expect(sitemap).toContain(`https://${slug}.ecoles.localhost/a-propos`);
  expect(sitemap).toContain(`https://${slug}.ecoles.localhost/ar/galerie`);
  expect(sitemap).not.toContain('/solutions');

  // Hôte de site : routes privées, API privée et pages inconnues introuvables ; sous-domaine inconnu.
  for (const path of ['/school', '/connexion', '/app', '/s/autre', '/e/autre', '/inconnu']) {
    expect((await browserGet(probe, siteUrl(slug, path))).status, path).toBe(404);
  }
  expect((await browserGet(probe, siteUrl(slug, '/api/v1/school/context'))).status).toBe(404);
  expect((await browserGet(probe, siteUrl('site-inexistant-e2e'))).status).toBe(404);

  // ─── Retrait immédiat de la photo : la page publique ne la montre plus, le fichier est supprimé ───
  // Confirmation, puis motif du retrait.
  page.on(
    'dialog',
    (d) => void (d.type() === 'prompt' ? d.accept('Demande de la famille') : d.accept()),
  );
  await openTab(page, /Photos/);
  await page.getByTestId('site-media-withdraw').first().click();
  await expect(page.getByTestId('site-media-item').first()).toContainText('Retirée', {
    timeout: 20_000,
  });
  // Serveur interrogé sans le cache du navigateur (une image déjà vue y reste au plus 5 minutes).
  await probe.goto(siteUrl(slug, '/contact'));
  const after = await probe.evaluate(
    async (u) => (await fetch(u, { cache: 'no-store' })).status,
    src,
  );
  expect(after).toBe(404);
  await pub.goto(siteUrl(slug, '/galerie'));
  await expect(pub.getByText('Aucune photo pour le moment.')).toBeVisible({ timeout: 20_000 });

  // ─── Enseignant : aucun accès à l'administration du site ───
  const tpage = await memberPage(browser, teacher, school.id, errors);
  await tpage.goto('/school/site');
  await expect(tpage.getByText(/Vous n.avez pas les droits nécessaires/).first()).toBeVisible({
    timeout: 30_000,
  });
  await tpage.context().close();

  // ─── Dépublication : le site sort du public, non indexable ───
  await openTab(page, /Publication et apparence/);
  await page.getByTestId('site-unpublish').click();
  await expect(page.getByText('Site retiré du public.')).toBeVisible({ timeout: 20_000 });
  await pub.goto(siteUrl(slug));
  await expect(pub.getByText('Ce site est momentanément indisponible.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(pub.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await visitor.close();
  expect(errors).toEqual([]);
});
