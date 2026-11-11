import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import request from 'supertest';
import type { SimulatedDomainVerifier } from '../src/common/sites/domain-verifier';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import {
  FACTURE_DOMAIN_VERIFIER,
  FactureSiteDomainsService,
} from '../src/modules/facture/facture-site-domains.service';
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
 * Ocall Facture — site vitrine F5 : offre « avec vitrine » exigée (droit historique Park exclu), brouillon
 * jamais public, publication figée (prestations et prix du catalogue), images publiées seulement, demandes
 * des visiteurs (anti-spam, formulaires choisis) arrivant dans la boîte sans rien créer d'autre, domaine
 * personnalisé (TXT, activation Super Admin, unicité entre applications), adresse et plan du site,
 * isolation, rôles. Données fictives, bases locales jetables, vérification DNS/HTTPS simulée.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
/** Formulaire ouvert il y a 10 s : au-delà de la durée minimale de saisie. */
const opened = () => Date.now() - 10_000;

(enabled ? describe : describe.skip)('Ocall Facture F5 — site vitrine (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let verifier: SimulatedDomainVerifier;
  let showcase: SignedUpOwner; // offre « avec vitrine »
  let plain: SignedUpOwner; // offre « sans vitrine »
  let legacy: SignedUpOwner; // client Park historique, offre « sans vitrine »
  let sales: Agent;
  let service: string;
  let hiddenPrice: string;

  async function subscribe(organizationId: string, withShowcase: boolean) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
      where: {
        productId_name: {
          productId: product.id,
          name: `Ocall Facture — ${withShowcase ? 'Avec vitrine' : 'Sans vitrine'}`,
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

  const pub = () => request(app.getHttpServer());
  const draft = (agent: Agent, over: Record<string, unknown> = {}) =>
    agent.put(api('/facture/site/draft')).send({
      headline: 'Climatisation et froid à Bamako',
      tagline: 'Installation, entretien, dépannage',
      about: 'Techniciens qualifiés depuis 2015.',
      services: [
        { itemId: service, showPrice: true },
        { itemId: hiddenPrice, showPrice: false },
      ],
      phone: '+223 20 22 00 00',
      whatsapp: '+223 70 11 22 33',
      email: 'contact@froid-services.ml',
      address: 'Rue 310, ACI 2000',
      city: 'Bamako',
      hours: 'Lun–Ven 8 h–18 h',
      mapUrl: 'https://www.openstreetmap.org/#map=16/12.63/-8.00',
      seoDescription: 'Climatisation à Bamako',
      forms: ['CONTACT', 'QUOTE', 'APPOINTMENT'],
      ...over,
    });
  const ask = (slug: string, over: Record<string, unknown> = {}) =>
    pub()
      .post(api(`/public/facture-sites/${slug}/requests`))
      .send({
        kind: 'QUOTE',
        name: 'Awa Traoré',
        phone: '+223 76 00 00 01',
        message: 'Devis pour deux climatiseurs, svp.',
        website: '',
        startedAt: opened(),
        ...over,
      });

  async function settings(owner: SignedUpOwner, name: string) {
    await owner.agent
      .put(api('/facture/settings'))
      .send({
        legalName: `${name} ${RUN} SARL`,
        tradeName: name,
        address: 'ACI 2000',
        city: 'Bamako',
        nif: '084123456A',
        taxRegime: 'Régime du réel normal',
        defaultVatRate: 18,
        paymentTermsDays: 30,
      })
      .expect(200);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    verifier = app.get(FACTURE_DOMAIN_VERIFIER);
    showcase = await signup(app, 'factureF5A', 'PARK');
    plain = await signup(app, 'factureF5B', 'PARK');
    legacy = await signup(app, 'factureF5C', 'PARK');
    await subscribe(showcase.organizationId, true);
    await subscribe(plain.organizationId, false);
    await subscribe(legacy.organizationId, false);
    await prisma.organization.update({
      where: { id: legacy.organizationId },
      data: { showcaseGrandfathered: true },
    });
    await settings(showcase, 'Froid Services');
    await settings(plain, 'Kati Clim');
    await settings(legacy, 'Vieux Client');
    const item = async (name: string, unitPrice: number) =>
      (
        await showcase.agent
          .post(api('/facture/items'))
          .send({ kind: 'SERVICE', name, unit: 'intervention', unitPrice, vatRate: 18 })
          .expect(201)
      ).body.id as string;
    service = await item('Entretien climatiseur', 25_000);
    hiddenPrice = await item('Dépannage', 40_000);
    // Une seule connexion de membre (inscriptions comprises : quatre en tout).
    const res = await showcase.agent
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName: 'Commercial', role: 'SALES' })
      .expect(201);
    const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    sales = session.agent;
  }, 300_000);

  afterAll(async () => {
    try {
      if (db) {
        await purgeFactureOrganizations(db, [
          showcase.organizationId,
          plain.organizationId,
          legacy.organizationId,
        ]);
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('création, brouillon jamais public, publication figée aux prix du catalogue', async () => {
    const slug = `froid-${RUN}`;
    await showcase.agent.put(api('/facture/site/slug')).send({ slug: 'A' }).expect(400);
    await showcase.agent.put(api('/facture/site/slug')).send({ slug }).expect(200);
    expect((await plain.agent.put(api('/facture/site/slug')).send({ slug })).body.code).toBe(
      'FACTURE_SITE_SLUG_TAKEN',
    );
    await draft(showcase.agent).expect(200);
    expect((await draft(showcase.agent, { mapUrl: 'http://evil.example/x' })).body.code).toBe(
      'FACTURE_SITE_MAP_URL',
    );
    expect((await draft(showcase.agent, { whatsapp: '76 00 00 00' })).status).toBe(400);
    // Brouillon : jamais public.
    await pub()
      .get(api(`/public/facture-sites/${slug}`))
      .expect(404);

    const site = (await showcase.agent.post(api('/facture/site/publish')).expect(200)).body;
    expect(site.site).toMatchObject({
      isOnline: true,
      url: `https://app.ocall-test.example.com/v/${slug}`,
    });
    const live = (
      await pub()
        .get(api(`/public/facture-sites/${slug}`))
        .expect(200)
    ).body;
    expect(live.site).toMatchObject({
      businessName: 'Froid Services',
      headline: 'Climatisation et froid à Bamako',
      forms: ['CONTACT', 'QUOTE', 'APPOINTMENT'],
    });
    expect(live.site.services).toEqual([
      expect.objectContaining({ name: 'Entretien climatiseur', priceTtc: 29_500 }),
      expect.objectContaining({ name: 'Dépannage', priceTtc: null }),
    ]);
    // Aucune donnée interne (NIF, documents, clients) dans la réponse publique.
    expect(JSON.stringify(live)).not.toMatch(/084123456A|organizationId/);

    // Modification du brouillon : invisible tant qu'elle n'est pas publiée.
    await draft(showcase.agent, { headline: 'Nouveau titre en préparation' }).expect(200);
    expect((await pub().get(api(`/public/facture-sites/${slug}`))).body.site.headline).toBe(
      'Climatisation et froid à Bamako',
    );
    // Changement d'adresse refusé tant que le site est en ligne.
    expect(
      (await showcase.agent.put(api('/facture/site/slug')).send({ slug: `autre-${RUN}` })).body
        .code,
    ).toBe('FACTURE_SITE_ONLINE');
  });

  it('offre « avec vitrine » exigée ; droit historique Park sans effet sur Facture', async () => {
    for (const [owner, slug] of [
      [plain, `kati-${RUN}`],
      [legacy, `vieux-${RUN}`],
    ] as const) {
      await owner.agent.put(api('/facture/site/slug')).send({ slug }).expect(200);
      const refused = await owner.agent.post(api('/facture/site/publish'));
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('SHOWCASE_OPTION_REQUIRED');
      expect((await owner.agent.get(api('/facture/site')).expect(200)).body.entitled).toBe(false);
    }
    // Le commercial ne gère pas le site ; il traite les demandes.
    await sales.get(api('/facture/site')).expect(403);
    await sales.get(api('/facture/requests')).expect(200);

    // Offre retirée (plus d'essai ni d'abonnement en cours) : le site n'est plus servi.
    const slug = `froid-${RUN}`;
    await prisma.subscription.updateMany({
      where: { organizationId: showcase.organizationId },
      data: { status: 'EXPIRED' },
    });
    await prisma.productTrial.updateMany({
      where: { organizationId: showcase.organizationId },
      data: { endsAt: new Date(Date.now() - DAY) },
    });
    await pub()
      .get(api(`/public/facture-sites/${slug}`))
      .expect(404);
    await prisma.subscription.updateMany({
      where: { organizationId: showcase.organizationId },
      data: { status: 'TRIALING' },
    });
    await prisma.productTrial.updateMany({
      where: { organizationId: showcase.organizationId },
      data: { endsAt: new Date(Date.now() + 14 * DAY) },
    });
    await pub()
      .get(api(`/public/facture-sites/${slug}`))
      .expect(200);
  });

  it('images : réencodées, servies une fois publiées seulement', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = (kind: string) =>
      showcase.agent
        .post(api('/facture/site/media'))
        .field('kind', kind)
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    const after = (await upload('GALLERY').expect(201)).body;
    const media = after.media.find((m: { kind: string }) => m.kind === 'GALLERY');
    expect(media.isPublished).toBe(false);
    await pub()
      .get(api(`/public/facture-media/${media.storageKey}`))
      .expect(404);
    await showcase.agent.post(api('/facture/site/publish')).expect(200);
    const served = await pub()
      .get(api(`/public/facture-media/${media.storageKey}`))
      .expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect((await pub().get(api(`/public/facture-sites/froid-${RUN}`))).body.site.gallery).toEqual([
      { key: media.storageKey, caption: null },
    ]);
    // Une image en ligne ne se supprime pas directement.
    expect((await showcase.agent.delete(api(`/facture/site/media/${media.id}`))).body.code).toBe(
      'FACTURE_SITE_MEDIA_PUBLISHED',
    );
    await showcase.agent
      .post(api('/facture/site/media'))
      .field('kind', 'GALLERY')
      .attach('file', Buffer.from('pas une image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
  });

  it('demandes des visiteurs : boîte de l’entreprise, anti-spam, rien d’autre créé', async () => {
    const slug = `froid-${RUN}`;
    const before = {
      documents: await db.factureDocument.count({
        where: { organizationId: showcase.organizationId },
      }),
      interventions: await db.factureIntervention.count({
        where: { organizationId: showcase.organizationId },
      }),
      clients: await db.factureClient.count({ where: { organizationId: showcase.organizationId } }),
    };
    expect((await ask(slug, { serviceItemId: service }).expect(200)).body).toEqual({
      received: true,
    });
    await ask(slug, {
      kind: 'APPOINTMENT',
      email: 'awa@example.ml',
      phone: null,
      preferredDate: '2026-12-01',
    }).expect(200);
    // Robots : champ piège rempli, envoi trop rapide → même réponse, rien d'enregistré.
    await ask(slug, { website: 'http://spam.example' }).expect(200);
    await ask(slug, { startedAt: Date.now() }).expect(200);
    // Formulaire non proposé, contact absent, données invalides.
    expect((await ask(slug, { kind: 'INTERVENTION' })).body.code).toBe(
      'FACTURE_REQUEST_KIND_CLOSED',
    );
    expect((await ask(slug, { phone: null })).body.code).toBe('FACTURE_REQUEST_CONTACT');
    await ask(slug, { message: 'x' }).expect(400);
    await ask(`kati-${RUN}`).expect(404);

    const inbox = (await sales.get(api('/facture/requests')).expect(200)).body as {
      id: string;
      kind: string;
      status: string;
      serviceLabel: string | null;
      preferredDate: string | null;
    }[];
    expect(inbox.map((r) => r.kind).sort()).toEqual(['APPOINTMENT', 'QUOTE']);
    expect(inbox.find((r) => r.kind === 'QUOTE')).toMatchObject({
      status: 'NEW',
      serviceLabel: 'Entretien climatiseur',
    });
    expect(inbox.find((r) => r.kind === 'APPOINTMENT')!.preferredDate).toMatch(/^2026-12-01/);
    // Jamais de devis, de facture, d'intervention ni de client créés automatiquement.
    expect({
      documents: await db.factureDocument.count({
        where: { organizationId: showcase.organizationId },
      }),
      interventions: await db.factureIntervention.count({
        where: { organizationId: showcase.organizationId },
      }),
      clients: await db.factureClient.count({ where: { organizationId: showcase.organizationId } }),
    }).toEqual(before);

    const updated = (
      await sales
        .patch(api(`/facture/requests/${inbox[0]!.id}`))
        .send({ status: 'DONE' })
        .expect(200)
    ).body;
    expect(updated.status).toBe('DONE');
    // Isolation : une autre organisation ne voit ni ne traite ces demandes.
    expect((await plain.agent.get(api('/facture/requests')).expect(200)).body).toEqual([]);
    await plain.agent
      .patch(api(`/facture/requests/${inbox[0]!.id}`))
      .send({ status: 'SPAM' })
      .expect(404);
  });

  it('domaine personnalisé : TXT, activation Super Admin, résolution, unicité entre applications', async () => {
    const hostname = `www.froid-${RUN}.ml`;
    expect(
      (await showcase.agent.post(api('/facture/site/domains')).send({ hostname: '10.0.0.1' })).body
        .code,
    ).toBe('DOMAIN_IP');
    const domain = (
      await showcase.agent
        .post(api('/facture/site/domains'))
        .send({ hostname: `https://${hostname}/` })
        .expect(201)
    ).body;
    expect(domain).toMatchObject({ hostname, status: 'PENDING' });
    expect(
      (await showcase.agent.post(api('/facture/site/domains')).send({ hostname: 'autre.ml' })).body
        .code,
    ).toBe('DOMAIN_ALREADY_SET');
    expect(
      (await plain.agent.post(api('/facture/site/domains')).send({ hostname })).body.code,
    ).toBe('DOMAIN_TAKEN');

    // Pas encore vérifié ni actif : non résolu.
    await pub()
      .get(api(`/public/facture-sites/resolve?host=${hostname}`))
      .expect(404);
    expect(
      (await showcase.agent.post(api(`/facture/site/domains/${domain.id}/verify`)).expect(200)).body
        .status,
    ).toBe('PENDING');
    verifier.setTxt(domain.txtName, [domain.txtValue]);
    expect(
      (await showcase.agent.post(api(`/facture/site/domains/${domain.id}/verify`)).expect(200)).body
        .status,
    ).toBe('VERIFIED');

    // Activation par le Super Admin : page de contrôle HTTPS conforme exigée.
    // Réservée au Super Admin : refusée à l'entreprise ; la procédure est appelée ici directement.
    await showcase.agent
      .post(api(`/platform/facture-site-domains/${domain.id}/activate`))
      .expect(403);
    const svc = app.get(FactureSiteDomainsService);
    const failed = await svc.activate(showcase.organizationId, domain.id);
    expect(failed.status).toBe('ERROR');
    expect(
      (
        await pub()
          .get(api(`/public/facture-sites/well-known?host=${hostname}`))
          .expect(200)
      ).body,
    ).toEqual({
      siteId: showcase.organizationId,
    });
    verifier.setHttps(hostname, showcase.organizationId);
    expect((await svc.activate(showcase.organizationId, domain.id)).status).toBe('ACTIVE');
    expect(
      (
        await pub()
          .get(api(`/public/facture-sites/resolve?host=${hostname}`))
          .expect(200)
      ).body,
    ).toEqual({
      slug: `froid-${RUN}`,
    });
    // Adresse canonique : le domaine actif ; plan du site de cet hôte : cette seule page.
    expect((await pub().get(api(`/public/facture-sites/froid-${RUN}`))).body.url).toBe(
      `https://${hostname}`,
    );
    expect(
      (
        await pub()
          .get(api(`/public/facture-sites/sitemap?host=${hostname}`))
          .expect(200)
      ).body,
    ).toEqual([expect.objectContaining({ url: `https://${hostname}` })]);

    // Domaine déjà déclaré par un site Park (même organisation ou non) : refusé pour Facture.
    const parkHost = `www.parc-${RUN}.ml`;
    const establishment = await prisma.establishment.findFirstOrThrow({
      where: { organizationId: plain.organizationId },
    });
    const parkSite = await prisma.publicSite.create({
      data: {
        organizationId: plain.organizationId,
        establishmentId: establishment.id,
        slug: `parc-${RUN}`,
        draft: {},
      },
    });
    await prisma.publicSiteDomain.create({
      data: {
        organizationId: plain.organizationId,
        siteId: parkSite.id,
        hostname: parkHost,
        verificationToken: 'x'.repeat(24),
      },
    });
    expect(
      (await plain.agent.post(api('/facture/site/domains')).send({ hostname: parkHost })).body.code,
    ).toBe('DOMAIN_TAKEN');
    await prisma.publicSiteDomain.deleteMany({ where: { hostname: parkHost } });
    await prisma.publicSite.delete({ where: { id: parkSite.id } });

    // Suspension : plus résolu.
    await svc.suspend(showcase.organizationId, domain.id, 'Litige');
    await pub()
      .get(api(`/public/facture-sites/resolve?host=${hostname}`))
      .expect(404);
  });

  it('hors ligne : retrait de la publication, plus rien de public', async () => {
    const slug = `froid-${RUN}`;
    await showcase.agent.post(api('/facture/site/unpublish')).expect(200);
    await pub()
      .get(api(`/public/facture-sites/${slug}`))
      .expect(404);
    await ask(slug).expect(404);
    const site = await db.factureSite.findUniqueOrThrow({
      where: { organizationId: showcase.organizationId },
    });
    expect(site.isOnline).toBe(false);
  });
});
