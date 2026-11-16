import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { attributionScope } from '../src/common/commissions';
import { loadActivityAccess } from '../src/common/park-access';
import { extendSubscription } from '../src/common/subscription-billing';
import { SiteActivationService } from '../src/modules/establishments/site-activation.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  partnerAccount,
  signup,
} from './helpers';

/**
 * Ocall Suite — sprint 7 : séparation commerciale Ocall Parc / Ocall Restaurant (lots A, B, C).
 *
 * Avant l'ouverture d'Ocall Restaurant, l'inscription garde le contrat Ocall Park combiné (parc et
 * restaurant). Ocall ouvre Restaurant explicitement (offre forfaitaire active puis présentation au
 * catalogue) ; ensuite, un client « parc et restaurant » souscrit deux applications en une inscription,
 * avec des droits distincts par activité ; le menu QR reste consultable mais la commande exige un droit
 * Restaurant ; un contrat combiné garde ses droits jusqu'à sa bascule explicite (montant conservé, réparti,
 * sans mise en service, attributions des partenaires prolongées, aucune facture réécrite). Données
 * fictives, bases de test locales jetables uniquement ; l'état du catalogue est restauré à la fin.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;

describe('Ocall Suite S7 — séparation Ocall Parc / Ocall Restaurant', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let combined: SignedUpOwner;
  let restaurantProductId: string;
  let restaurantFlatPlanId: string;

  const subsOf = (organizationId: string) =>
    prisma.subscription.findMany({
      where: { organizationId },
      include: { product: true, parkCombined: true },
      orderBy: { createdAt: 'asc' },
    });
  const firstEstablishment = async (organizationId: string) =>
    (await prisma.establishment.findFirstOrThrow({ where: { organizationId } })).id;
  const me = async (who: Agent) => (await who.get(api('/auth/me')).expect(200)).body;
  const restaurantWrite = (who: Agent) =>
    who.post(api('/catalog/categories')).send({ name: `Plats ${randomUUID().slice(0, 6)}` });
  const parkWrite = async (who: Agent, organizationId: string) =>
    who.post(api('/ticketing/categories')).send({
      establishmentId: await firstEstablishment(organizationId),
      kind: 'ADULT',
      name: `Entrée ${randomUUID().slice(0, 6)}`,
      price: 2_000,
    });
  const sharedWrite = (who: Agent) =>
    who.post(api('/customers')).send({
      consent: true,
      firstName: 'Awa',
      lastName: 'Diallo',
      phone: `+2237${Date.now() % 10_000_000}`,
    });

  async function setRestaurantOpen(open: boolean) {
    if (open) {
      await owner.agent
        .patch(api(`/platform/plans/${restaurantFlatPlanId}`))
        .send({ isActive: true })
        .expect(200);
    }
    await owner.agent
      .patch(api(`/platform/products/${restaurantProductId}`))
      .send({ listed: open })
      .expect(200);
    if (!open) {
      await prisma.subscriptionPlan.update({
        where: { id: restaurantFlatPlanId },
        data: { isActive: false },
      });
    }
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, `s7owner-${RUN}`, 'PLATFORM_OWNER');
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: 'OCALL_RESTAURANT' },
    });
    restaurantProductId = product.id;
    restaurantFlatPlanId = (
      await prisma.subscriptionPlan.findFirstOrThrow({
        where: {
          productId: product.id,
          pricingMode: 'FLAT',
          includesShowcase: false,
          name: { contains: 'Sans vitrine' },
        },
      })
    ).id;
    // Sécurité : Ocall Restaurant fermé au départ (état du catalogue de la migration).
    expect(product.listed).toBe(false);
    combined = await signup(app, 's7combined', 'PARK_RESTAURANT');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.saasProduct.update({
          where: { code: 'OCALL_RESTAURANT' },
          data: { listed: false },
        });
        await prisma.subscriptionPlan.update({
          where: { id: restaurantFlatPlanId },
          data: { isActive: false },
        });
        await cleanup(prisma);
      }
    } finally {
      await app?.close();
    }
  });

  it('migration : offres forfaitaires Restaurant inactives, aucune offre active modifiée', async () => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { product: { code: 'OCALL_RESTAURANT' }, name: { startsWith: 'Ocall Restaurant — ' } },
      orderBy: { name: 'asc' },
    });
    expect(plans.map((p) => [p.name, p.pricingMode, p.monthlyPrice, p.isActive])).toEqual([
      ['Ocall Restaurant — Avec vitrine', 'FLAT', 65_000, false],
      ['Ocall Restaurant — Par site', 'PER_SITE', 17_500, false],
      ['Ocall Restaurant — Par site avec vitrine', 'PER_SITE', 17_500, false],
      ['Ocall Restaurant — Sans vitrine', 'FLAT', 50_000, false],
    ]);
  });

  it('avant l’ouverture : inscription « parc et restaurant » = contrat Ocall Park combiné, droits sur les deux activités', async () => {
    const subs = await subsOf(combined.organizationId);
    expect(subs.map((s) => [s.product.code, s.status, s.parkCombined?.status])).toEqual([
      ['OCALL_PARK', 'TRIALING', 'ACTIVE'],
    ]);
    expect(subs[0]!.parkCombined?.origin).toBe('SIGNUP');
    expect((await me(combined.agent)).activityAccess).toEqual({ PARK: 'full', RESTAURANT: 'full' });
    expect((await restaurantWrite(combined.agent)).status).toBe(201);
    expect((await parkWrite(combined.agent, combined.organizationId)).status).toBe(201);
    // Restaurant fermé : ni essai, ni souscription séparée.
    const trial = await combined.agent.post(api('/suite/apps/OCALL_RESTAURANT/trial'));
    expect([409, 404]).toContain(trial.status);
    const created = await owner.agent
      .post(api(`/platform/organizations/${combined.organizationId}/subscriptions`))
      .send({ productId: restaurantProductId, planId: restaurantFlatPlanId });
    expect([400, 409]).toContain(created.status);
    expect(
      await prisma.subscription.count({
        where: { organizationId: combined.organizationId, productId: restaurantProductId },
      }),
    ).toBe(0);
  });

  it('ouverture explicite par Ocall : refusée sans offre forfaitaire Restaurant active', async () => {
    const refused = await owner.agent
      .patch(api(`/platform/products/${restaurantProductId}`))
      .send({ listed: true });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RESTAURANT_PLAN_REQUIRED');
  });

  describe('après l’ouverture d’Ocall Restaurant', () => {
    let both: SignedUpOwner;
    let parkOnly: SignedUpOwner;

    beforeAll(async () => {
      await setRestaurantOpen(true);
      both = await signup(app, 's7both', 'PARK_RESTAURANT');
      parkOnly = await signup(app, 's7parkonly', 'PARK');
    }, 300_000);

    afterAll(async () => {
      await setRestaurantOpen(false);
    });

    it('une inscription, deux applications : deux essais, deux abonnements distincts, une session', async () => {
      const subs = await subsOf(both.organizationId);
      expect(subs.map((s) => [s.product.code, s.status, s.parkCombined])).toEqual([
        ['OCALL_PARK', 'TRIALING', null],
        ['OCALL_RESTAURANT', 'TRIALING', null],
      ]);
      expect(
        await prisma.productTrial.count({ where: { organizationId: both.organizationId } }),
      ).toBe(2);
      // Une seule session : le même agent écrit dans les deux applications.
      expect((await me(both.agent)).activityAccess).toEqual({ PARK: 'full', RESTAURANT: 'full' });
      expect((await restaurantWrite(both.agent)).status).toBe(201);
      expect((await parkWrite(both.agent, both.organizationId)).status).toBe(201);
      // Aucune offre par site attribuée automatiquement.
      expect(subs.every((s) => s.planId !== null)).toBe(true);
      const plans = await prisma.subscriptionPlan.findMany({
        where: { id: { in: subs.map((s) => s.planId) } },
      });
      expect(plans.every((p) => p.pricingMode === 'FLAT')).toBe(true);
    });

    it('droits distincts : Restaurant échu → restaurant en lecture seule, parc et modules communs ouverts', async () => {
      const resto = (await subsOf(both.organizationId)).find(
        (s) => s.product.code === 'OCALL_RESTAURANT',
      )!;
      await prisma.productTrial.update({
        where: {
          organizationId_productId: {
            organizationId: both.organizationId,
            productId: resto.productId,
          },
        },
        data: { endsAt: new Date(Date.now() - DAY) },
      });
      expect((await me(both.agent)).activityAccess).toEqual({
        PARK: 'full',
        RESTAURANT: 'read_only',
      });
      const denied = await restaurantWrite(both.agent);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('PARK_READ_ONLY');
      expect(denied.body.message).toContain('Ocall Restaurant');
      expect((await parkWrite(both.agent, both.organizationId)).status).toBe(201);
      // Interconnexions conservées : clients communs, caisse commune, consultation du catalogue.
      expect((await sharedWrite(both.agent)).status).toBe(201);
      await both.agent.get(api('/catalog/categories')).expect(200);
      const est = await firstEstablishment(both.organizationId);
      expect(
        (
          await both.agent
            .post(api('/cash-sessions'))
            .send({ establishmentId: est, openingFloat: 0 })
        ).status,
      ).toBe(201);
      const sale = await both.agent.post(api('/sales')).send({
        establishmentId: est,
        lines: [{ variantId: randomUUID(), quantity: 1 }],
        clientRequestId: randomUUID(),
      });
      expect(sale.status).toBe(403);
      expect(sale.body.code).toBe('PARK_READ_ONLY');
    });

    it('menu QR public consultable, nouvelle commande refusée sans droit Restaurant actif', async () => {
      const est = await firstEstablishment(both.organizationId);
      // Préparation pendant l'essai Restaurant (droit actif), puis échéance.
      const resto = (await subsOf(both.organizationId)).find(
        (s) => s.product.code === 'OCALL_RESTAURANT',
      )!;
      const key = { organizationId: both.organizationId, productId: resto.productId };
      await prisma.productTrial.update({
        where: { organizationId_productId: key },
        data: { endsAt: new Date(Date.now() + DAY) },
      });
      const category = (
        await both.agent.post(api('/catalog/categories')).send({ name: 'Boissons QR' }).expect(201)
      ).body.id;
      const product = (
        await both.agent
          .post(api('/catalog/products'))
          .send({
            name: 'Jus de bissap',
            categoryId: category,
            variants: [{ name: 'Verre', prices: [{ establishmentId: est, price: 500 }] }],
          })
          .expect(201)
      ).body as { variants: { id: string }[] };
      await both.agent
        .post(api('/restaurant/zones'))
        .send({ establishmentId: est, name: 'Terrasse QR', kind: 'TERRACE' })
        .expect(201);
      const dining = (
        await both.agent.get(api(`/restaurant/dining?establishmentId=${est}`)).expect(200)
      ).body;
      const token = dining.zones
        .find((z: { name: string }) => z.name === 'Terrasse QR')
        .qrPath.split('/')
        .pop();
      const order = () =>
        request(app.getHttpServer())
          .post(api(`/public/menu/${token}/orders`))
          .send({
            clientRequestId: randomUUID(),
            lines: [{ variantId: product.variants[0]!.id, quantity: 1 }],
          });
      expect((await order()).status).toBe(201);
      await prisma.productTrial.update({
        where: { organizationId_productId: key },
        data: { endsAt: new Date(Date.now() - DAY) },
      });
      await request(app.getHttpServer())
        .get(api(`/public/menu/${token}`))
        .expect(200);
      const refused = await order();
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('ONLINE_ORDERING_UNAVAILABLE');
    });

    it('parrainage : une attribution par application souscrite à l’inscription', async () => {
      const partner = await partnerAccount(app, owner.agent, 's7ref');
      const res = await request(app.getHttpServer())
        .post(api('/auth/signup'))
        .send({
          organizationName: `Test s7ref ${RUN}`,
          businessType: 'PARK_RESTAURANT',
          countryCode: 'ML',
          establishmentName: 'Site principal s7ref',
          firstName: 'Awa',
          lastName: 'Traoré',
          email: email('s7refclient'),
          password: PASSWORD,
          ref: partner.code,
        })
        .expect(201);
      const attributions = await prisma.attribution.findMany({
        where: { organizationId: res.body.organization.id },
        include: { product: { select: { code: true } } },
        orderBy: { createdAt: 'asc' },
      });
      expect(attributions.map((a) => [a.product?.code, a.partnerId, a.status, a.source])).toEqual([
        ['OCALL_PARK', partner.partnerId, 'PENDING', 'REFERRAL'],
        ['OCALL_RESTAURANT', partner.partnerId, 'PENDING', 'REFERRAL'],
      ]);
    });

    it('client parc qui ajoute le restaurant : essai Ocall Restaurant démarré, abonnement Parc inchangé', async () => {
      const before = await subsOf(parkOnly.organizationId);
      expect(before.map((s) => s.product.code)).toEqual(['OCALL_PARK']);
      await parkOnly.agent
        .post(api('/organization/business-type'))
        .send({ businessType: 'PARK_RESTAURANT' })
        .expect((r) => expect(r.status).toBeLessThan(300));
      const after = await subsOf(parkOnly.organizationId);
      expect(after.map((s) => [s.product.code, s.status])).toEqual([
        ['OCALL_PARK', 'TRIALING'],
        ['OCALL_RESTAURANT', 'TRIALING'],
      ]);
      expect(after[0]).toMatchObject({ planId: before[0]!.planId, status: before[0]!.status });
    });

    it('portail : contrat combiné présenté sous Ocall Park, Restaurant « inclus » sans essai ni souscription', async () => {
      const apps = (await combined.agent.get(api('/suite/overview')).expect(200)).body as {
        code: string;
        includedIn?: string | null;
        canStartTrial: boolean;
        requestKinds: string[];
        subscription: unknown;
      }[];
      const resto = apps.find((a) => a.code === 'OCALL_RESTAURANT')!;
      expect(resto).toMatchObject({
        includedIn: 'OCALL_PARK',
        canStartTrial: false,
        requestKinds: [],
      });
      expect(apps.find((a) => a.code === 'OCALL_PARK')?.subscription).toBeTruthy();
      const trial = await combined.agent.post(api('/suite/apps/OCALL_RESTAURANT/trial'));
      expect(trial.body.code).toBe('INCLUDED_IN_COMBINED_CONTRACT');
      // Organisation à deux applications : deux tuiles, chacune son abonnement.
      const two = (await both.agent.get(api('/suite/overview')).expect(200)).body as {
        code: string;
        includedIn?: string | null;
        subscription: unknown;
      }[];
      expect(two.find((a) => a.code === 'OCALL_RESTAURANT')).toMatchObject({ includedIn: null });
      expect(two.find((a) => a.code === 'OCALL_RESTAURANT')?.subscription).toBeTruthy();
    });

    it('facturation par site : Ocall Parc séparé ne compte que le parc, le contrat combiné les deux', async () => {
      const sites = app.get(SiteActivationService);
      await prisma.establishment.create({
        data: {
          organizationId: both.organizationId,
          name: `Restaurant seul ${RUN}`,
          businessType: 'RESTAURANT',
        },
      });
      const park = await sites.countLive(both.organizationId, 'OCALL_PARK');
      const resto = await sites.countLive(both.organizationId, 'OCALL_RESTAURANT');
      const union = await sites.countLive(both.organizationId, 'OCALL_PARK', true);
      expect([park, resto, union]).toEqual([1, 2, 2]);
    });

    it('bascule explicite d’un contrat combiné : total conservé et réparti, sans mise en service, partenaire prolongé', async () => {
      const [sub] = await subsOf(combined.organizationId);
      const start = new Date();
      await prisma.$transaction((tx) =>
        extendSubscription(tx, {
          subscriptionId: sub!.id,
          periodStart: start,
          periodEnd: new Date(start.getTime() + 29 * DAY),
          actorUserId: owner.id,
          reason: 'Paiement fictif S7',
        }),
      );
      const active = await prisma.subscription.findUniqueOrThrow({ where: { id: sub!.id } });
      expect(active.agreedMonthlyPrice).toBe(50_000);
      // Partenaire attribué (Ocall Park), confirmé par Ocall.
      const partner = await partnerAccount(app, owner.agent, 's7partner');
      const parkProduct = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: 'OCALL_PARK' },
      });
      const attribution = await prisma.attribution.create({
        data: {
          organizationId: combined.organizationId,
          productId: parkProduct.id,
          partnerId: partner.partnerId,
          source: 'ADMIN',
          status: 'CONFIRMED',
          confirmedAt: new Date(),
        },
      });
      const history = {
        invoices: await prisma.invoice.count({
          where: { organizationId: combined.organizationId },
        }),
        payments: await prisma.subscriptionPayment.count({
          where: { organizationId: combined.organizationId },
        }),
      };

      // Sécurité : jamais par le client ; répartition invalide refusée ; facture ouverte bloquante.
      await combined.agent
        .post(api(`/platform/subscriptions/${sub!.id}/park-restaurant-switch`))
        .send({ park: 25_000, restaurant: 25_000, reason: 'Essai client' })
        .expect(403);
      const bad = await owner.agent
        .post(api(`/platform/subscriptions/${sub!.id}/park-restaurant-switch`))
        .send({ park: 30_000, restaurant: 25_000, reason: 'Répartition fausse' });
      expect(bad.body.code).toBe('SWITCH_SPLIT_INVALID');
      const invoice = await owner.agent
        .post(api('/platform/invoices'))
        .send({
          subscriptionId: sub!.id,
          lines: [{ kind: 'MONTHLY', months: 1 }],
          idempotencyKey: randomUUID(),
        })
        .expect(201);
      const open = await owner.agent
        .post(api(`/platform/subscriptions/${sub!.id}/park-restaurant-switch`))
        .send({ park: 30_000, restaurant: 20_000, reason: 'Facture ouverte' });
      expect(open.body.code).toBe('SWITCH_OPEN_BILLING');
      await owner.agent
        .post(api(`/platform/invoices/${invoice.body.id}/cancel`))
        .send({ reason: 'Annulée pour la bascule (essai S7)' })
        .expect((r) => expect(r.status).toBeLessThan(300));

      const done = await owner.agent
        .post(api(`/platform/subscriptions/${sub!.id}/park-restaurant-switch`))
        .send({ park: 30_000, restaurant: 20_000, reason: 'Accord client du 16/11' })
        .expect(200);
      expect(done.body).toMatchObject({
        total: 50_000,
        split: { park: 30_000, restaurant: 20_000 },
      });

      const subs = await subsOf(combined.organizationId);
      const park = subs.find((s) => s.product.code === 'OCALL_PARK')!;
      const resto = subs.find((s) => s.product.code === 'OCALL_RESTAURANT')!;
      expect(park).toMatchObject({ id: sub!.id, status: 'ACTIVE', agreedMonthlyPrice: 30_000 });
      expect(park.parkCombined).toMatchObject({
        status: 'SWITCHED',
        parkSubscriptionId: park.id,
        restaurantSubscriptionId: resto.id,
        split: { total: 50_000, park: 30_000, restaurant: 20_000, basis: 'explicit' },
      });
      // Même échéance et même statut : aucun droit perdu, aucune période facturée deux fois.
      expect(resto).toMatchObject({
        status: 'ACTIVE',
        agreedMonthlyPrice: 20_000,
        agreedSetupFee: 0,
        expiresAt: active.expiresAt,
        startedAt: active.startedAt,
      });
      expect(
        await prisma.productSetupFee.findUniqueOrThrow({
          where: {
            organizationId_productId: {
              organizationId: combined.organizationId,
              productId: resto.productId,
            },
          },
        }),
      ).toMatchObject({ status: 'WAIVED', amount: 0 });
      expect((await me(combined.agent)).activityAccess).toEqual({
        PARK: 'full',
        RESTAURANT: 'full',
      });
      // Partenaire : copie tracée vers Ocall Restaurant, aucune autre.
      const copies = await prisma.attribution.findMany({
        where: { organizationId: combined.organizationId, derivedFromId: attribution.id },
      });
      expect(copies.map((c) => [c.productId, c.partnerId, c.status])).toEqual([
        [resto.productId, partner.partnerId, 'CONFIRMED'],
      ]);
      // Commissions : chaque application n'est couverte que par sa propre attribution (pas de doublon).
      const scopes = await prisma.$transaction(async (tx) => ({
        park: await attributionScope(tx, park.productId, park.id),
        resto: await attributionScope(tx, resto.productId, resto.id),
      }));
      expect(scopes.park.productIds).toEqual([park.productId]);
      expect(scopes.resto.productIds).toEqual([resto.productId]);
      // Historique de facturation intact (factures, règlements) ; historique des prix complété.
      expect(
        await prisma.invoice.count({ where: { organizationId: combined.organizationId } }),
      ).toBe(history.invoices + 1);
      expect(
        await prisma.subscriptionPayment.count({
          where: { organizationId: combined.organizationId },
        }),
      ).toBe(history.payments);
      expect(
        await prisma.subscriptionPriceHistory.findFirst({
          where: { subscriptionId: park.id, effectiveTo: null },
        }),
      ).toMatchObject({ monthlyPrice: 30_000 });
      // Seconde bascule impossible.
      const again = await owner.agent
        .post(api(`/platform/subscriptions/${sub!.id}/park-restaurant-switch`))
        .send({ park: 15_000, restaurant: 15_000, reason: 'Doublon' });
      expect(again.body.code).toBe('NOT_COMBINED_CONTRACT');
    });

    it('contrat historique « Parc + Restaurant » : basculé vers deux abonnements, l’ancien clos et conservé', async () => {
      const legacy = await signup(app, 's7legacy', 'PARK_RESTAURANT');
      // Simulation d'un contrat antérieur au socle S1 sur le produit combiné (migration).
      const legacyProduct = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: 'OCALL_PARK_RESTAURANT' },
      });
      const legacyPlan = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { productId: legacyProduct.id },
      });
      // État antérieur reconstitué : un seul contrat, sur le produit combiné historique.
      await prisma.subscription.deleteMany({ where: { organizationId: legacy.organizationId } });
      const old = await prisma.subscription.create({
        data: {
          organizationId: legacy.organizationId,
          productId: legacyProduct.id,
          planId: legacyPlan.id,
          status: 'ACTIVE',
          startedAt: new Date(Date.now() - 60 * DAY),
          expiresAt: new Date(Date.now() + 20 * DAY),
          agreedMonthlyPrice: 25_000,
          agreedSetupFee: 350_000,
          agreedAt: new Date(Date.now() - 60 * DAY),
        },
      });
      await prisma.parkCombinedContract.create({
        data: {
          organizationId: legacy.organizationId,
          subscriptionId: old.id,
          origin: 'MIGRATION',
        },
      });
      expect((await me(legacy.agent)).activityAccess).toEqual({ PARK: 'full', RESTAURANT: 'full' });
      await owner.agent
        .post(api(`/platform/subscriptions/${old.id}/park-restaurant-switch`))
        .send({ park: 15_000, restaurant: 10_000, reason: 'Retrait de l’offre combinée' })
        .expect(200);
      const subs = await subsOf(legacy.organizationId);
      expect(subs.map((s) => [s.product.code, s.status, s.agreedMonthlyPrice]).sort()).toEqual([
        ['OCALL_PARK', 'ACTIVE', 15_000],
        ['OCALL_PARK_RESTAURANT', 'CANCELED', 25_000],
        ['OCALL_RESTAURANT', 'ACTIVE', 10_000],
      ]);
      expect((await me(legacy.agent)).activityAccess).toEqual({ PARK: 'full', RESTAURANT: 'full' });
      expect(await loadActivityAccess(prisma, legacy.organizationId, 'RESTAURANT')).toBe('full');
    });
  });

  it('après refermeture : nouvelle inscription de nouveau en contrat combiné (aucun effet rétroactif)', async () => {
    const later = await signup(app, 's7later', 'RESTAURANT');
    const subs = await subsOf(later.organizationId);
    expect(subs.map((s) => [s.product.code, s.parkCombined?.status])).toEqual([
      ['OCALL_PARK', 'ACTIVE'],
    ]);
  });
});
