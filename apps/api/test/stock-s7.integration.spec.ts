import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import type { SimulatedDomainVerifier } from '../src/common/sites/domain-verifier';
import { SiteDomainRegistry } from '../src/common/sites/site-domain-registry';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import {
  OcallStockShowcaseDomainsService,
  STOCK_DOMAIN_VERIFIER,
} from '../src/modules/ocall-stock/ocall-stock-showcase-domains.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Ocall Stock — S7 (site vitrine) : brouillon puis publication (offre « avec vitrine » exigée), version
 * publiée seule lue, catalogue public des seuls articles cochés (prix au choix, badge de disponibilité,
 * jamais coûts, quantités, fournisseurs), fiche article, photos publiques des seuls articles publiés,
 * demandes des visiteurs (articles joints, anti-spam), droits, domaine personnalisé (TXT, activation,
 * unicité entre applications), plan du site, isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');
const opened = () => Date.now() - 10_000;

(enabled ? describe : describe.skip)('Ocall Stock S7 — site vitrine (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let verifier: SimulatedDomainVerifier;
  let orgA: SignedUpOwner; // offre « avec vitrine »
  let orgB: SignedUpOwner; // offre « sans vitrine »
  let a: Agent;
  let seller: Agent;
  let cashier: Agent;
  let paint: { productId: string; variantId: string };
  let glass: { productId: string; variantId: string };
  let cement: { productId: string; variantId: string };
  let paintImage: string;
  let cementImage: string;
  const slug = `quinca-${RUN}`.toLowerCase().slice(0, 40);

  async function subscribe(organizationId: string, withShowcase: boolean) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
      where: {
        productId_name: {
          productId: product.id,
          name: `Ocall Stock — ${withShowcase ? 'Avec vitrine' : 'Sans vitrine'}`,
        },
      },
    });
    expect(plan).toMatchObject({ includesShowcase: withShowcase, isActive: false });
    await prisma.productTrial.create({
      data: {
        organizationId,
        productId: product.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * DAY),
        startedByOcall: true,
      },
    });
    await prisma.subscription.create({
      data: { organizationId, productId: product.id, planId: plan.id, status: 'TRIALING' },
    });
  }

  async function product(name: string, extra: Record<string, unknown> = {}) {
    const p = (
      await a
        .post(api('/ocall-stock/products'))
        .send({ name, salePrice: 11_800, purchasePrice: 7777, vatRate: 18, ...extra })
        .expect(201)
    ).body;
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  async function member(role: string, firstName: string) {
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName, lastName: 'Vitrine', role })
        .expect(201)
    ).body;
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  const png = (color: string) =>
    sharp({ create: { width: 32, height: 32, channels: 3, background: color } })
      .png()
      .toBuffer();

  async function photo(productId: string) {
    const res = await a
      .post(api(`/ocall-stock/products/${productId}/images`))
      .attach('file', await png('#3a7bd5'), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return (res.body.images?.[0]?.id ?? res.body.id) as string;
  }

  const pub = () => request(app.getHttpServer());
  const content = (over: Record<string, unknown> = {}) => ({
    headline: 'Tout pour bâtir à Bamako',
    tagline: 'Peinture, vitrerie, ciment',
    about: 'Depuis 2010.',
    phone: '+223 20 22 00 00',
    whatsapp: '+223 70 11 22 33',
    email: 'contact@quinca.ml',
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    hours: 'Lun–Sam 8 h–19 h',
    mapUrl: 'https://www.openstreetmap.org/#map=16/12.63/-8.00',
    seoDescription: 'Quincaillerie à Bamako',
    showCatalog: true,
    showPrices: false,
    forms: ['CONTACT', 'QUOTE'],
    ...over,
  });
  const ask = (over: Record<string, unknown> = {}) =>
    pub()
      .post(api(`/public/stock-sites/${slug}/requests`))
      .send({
        kind: 'QUOTE',
        name: 'Awa Traoré',
        phone: '+223 76 00 00 01',
        message: 'Devis pour un chantier, svp.',
        website: '',
        startedAt: opened(),
        ...over,
      });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    verifier = app.get(STOCK_DOMAIN_VERIFIER);
    orgA = await signup(app, 'stockS7A', 'PARK');
    orgB = await signup(app, 'stockS7B', 'PARK');
    await subscribe(orgA.organizationId, true);
    await subscribe(orgB.organizationId, false);
    a = orgA.agent;
    await a
      .put(api('/ocall-stock/settings'))
      .send({
        storeName: 'Quincaillerie du Fleuve',
        defaultVatRate: 18,
        internalCodePrefix: 'QF',
        allowNegativeStock: false,
      })
      .expect(200);
    const supplier = (
      await a.post(api('/ocall-stock/suppliers')).send({ name: 'Grossiste Secret' }).expect(201)
    ).body;
    const category = (
      await a.post(api('/ocall-stock/categories')).send({ name: 'Peintures' }).expect(201)
    ).body;
    paint = await product('Peinture blanche 5 L', { categoryId: category.id });
    glass = await product('Vitre claire 4 mm', { salePrice: 5900 });
    cement = await product('Ciment 50 kg', { salePrice: 6500 });
    const site = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG1', name: 'Magasin', kind: 'STORE' })
        .expect(201)
    ).body;
    await a
      .post(api('/ocall-stock/movements'))
      .send({
        kind: 'IN',
        variantId: paint.variantId,
        locationId: site.locations[0].id,
        quantity: 37,
        idempotencyKey: key(),
      })
      .expect(201);
    paintImage = await photo(paint.productId);
    cementImage = await photo(cement.productId);
    expect(supplier.id).toBeTruthy();
    seller = await member('SALES', 'Vendeur');
    cashier = await member('CASHIER', 'Caissier');
  }, 300_000);

  afterAll(async () => {
    try {
      const orgs = [orgA?.organizationId, orgB?.organizationId].filter(Boolean) as string[];
      if (db && orgs.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(db, orgs);
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('brouillon puis publication : offre « avec vitrine » exigée, version publiée seule lue', async () => {
    let view = (await a.get(api('/ocall-stock/showcase')).expect(200)).body;
    expect(view).toMatchObject({ site: null, entitled: true, publishedProducts: 0 });
    expect((await a.get(api('/ocall-stock/showcase/suggest-slug')).expect(200)).body.slug).toBe(
      'quincaillerie-du-fleuve',
    );
    await a.put(api('/ocall-stock/showcase/draft')).send(content()).expect(409);
    await a.put(api('/ocall-stock/showcase/slug')).send({ slug: 'Ab' }).expect(400);
    view = (await a.put(api('/ocall-stock/showcase/slug')).send({ slug }).expect(200)).body;
    expect(view.site).toMatchObject({ slug, isOnline: false });
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ whatsapp: '+223 12' }))
      .expect(400);
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ mapUrl: 'javascript:alert(1)' }))
      .expect(400);
    await a.put(api('/ocall-stock/showcase/draft')).send(content()).expect(200);
    await pub()
      .get(api(`/public/stock-sites/${slug}`))
      .expect(404);

    // Offre « sans vitrine » : brouillon possible, publication refusée.
    await orgB.agent
      .put(api('/ocall-stock/showcase/slug'))
      .send({ slug: `plain-${RUN}`.toLowerCase().slice(0, 40) })
      .expect(200);
    const refused = await orgB.agent.post(api('/ocall-stock/showcase/publish')).expect(403);
    expect(refused.body.code).toBe('SHOWCASE_OPTION_REQUIRED');
    expect((await orgB.agent.get(api('/ocall-stock/showcase')).expect(200)).body.entitled).toBe(
      false,
    );

    view = (await a.post(api('/ocall-stock/showcase/publish')).expect(200)).body;
    expect(view.site).toMatchObject({ isOnline: true });
    expect(view.site.url).toMatch(new RegExp(`/m/${slug}$`));
    const home = (
      await pub()
        .get(api(`/public/stock-sites/${slug}`))
        .expect(200)
    ).body;
    expect(home.site).toMatchObject({
      businessName: 'Quincaillerie du Fleuve',
      headline: 'Tout pour bâtir à Bamako',
      showPrices: false,
    });
    // Le brouillon modifié ne change pas le site avant republication.
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ headline: 'Nouveau titre' }))
      .expect(200);
    expect(
      (
        await pub()
          .get(api(`/public/stock-sites/${slug}`))
          .expect(200)
      ).body.site.headline,
    ).toBe('Tout pour bâtir à Bamako');
    await a.post(api('/ocall-stock/showcase/unpublish')).expect(200);
    await pub()
      .get(api(`/public/stock-sites/${slug}`))
      .expect(404);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);
    // Une fois en ligne, l'adresse ne change plus.
    expect(
      (await a.put(api('/ocall-stock/showcase/slug')).send({ slug: 'autre-adresse' }).expect(409))
        .body.code,
    ).toBe('STOCK_SHOWCASE_ONLINE');
  });

  it('catalogue public : articles cochés seulement, prix au choix, badge, jamais de données internes', async () => {
    let cat = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/catalogue`))
        .expect(200)
    ).body;
    expect(cat.items).toEqual([]);
    for (const p of [paint, glass]) {
      await a
        .put(api(`/ocall-stock/showcase/products/${p.productId}`))
        .send({ published: true })
        .expect(200);
    }
    const list = (
      await a.get(api('/ocall-stock/showcase/products')).query({ published: 'true' }).expect(200)
    ).body;
    expect(list.total).toBe(2);
    cat = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/catalogue`))
        .expect(200)
    ).body;
    expect(cat.items.map((p: { name: string }) => p.name)).toEqual([
      'Peinture blanche 5 L',
      'Vitre claire 4 mm',
    ]);
    const byName = Object.fromEntries(
      cat.items.map((p: { name: string }) => [p.name, p]),
    ) as Record<string, { priceTtc: number | null; availability: string; images: string[] }>;
    expect(byName['Peinture blanche 5 L']).toMatchObject({
      priceTtc: null,
      availability: 'AVAILABLE',
      images: [paintImage],
    });
    expect(byName['Vitre claire 4 mm']).toMatchObject({ availability: 'ON_ORDER' });
    expect(cat.categories).toEqual([expect.objectContaining({ name: 'Peintures' })]);
    // Jamais publiés : prix d'achat, quantités, fournisseurs.
    const raw = JSON.stringify(cat);
    expect(raw).not.toContain('7777');
    expect(raw).not.toContain('Grossiste Secret');
    expect(raw).not.toMatch(/"(onHand|reserved|quantity|purchasePrice)"/);

    // Prix affichés après republication ; filtre par catégorie, recherche avec faute.
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ showPrices: true }))
      .expect(200);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);
    cat = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/catalogue`))
        .query({ category: cat.categories[0].id })
        .expect(200)
    ).body;
    expect(cat.items).toEqual([
      expect.objectContaining({ name: 'Peinture blanche 5 L', priceTtc: 11_800 }),
    ]);
    cat = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/catalogue`))
        .query({ q: 'vitr clair' })
        .expect(200)
    ).body;
    expect(cat.items.map((p: { name: string }) => p.name)).toEqual(['Vitre claire 4 mm']);

    // Fiche article : publiée seulement.
    const one = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/articles/${paint.productId}`))
        .expect(200)
    ).body;
    expect(one.product).toMatchObject({ name: 'Peinture blanche 5 L', priceTtc: 11_800 });
    await pub()
      .get(api(`/public/stock-sites/${slug}/articles/${cement.productId}`))
      .expect(404);

    // Photos : celles des seuls articles publiés.
    const img = await pub()
      .get(api(`/public/stock-images/${paintImage}`))
      .expect(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    await pub()
      .get(api(`/public/stock-images/${cementImage}`))
      .expect(404);

    // Accueil : premiers articles ; catalogue désactivé : plus aucun article ni photo.
    const home = (
      await pub()
        .get(api(`/public/stock-sites/${slug}`))
        .expect(200)
    ).body;
    expect(home.featured).toHaveLength(2);
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ showPrices: true, showCatalog: false }))
      .expect(200);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);
    expect(
      (
        await pub()
          .get(api(`/public/stock-sites/${slug}`))
          .expect(200)
      ).body.featured,
    ).toEqual([]);
    await pub()
      .get(api(`/public/stock-sites/${slug}/catalogue`))
      .expect(404);
    await pub()
      .get(api(`/public/stock-images/${paintImage}`))
      .expect(404);
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ showPrices: true }))
      .expect(200);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);

    // Article archivé : il disparaît aussitôt.
    await a
      .patch(api(`/ocall-stock/products/${glass.productId}`))
      .send({ isArchived: true })
      .expect(200);
    const afterArchive = (
      await pub()
        .get(api(`/public/stock-sites/${slug}/catalogue`))
        .expect(200)
    ).body;
    expect(afterArchive.items.map((p: { name: string }) => p.name)).toEqual([
      'Peinture blanche 5 L',
    ]);
    await pub()
      .get(api(`/public/stock-sites/${slug}/articles/${glass.productId}`))
      .expect(404);
    await a
      .patch(api(`/ocall-stock/products/${glass.productId}`))
      .send({ isArchived: false })
      .expect(200);
  });

  it('demandes : articles publiés joints, contact exigé, anti-spam, boîte du magasin', async () => {
    await ask({
      items: [
        { productId: paint.productId, quantity: 10 },
        { productId: glass.productId, quantity: 2.5 },
      ],
    }).expect(200);
    expect(
      (await ask({ items: [{ productId: cement.productId, quantity: 1 }] }).expect(400)).body.code,
    ).toBe('STOCK_SHOWCASE_REQUEST_ITEMS');
    expect((await ask({ phone: null, email: null }).expect(400)).body.code).toBe(
      'STOCK_SHOWCASE_REQUEST_CONTACT',
    );
    // Robot : même réponse, rien d'enregistré (champ piège, saisie trop rapide).
    await ask({ website: 'http://spam.example' }).expect(200);
    await ask({ startedAt: Date.now() }).expect(200);
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ showPrices: true, forms: ['CONTACT'] }))
      .expect(200);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);
    expect((await ask().expect(400)).body.code).toBe('STOCK_SHOWCASE_REQUEST_KIND_CLOSED');
    await ask({ kind: 'CONTACT', items: undefined, message: 'Ouvert le dimanche ?' }).expect(200);

    const inbox = (await seller.get(api('/ocall-stock/showcase/requests')).expect(200)).body as {
      id: string;
      kind: string;
      items: { productId: string; name: string; quantity: number }[];
    }[];
    expect(inbox).toHaveLength(2);
    const quote = inbox.find((r) => r.kind === 'QUOTE')!;
    expect(quote.items).toEqual([
      { productId: paint.productId, name: 'Peinture blanche 5 L', quantity: 10 },
      { productId: glass.productId, name: 'Vitre claire 4 mm', quantity: 2.5 },
    ]);
    expect(
      (
        await seller
          .patch(api(`/ocall-stock/showcase/requests/${quote.id}`))
          .send({ status: 'DONE' })
          .expect(200)
      ).body.status,
    ).toBe('DONE');
    await cashier.get(api('/ocall-stock/showcase/requests')).expect(403);
    await seller.get(api('/ocall-stock/showcase')).expect(403);
    await orgB.agent
      .patch(api(`/ocall-stock/showcase/requests/${quote.id}`))
      .send({ status: 'SPAM' })
      .expect(404);
    await orgB.agent
      .put(api(`/ocall-stock/showcase/products/${paint.productId}`))
      .send({ published: false })
      .expect(404);
    expect((await orgB.agent.get(api('/ocall-stock/showcase/requests')).expect(200)).body).toEqual(
      [],
    );
    await a
      .put(api('/ocall-stock/showcase/draft'))
      .send(content({ showPrices: true }))
      .expect(200);
    await a.post(api('/ocall-stock/showcase/publish')).expect(200);
  });

  it('domaine personnalisé : TXT, activation Super Admin, adresse canonique, plan du site, unicité', async () => {
    const hostname = `www.quinca-${RUN}.ml`.toLowerCase();
    const domain = (
      await a.post(api('/ocall-stock/showcase/domains')).send({ hostname }).expect(201)
    ).body;
    expect(domain).toMatchObject({ hostname, status: 'PENDING' });
    expect(
      (await a.post(api('/ocall-stock/showcase/domains')).send({ hostname: 'autre.ml' })).body.code,
    ).toBe('DOMAIN_ALREADY_SET');
    await pub()
      .get(api(`/public/stock-sites/resolve?host=${hostname}`))
      .expect(404);
    verifier.setTxt(domain.txtName, [domain.txtValue]);
    expect(
      (await a.post(api(`/ocall-stock/showcase/domains/${domain.id}/verify`)).expect(200)).body
        .status,
    ).toBe('VERIFIED');
    await a.post(api(`/platform/stock-site-domains/${domain.id}/activate`)).expect(403);
    const svc = app.get(OcallStockShowcaseDomainsService);
    expect((await svc.activate(orgA.organizationId, domain.id)).status).toBe('ERROR');
    expect(
      (
        await pub()
          .get(api(`/public/stock-sites/well-known?host=${hostname}`))
          .expect(200)
      ).body,
    ).toEqual({ siteId: orgA.organizationId });
    verifier.setHttps(hostname, orgA.organizationId);
    expect((await svc.activate(orgA.organizationId, domain.id)).status).toBe('ACTIVE');
    expect(
      (
        await pub()
          .get(api(`/public/stock-sites/resolve?host=${hostname}`))
          .expect(200)
      ).body,
    ).toEqual({ slug });
    expect((await pub().get(api(`/public/stock-sites/${slug}`))).body.url).toBe(
      `https://${hostname}`,
    );
    const map = (
      await pub()
        .get(api(`/public/stock-sites/sitemap?host=${hostname}`))
        .expect(200)
    ).body.map((e: { url: string }) => e.url);
    expect(map).toEqual(
      expect.arrayContaining([
        `https://${hostname}`,
        `https://${hostname}/catalogue`,
        `https://${hostname}/article/${paint.productId}`,
      ]),
    );
    expect(map).not.toContain(`https://${hostname}/article/${cement.productId}`);

    // Un nom n'est jamais servi par deux applications (registre commun : Facture voit Stock).
    const registry = app.get(SiteDomainRegistry);
    expect(await registry.takenElsewhere('FACTURE', hostname)).toBe(true);
    expect(await registry.takenElsewhere('STOCK', hostname)).toBe(false);
    if (process.env.TEST_FACTURE_DATABASE_URL) {
      const factureHost = `www.facture-${RUN}.ml`.toLowerCase();
      await app.get(FacturePrismaService).factureSiteDomain.create({
        data: {
          organizationId: orgB.organizationId,
          hostname: factureHost,
          verificationToken: key(),
          createdByUserId: randomUUID(),
        },
      });
      await orgB.agent
        .post(api('/ocall-stock/showcase/domains'))
        .send({ hostname: factureHost })
        .expect(409);
      await app.get(FacturePrismaService).factureSiteDomain.deleteMany({
        where: { hostname: factureHost },
      });
    }
    await orgB.agent.post(api('/ocall-stock/showcase/domains')).send({ hostname }).expect(409);
  });

  it('garanties en base : adresse, contact et articles d’une demande', async () => {
    await expect(
      db.stockShowcase.update({
        where: { organizationId: orgA.organizationId },
        data: { slug: 'A!' },
      }),
    ).rejects.toThrow('StockShowcase_slug_check');
    await expect(
      db.stockShowcaseRequest.create({
        data: {
          organizationId: orgA.organizationId,
          kind: 'CONTACT',
          name: 'Robot',
          message: 'Sans contact',
        },
      }),
    ).rejects.toThrow('StockShowcaseRequest_contact_check');
    await expect(
      db.stockShowcase.update({
        where: { organizationId: orgB.organizationId },
        data: { isOnline: true },
      }),
    ).rejects.toThrow('StockShowcase_online_check');
  });
});
