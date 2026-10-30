import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  DOMAIN_VERIFIER,
  type SimulatedDomainVerifier,
} from '../src/modules/public-sites/domain-verifier';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  login,
  signup,
} from './helpers';

/**
 * Sprint 10 — sites vitrines : brouillon / publication, médias, menu et tarifs publics, isolation,
 * RBAC, slugs, sous-domaines, domaines personnalisés, SEO (plan du site), sécurité, suspension.
 *
 * Les vérifications DNS et HTTPS sont SIMULÉES (SITES_DOMAIN_VERIFIER=simulated, setup-env.ts) :
 * ces tests éprouvent les règles du serveur, pas un domaine réel. La procédure réelle est décrite
 * dans docs/SITES-VITRINES.md. Exécuté uniquement sur la base de test.
 */
describe('Sprint 10 — sites vitrines (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SimulatedDomainVerifier;
  let duo: SignedUpOwner;
  let other: SignedUpOwner;
  let estD: string;
  let estO: string;
  let admin: Agent;
  let supervisor: Agent;
  let superAdmin: Agent;
  let siteId: string;
  let productId: string;
  let ticketId: string;

  const api = (path: string) => `/api/v1${path}`;
  const publicGet = (path: string) => request(app.getHttpServer()).get(api(path));
  const PNG = (() => {
    const b = Buffer.alloc(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    b.set([0, 0, 0x04, 0x00, 0, 0, 0x03, 0x00], 16); // 1024 × 768
    return b;
  })();

  async function employee(owner: SignedUpOwner, role: string, establishmentIds: string[]) {
    const created = await owner.agent
      .post(api('/employees'))
      .send({ firstName: 'Awa', lastName: role, role, establishmentIds })
      .expect(201);
    const s = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await s.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return s.agent;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    verifier = app.get(DOMAIN_VERIFIER);
    duo = await signup(app, 's10d', 'PARK_RESTAURANT');
    other = await signup(app, 's10o', 'RESTAURANT');
    estD = (await duo.agent.get(api('/establishments')).expect(200)).body[0].id;
    estO = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    admin = await employee(duo, 'ADMIN', [estD]);
    supervisor = await employee(duo, 'SUPERVISOR', [estD]);

    const category = (
      await duo.agent.post(api('/catalog/categories')).send({ name: 'Grillades' }).expect(201)
    ).body.id;
    const mk = async (name: string, price: number) =>
      (
        await duo.agent
          .post(api('/catalog/products'))
          .send({
            name,
            categoryId: category,
            variants: [{ name: 'Standard', prices: [{ establishmentId: estD, price }] }],
          })
          .expect(201)
      ).body.id as string;
    productId = await mk('Poulet braisé', 4000);
    await mk('Repas du personnel', 500);
    ticketId = (
      await duo.agent
        .post(api('/ticketing/categories'))
        .send({ establishmentId: estD, kind: 'ADULT', name: 'Adulte', price: 3000 })
        .expect(201)
    ).body.id;

    const adminEmail = email('s10admin');
    await prisma.user.create({
      data: {
        email: adminEmail,
        loginId: adminEmail,
        firstName: 'Super',
        lastName: 'Admin',
        platformRole: 'SUPER_ADMIN',
        mustChangePassword: false,
        passwordHash: await hash(PASSWORD, { type: 2 }),
      },
    });
    superAdmin = (await login(app, adminEmail, PASSWORD)).agent;
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('1, 13, 14. création en brouillon ; slug unique ; slugs réservés', async () => {
    const slug = `baobab-${Date.now().toString(36)}`;
    const site = (
      await duo.agent.post(api('/sites')).send({ establishmentId: estD, slug }).expect(201)
    ).body;
    siteId = site.id;
    expect(site).toMatchObject({ status: 'DRAFT', isOnline: false });
    expect(
      (await other.agent.post(api('/sites')).send({ establishmentId: estO, slug }).expect(409)).body
        .code,
    ).toBe('SLUG_TAKEN');
    expect(
      (
        await other.agent
          .post(api('/sites'))
          .send({ establishmentId: estO, slug: 'admin' })
          .expect(400)
      ).body.code,
    ).toBe('SLUG_RESERVED');
    await publicGet(`/public/sites/${slug}`).expect(404); // brouillon jamais public
  });

  it('7. RBAC : superviseur sans accès ; administrateur publie mais ne gère pas le domaine', async () => {
    await supervisor.get(api(`/sites/${siteId}`)).expect(403);
    await admin.get(api(`/sites/${siteId}`)).expect(200);
    await admin
      .post(api(`/sites/${siteId}/domains`))
      .send({ hostname: 'www.exemple-s10.ml' })
      .expect(403);
  });

  it('6. isolation : une autre organisation ne lit, ne modifie ni ne publie ce site', async () => {
    await other.agent.get(api(`/sites/${siteId}`)).expect(404);
    await other.agent
      .put(api(`/sites/${siteId}/draft`))
      .send({ content: {} })
      .expect(404);
    await other.agent.post(api(`/sites/${siteId}/publish`)).expect(404);
    await other.agent
      .post(api('/sites'))
      .send({ establishmentId: estD, slug: 'pirate-s10' })
      .expect(404);
  });

  it('8, 9. upload d’images validé par le contenu ; SVG et fichier trop lourd refusés', async () => {
    const ok = await duo.agent
      .post(api(`/sites/${siteId}/media`))
      .field('kind', 'COVER')
      .field('alt', 'Terrasse')
      .attach('file', PNG, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(ok.body).toMatchObject({ mimeType: 'image/png', width: 1024, height: 768 });
    const svg = await duo.agent
      .post(api(`/sites/${siteId}/media`))
      .field('kind', 'GALLERY')
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(svg.body.code).toBe('MEDIA_TYPE_REFUSED');
    await duo.agent
      .post(api(`/sites/${siteId}/media`))
      .field('kind', 'GALLERY')
      .attach('file', Buffer.alloc(6 * 1024 * 1024), { filename: 'big.png' })
      .expect(413);
  });

  it('3, 4, 10, 11. brouillon (menu et tarif choisis), aperçu, non public avant publication', async () => {
    const site = (await duo.agent.get(api(`/sites/${siteId}`)).expect(200)).body;
    const cover = (await duo.agent.get(api(`/sites/${siteId}/media`)).expect(200)).body[0];
    const content = {
      ...site.draft,
      description: '<img src=x onerror=alert(1)> Grillades',
      menu: [{ productId, displayPrice: null }],
      tickets: [{ ticketCategoryId: ticketId, displayPrice: 2500 }],
      media: { logoId: null, coverId: cover.id, galleryIds: [] },
    };
    await duo.agent
      .put(api(`/sites/${siteId}/draft`))
      .send({ content })
      .expect(200);
    const bad = await duo.agent
      .put(api(`/sites/${siteId}/draft`))
      .send({ content: { ...content, costPrice: 1 } })
      .expect(400);
    expect(bad.body.code).toBe('SITE_CONTENT_INVALID');
    const preview = (await duo.agent.get(api(`/sites/${siteId}/preview`)).expect(200)).body;
    expect(preview.site.menu[0].items).toEqual([
      { name: 'Poulet braisé', description: null, price: 4000 },
    ]);
    await publicGet(`/public/sites/${site.slug}`).expect(404);
  });

  it('2, 12, 24. publication : version figée, aucune donnée interne, texte non interprété', async () => {
    const published = (await admin.post(api(`/sites/${siteId}/publish`)).expect(201)).body;
    expect(published).toMatchObject({ status: 'PUBLISHED', isOnline: true });
    const res = await publicGet(`/public/sites/${published.slug}`).expect(200);
    expect(res.headers['cache-control']).toContain('public');
    expect(res.body.state).toBe('PUBLISHED');
    expect(res.body.site.menu).toEqual([
      { category: 'Grillades', items: [{ name: 'Poulet braisé', description: null, price: 4000 }] },
    ]);
    expect(res.body.site.tickets[0]).toMatchObject({ name: 'Adulte', price: 2500 });
    const json = JSON.stringify(res.body);
    for (const secret of [
      'Repas du personnel',
      productId,
      ticketId,
      duo.organizationId,
      'draft',
      'unitCost',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(res.body.site.content.description).toBe('<img src=x onerror=alert(1)> Grillades');
    // Image publiée servie avec un type fixé et une politique de sécurité stricte.
    const img = await publicGet(res.body.site.cover.url.replace('/api/v1', '')).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('15, 20, 21. sous-domaine, adresse canonique et plan du site', async () => {
    const site = (await duo.agent.get(api(`/sites/${siteId}`)).expect(200)).body;
    expect(site.publicUrl).toBe(`https://${site.slug}.ocall-test.example.com`);
    const resolved = await publicGet(
      `/public/sites/resolve?host=${site.slug}.ocall-test.example.com`,
    ).expect(200);
    expect(resolved.body).toMatchObject({ slug: site.slug, siteId });
    await publicGet('/public/sites/resolve?host=www.ocall-test.example.com').expect(404);
    const sitemap = (
      await publicGet(`/public/sites/sitemap?host=${site.slug}.ocall-test.example.com`).expect(200)
    ).body;
    expect(sitemap.map((e: { url: string }) => e.url)).toEqual([site.publicUrl]);
  });

  it('16-19. domaine personnalisé : demande, preuve, rejet sans preuve, activation après HTTPS', async () => {
    const hostname = `www.baobab-${Date.now().toString(36)}.ml`;
    let site = (
      await duo.agent
        .post(api(`/sites/${siteId}/domains`))
        .send({ hostname: `https://${hostname.toUpperCase()}/` })
        .expect(201)
    ).body;
    const d = site.domains[0];
    expect(d).toMatchObject({ hostname, status: 'PENDING' });
    expect(
      (
        await other.agent
          .post(api('/sites'))
          .send({ establishmentId: estO, slug: `o-${Date.now().toString(36)}` })
          .expect(201)
      ).body.id,
    ).toBeTruthy();
    const otherSite = (await other.agent.get(api('/sites')).expect(200)).body[0].site.id;
    expect(
      (
        await other.agent
          .post(api(`/sites/${otherSite}/domains`))
          .send({ hostname })
          .expect(409)
      ).body.code,
    ).toBe('DOMAIN_TAKEN');

    await publicGet(`/public/sites/resolve?host=${hostname}`).expect(404); // non vérifié : jamais servi
    expect(
      (await superAdmin.post(api(`/platform/site-domains/${d.id}/activate`)).expect(409)).body.code,
    ).toBe('DOMAIN_NOT_VERIFIED');
    site = (await duo.agent.post(api(`/sites/${siteId}/domains/${d.id}/verify`)).expect(201)).body;
    expect(site.domains[0].status).toBe('PENDING');

    verifier.setTxt(d.dns.txtName, [d.dns.txtValue]);
    site = (await duo.agent.post(api(`/sites/${siteId}/domains/${d.id}/verify`)).expect(201)).body;
    expect(site.domains[0].status).toBe('VERIFIED');
    expect(
      (await superAdmin.post(api(`/platform/site-domains/${d.id}/activate`)).expect(201)).body
        .status,
    ).toBe('ERROR'); // HTTPS absent
    verifier.setHttps(hostname, siteId);
    expect(
      (await superAdmin.post(api(`/platform/site-domains/${d.id}/activate`)).expect(201)).body
        .status,
    ).toBe('ACTIVE');
    await duo.agent.post(api(`/platform/site-domains/${d.id}/activate`)).expect(403);
    expect((await publicGet(`/public/sites/resolve?host=${hostname}`).expect(200)).body.slug).toBe(
      site.slug,
    );
    expect((await publicGet(`/public/sites/${site.slug}`).expect(200)).body.canonicalUrl).toBe(
      `https://${hostname}`,
    );
  });

  it('25. suspension : site indisponible sans perte de contenu, puis rétabli', async () => {
    const slug = (await duo.agent.get(api(`/sites/${siteId}`)).expect(200)).body.slug;
    await prisma.organization.update({
      where: { id: duo.organizationId },
      data: { status: 'SUSPENDED' },
    });
    try {
      const res = await publicGet(`/public/sites/${slug}`).expect(200);
      expect(res.body).toEqual({ state: 'UNAVAILABLE', publicName: expect.any(String), siteId });
    } finally {
      await prisma.organization.update({
        where: { id: duo.organizationId },
        data: { status: 'ACTIVE' },
      });
    }
    expect((await publicGet(`/public/sites/${slug}`).expect(200)).body.site.menu).toHaveLength(1);
  });

  it('5. dépublication : introuvable publiquement, brouillon conservé', async () => {
    const site = (await duo.agent.post(api(`/sites/${siteId}/unpublish`)).expect(201)).body;
    expect(site.status).toBe('UNPUBLISHED');
    await publicGet(`/public/sites/${site.slug}`).expect(404);
    expect(site.draft.menu).toHaveLength(1);
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: duo.organizationId, action: { startsWith: 'site.' } },
      select: { action: true },
    });
    expect(new Set(logs.map((l) => l.action))).toEqual(
      new Set([
        'site.created',
        'site.media_uploaded',
        'site.published',
        'site.domain_requested',
        'site.domain_verification',
        'site.unpublished',
      ]),
    );
  });

  it('23. performance : lecture publique d’un site en moins de 1,5 s (latence Neon comprise)', async () => {
    const site = (await duo.agent.post(api(`/sites/${siteId}/publish`)).expect(201)).body;
    const t0 = Date.now();
    await publicGet(`/public/sites/${site.slug}`).expect(200);
    const ms = Date.now() - t0;
    console.log(`[perf] lecture publique d’un site : ${ms} ms`);
    expect(ms).toBeLessThan(1_500);
  });

  it('tarifs SaaS : frais de mise en service exposés sur la page Tarifs', async () => {
    const plans = (await publicGet('/plans').expect(200)).body as {
      businessType: string;
      monthlyPrice: number;
      setupFee: number;
    }[];
    expect(plans.map((p) => [p.businessType, p.monthlyPrice, p.setupFee]).sort()).toEqual([
      ['PARK', 15000, 250000],
      ['PARK_RESTAURANT', 25000, 350000],
      ['RESTAURANT', 15000, 250000],
    ]);
  });
});
