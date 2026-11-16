import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { extendSubscription } from '../src/common/subscription-billing';
import { EstablishmentRegistryService } from '../src/modules/establishments/establishment-registry.service';
import { SiteActivationService } from '../src/modules/establishments/site-activation.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  signup,
} from './helpers';

/**
 * Ocall Suite — étape 6 : facturation par site activé.
 *
 * Une organisation Ocall Park avec un parc, un restaurant, un établissement « parc et restaurant » et un
 * lieu sans activité ; une seconde organisation reste au forfait historique. Le décompte compte parc et
 * restaurant séparément sans jamais facturer deux fois un établissement pour la même application ; la
 * première facture fige le tarif par site et la mise en service (150 000 puis 112 500) ; un site ajouté
 * est facturé au prorata, un retrait prend effet à l'échéance ; les contrats forfaitaires et leurs prix
 * figés ne changent pas ; l'aperçu de séparation Parc / Restaurant n'écrit rien. Bases de test locales
 * jetables uniquement.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const stockEnabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);

describe('Ocall Suite S6 — facturation par site', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sitesService: SiteActivationService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let org: SignedUpOwner;
  let flat: SignedUpOwner;
  let estMain: string;
  let estResto: string;
  let estBoth: string;
  let estNone: string;
  let parkSubId: string;
  const plans: string[] = [];

  const lines = (invoice: { lines: { kind: string; quantity: number; amount: number }[] }) =>
    invoice.lines.map((l) => [l.kind, l.quantity, l.amount]);

  async function issue(subscriptionId: string, body: Record<string, unknown>[]) {
    const res = await owner.agent
      .post(api('/platform/invoices'))
      .send({ subscriptionId, lines: body, idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    return res.body as {
      id: string;
      total: number;
      lines: { kind: string; quantity: number; unitAmount: number; amount: number }[];
    };
  }

  async function testPlan(code: string, perSite: boolean, isActive = false) {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
    const plan = await prisma.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `S6 ${code} ${perSite ? 'par site' : 'forfait'} ${RUN}`,
        monthlyPrice: perSite ? 17_500 : 50_000,
        setupFee: perSite ? 150_000 : 200_000,
        ...(perSite
          ? { pricingMode: 'PER_SITE', extraSiteMonthlyPrice: 7_500, extraAppSetupFee: 112_500 }
          : {}),
        isActive,
      },
    });
    plans.push(plan.id);
    return plan;
  }

  const establishment = (
    name: string,
    businessType: 'PARK' | 'RESTAURANT' | 'PARK_RESTAURANT' | 'NONE',
  ) =>
    prisma.establishment
      .create({
        data: { organizationId: org.organizationId, name: `${name} ${RUN}`, businessType },
      })
      .then((e) => e.id);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    sitesService = app.get(SiteActivationService);
    owner = await internalAccount(app, prisma, `s6owner-${RUN}`, 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, `s6billing-${RUN}`, 'BILLING_MANAGER');
    org = await signup(app, 's6park', 'PARK');
    flat = await signup(app, 's6flat', 'PARK');
    estMain = (
      await prisma.establishment.findFirstOrThrow({ where: { organizationId: org.organizationId } })
    ).id;
    estResto = await establishment('Restaurant S6', 'RESTAURANT');
    estBoth = await establishment('Parc et restaurant S6', 'PARK_RESTAURANT');
    estNone = await establishment('Agence S6', 'NONE');
  }, 300_000);

  afterAll(async () => {
    try {
      if (stockEnabled && app && org) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(app.get(OcallStockPrismaService), [org.organizationId]);
      }
      if (prisma) {
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('migration : offres par site créées inactives, offres historiques forfaitaires inchangées', async () => {
    const perSite = await prisma.subscriptionPlan.findMany({
      where: { pricingMode: 'PER_SITE', name: { contains: '— Par site' } },
      include: { product: { select: { code: true } } },
    });
    expect(perSite).toHaveLength(10);
    for (const p of perSite) {
      expect(p).toMatchObject({
        isActive: false,
        monthlyPrice: 17_500,
        extraSiteMonthlyPrice: 7_500,
        setupFee: 150_000,
        extraAppSetupFee: 112_500,
        showcaseMonthlyPrice: p.includesShowcase ? 5_000 : null,
      });
    }
    expect(new Set(perSite.map((p) => p.product!.code))).toEqual(
      new Set(['OCALL_PARK', 'OCALL_RESTAURANT', 'OCALL_SCHOOL', 'OCALL_FACTURE', 'OCALL_STOCK']),
    );
    const active = await prisma.subscriptionPlan.findMany({
      where: { isActive: true, product: { code: 'OCALL_PARK' } },
    });
    expect(active.map((p) => [p.pricingMode, p.monthlyPrice]).sort()).toEqual([
      ['FLAT', 50_000],
      ['FLAT', 65_000],
    ]);
  });

  it('forfait historique : facture, tarif figé et historique identiques à avant l’étape 6', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { organizationId: flat.organizationId },
    });
    const invoice = await issue(sub.id, [{ kind: 'MONTHLY', months: 2 }, { kind: 'SETUP' }]);
    expect(lines(invoice)).toEqual([
      ['MONTHLY', 2, 100_000],
      ['SETUP', 1, 200_000],
    ]);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.sitesSnapshot).toBeNull();
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({
      agreedMonthlyPrice: 50_000,
      agreedSetupFee: 200_000,
      agreedExtraSitePrice: null,
      agreedShowcasePrice: null,
      billedSiteCount: null,
    });
    const history = await prisma.subscriptionPriceHistory.findFirstOrThrow({
      where: { subscriptionId: sub.id, effectiveTo: null },
    });
    expect(history).toMatchObject({
      monthlyPrice: 50_000,
      extraSitePrice: null,
      showcasePrice: null,
    });
    // Aucune activation de site pour un forfait.
    expect(
      await prisma.siteActivation.count({ where: { organizationId: flat.organizationId } }),
    ).toBe(0);
  });

  it('décompte : parc et restaurant comptés séparément, établissement mixte une seule fois, lieu sans activité exclu', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { organizationId: org.organizationId, product: { code: 'OCALL_PARK' } },
    });
    parkSubId = sub.id;
    const plan = await testPlan('OCALL_PARK', true);
    await prisma.subscription.update({ where: { id: sub.id }, data: { planId: plan.id } });

    const view = (
      await billing.agent.get(api(`/platform/subscriptions/${sub.id}/sites`)).expect(200)
    ).body;
    expect(view.pricingMode).toBe('PER_SITE');
    expect(view.billedSites).toBe(3);
    expect(view.monthlyAmount).toBe(32_500);
    const byKey = Object.fromEntries(
      (view.sites as { siteKey: string; sources: string[] }[]).map((s) => [
        s.siteKey,
        s.sources.sort(),
      ]),
    );
    expect(byKey).toEqual({
      [estMain]: ['OCALL_PARK'],
      [estResto]: ['OCALL_RESTAURANT'],
      [estBoth]: ['OCALL_PARK', 'OCALL_RESTAURANT'],
    });
    expect(byKey[estNone]).toBeUndefined();
    // Activations enregistrées par application source (séparation préparée).
    const open = await prisma.siteActivation.findMany({
      where: { organizationId: org.organizationId, endedAt: null },
      select: { productCode: true, siteKey: true },
    });
    expect(
      open
        .filter((a) => a.productCode === 'OCALL_PARK')
        .map((a) => a.siteKey)
        .sort(),
    ).toEqual([estMain, estBoth].sort());
    expect(
      open
        .filter((a) => a.productCode === 'OCALL_RESTAURANT')
        .map((a) => a.siteKey)
        .sort(),
    ).toEqual([estResto, estBoth].sort());
    // Facture : toujours un site ; School sans école : le minimum d'un site.
    expect(await sitesService.countLive(org.organizationId, 'OCALL_FACTURE')).toBe(1);
    expect(await sitesService.countLive(org.organizationId, 'OCALL_RESTAURANT')).toBe(2);
    // Index unique partiel : jamais deux activations ouvertes pour le même site (unité).
    await expect(
      prisma.siteActivation.create({
        data: {
          organizationId: org.organizationId,
          productCode: 'OCALL_PARK',
          siteKey: estMain,
          unitKey: estMain,
          label: 'doublon',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('première facture par site : tarif figé, mise en service de la première application, photographie', async () => {
    const invoice = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }, { kind: 'SETUP' }]);
    expect(lines(invoice)).toEqual([
      ['MONTHLY', 1, 17_500],
      ['EXTRA_SITES', 2, 15_000],
      ['SETUP', 1, 150_000],
    ]);
    expect(invoice.total).toBe(182_500);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.sitesSnapshot).toMatchObject({
      pricingMode: 'PER_SITE',
      billedSites: 3,
      prices: { firstSite: 17_500, extraSite: 7_500, showcase: 0 },
      prorata: [],
    });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } });
    expect(sub).toMatchObject({
      agreedMonthlyPrice: 17_500,
      agreedExtraSitePrice: 7_500,
      agreedShowcasePrice: 0,
      agreedSetupFee: 150_000,
      billedSiteCount: 3,
    });
    const history = await prisma.subscriptionPriceHistory.findFirstOrThrow({
      where: { subscriptionId: parkSubId, effectiveTo: null },
    });
    expect(history).toMatchObject({
      monthlyPrice: 17_500,
      extraSitePrice: 7_500,
      showcasePrice: 0,
    });
    // Le client ne saisit jamais de ligne de site.
    const forged = await owner.agent.post(api('/platform/invoices')).send({
      subscriptionId: parkSubId,
      lines: [{ kind: 'EXTRA_SITES', months: 1 }],
      idempotencyKey: randomUUID(),
    });
    expect(forged.status).toBe(400);
  });

  it('site ajouté : prorata jusqu’à l’échéance une seule fois ; retrait effectif à l’échéance, activation conservée', async () => {
    const start = new Date();
    await prisma.$transaction((tx) =>
      extendSubscription(tx, {
        subscriptionId: parkSubId,
        periodStart: start,
        periodEnd: new Date(start.getTime() + 29 * DAY),
        actorUserId: null,
        reason: 'Paiement fictif S6',
      }),
    );
    const { expiresAt } = await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } });
    const estPark2 = await establishment('Parc 2 S6', 'PARK');

    const renewal = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    const added = await prisma.siteActivation.findFirstOrThrow({
      where: { organizationId: org.organizationId, siteKey: estPark2, endedAt: null },
    });
    const days = Math.ceil((expiresAt!.getTime() - added.startedAt.getTime()) / DAY);
    const prorata = Math.round((7_500 * days) / 30);
    expect(lines(renewal)).toEqual([
      ['MONTHLY', 1, 17_500],
      ['EXTRA_SITES', 3, 22_500],
      ['SITE_PRORATA', 1, prorata],
    ]);
    // Facture suivante sans nouveau site : aucun prorata (jamais deux fois).
    const again = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(lines(again)).toEqual([
      ['MONTHLY', 1, 17_500],
      ['EXTRA_SITES', 3, 22_500],
    ]);

    // Retrait : l'activation est fermée, jamais supprimée ; la période en cours n'est pas réduite.
    await prisma.establishment.update({ where: { id: estPark2 }, data: { isActive: false } });
    const view = (
      await billing.agent.get(api(`/platform/subscriptions/${parkSubId}/sites`)).expect(200)
    ).body;
    expect(view.billedSites).toBe(3);
    const closed = await prisma.siteActivation.findUniqueOrThrow({ where: { id: added.id } });
    expect(closed.endedAt).not.toBeNull();
    const next = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(lines(next)).toEqual([
      ['MONTHLY', 1, 17_500],
      ['EXTRA_SITES', 2, 15_000],
    ]);
    // Revenu mensuel du portail client : dernier décompte et prix figés.
    const overview = (await org.agent.get(api('/suite/overview')).expect(200)).body as {
      code: string;
      subscription: { monthlyPrice: number } | null;
    }[];
    expect(overview.find((a) => a.code === 'OCALL_PARK')?.subscription?.monthlyPrice).toBe(32_500);
  });

  it('ajouts et retraits dans la période, renouvellement, changement d’offre : chaque site payé une seule fois', async () => {
    const sync = () =>
      billing.agent.get(api(`/platform/subscriptions/${parkSubId}/sites`)).expect(200);
    const setActive = (id: string, isActive: boolean) =>
      prisma.establishment.update({ where: { id }, data: { isActive } });
    const prorataOf = (invoice: Awaited<ReturnType<typeof issue>>) =>
      invoice.lines.find((l) => l.kind === 'SITE_PRORATA')?.amount ?? 0;
    const extraOf = (invoice: Awaited<ReturnType<typeof issue>>) =>
      invoice.lines.find((l) => l.kind === 'EXTRA_SITES')?.quantity ?? 0;
    const expected = async (unitKey: string) => {
      // Activation la plus récente du site (celle que la facture porte au prorata).
      const [first] = await prisma.siteActivation.findMany({
        where: { organizationId: org.organizationId, unitKey },
        orderBy: { startedAt: 'desc' },
        take: 1,
      });
      const { expiresAt } = await prisma.subscription.findUniqueOrThrow({
        where: { id: parkSubId },
      });
      const days = Math.ceil((expiresAt!.getTime() - first!.startedAt.getTime()) / DAY);
      return Math.round((7_500 * days) / 30);
    };

    // 1. Ajouté puis retiré avant la facture suivante : prorata conservé jusqu'à l'échéance.
    const p3 = await establishment('Parc 3 S6', 'PARK');
    await sync();
    await setActive(p3, false);
    await sync();
    const withRemoved = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(prorataOf(withRemoved)).toBe(await expected(p3));
    // Le site retiré n'est pas porté par les mensualités suivantes (retrait effectif à l'échéance).
    expect(extraOf(withRemoved)).toBe(2);

    // 2. Facture intermédiaire pendant le retrait, puis retour dans la même période : déjà payé.
    const meanwhile = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(prorataOf(meanwhile)).toBe(0);
    await setActive(p3, true);
    await sync();
    const readded = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(prorataOf(readded)).toBe(0);
    expect(extraOf(readded)).toBe(3);

    // 3. Renouvellement réglé (nouvelle période) puis retrait et retour : couvert par les mensualités.
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } });
    await prisma.$transaction((tx) =>
      extendSubscription(tx, {
        subscriptionId: parkSubId,
        periodStart: sub.expiresAt!,
        periodEnd: new Date(sub.expiresAt!.getTime() + 29 * DAY),
        actorUserId: null,
        reason: 'Renouvellement fictif S6',
      }),
    );
    await setActive(p3, false);
    await sync();
    await setActive(p3, true);
    await sync();
    // Parc 2 : porté au prorata de l'ancienne période puis retiré avant le renouvellement ; rajouté
    // dans la nouvelle période, il n'y est pas payé : de nouveau dû (une fois).
    const p2 = (
      await prisma.establishment.findFirstOrThrow({
        where: { organizationId: org.organizationId, name: `Parc 2 S6 ${RUN}` },
      })
    ).id;
    await setActive(p2, true);
    await sync();
    const p4 = await establishment('Parc 4 S6', 'PARK');
    await sync();
    const renewed = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    // Parc 3 (payé par les mensualités) : rien ; Parc 2 et Parc 4 : prorata jusqu'à la nouvelle échéance.
    expect(prorataOf(renewed)).toBe((await expected(p2)) + (await expected(p4)));
    expect(extraOf(renewed)).toBe(5);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: renewed.id } });
    const snap = stored.sitesSnapshot as { prorata: { unitKey: string }[]; coveredUnits: string[] };
    expect(snap.prorata.map((x) => x.unitKey)).toEqual([p2, p4]);
    expect(snap.coveredUnits).toEqual(expect.arrayContaining([p3, p4, estMain]));

    // 4. Changement d'offre (vitrine) : tarif refigé, pas de prorata, aucun site facturé deux fois.
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_PARK' } });
    const showcase = await prisma.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `S6 OCALL_PARK par site avec vitrine ${RUN}`,
        monthlyPrice: 17_500,
        setupFee: 150_000,
        pricingMode: 'PER_SITE',
        extraSiteMonthlyPrice: 7_500,
        showcaseMonthlyPrice: 5_000,
        extraAppSetupFee: 112_500,
        includesShowcase: true,
        isActive: true,
      },
    });
    plans.push(showcase.id);
    try {
      await owner.agent
        .post(api(`/platform/subscriptions/${parkSubId}/change-plan`))
        .send({ planId: showcase.id, reason: 'Ajout de la vitrine (essai S6)' })
        .expect(200);
    } finally {
      await prisma.subscriptionPlan.update({
        where: { id: showcase.id },
        data: { isActive: false },
      });
    }
    const p5 = await establishment('Parc 5 S6', 'PARK');
    await sync();
    const afterChange = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(prorataOf(afterChange)).toBe(0);
    expect(extraOf(afterChange)).toBe(6);
    expect(afterChange.lines.find((l) => l.kind === 'SHOWCASE')?.amount).toBe(5_000);
    const again = await issue(parkSubId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(prorataOf(again)).toBe(0);

    // Aucune activation supprimée : chaque retrait a fermé une période, chaque retour en a ouvert une.
    expect(
      await prisma.siteActivation.count({
        where: { organizationId: org.organizationId, unitKey: p3 },
      }),
    ).toBe(3);
    // Retour à l'état des tests suivants (parc, restaurant, mixte).
    for (const id of [p2, p3, p4, p5]) await setActive(id, false);
    await sync();
  });

  it('application supplémentaire : changement d’offre vers le par site, mise en service 112 500, Restaurant compté seul', async () => {
    const flatPlan = await testPlan('OCALL_RESTAURANT', false);
    const perSitePlan = await testPlan('OCALL_RESTAURANT', true, true);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: 'OCALL_RESTAURANT' },
    });
    const sub = await prisma.subscription.create({
      data: { organizationId: org.organizationId, productId: product.id, planId: flatPlan.id },
    });
    try {
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/change-plan`))
        .send({ planId: perSitePlan.id, reason: 'Passage au tarif par site (essai S6)' })
        .expect(200);
    } finally {
      await prisma.subscriptionPlan.update({
        where: { id: perSitePlan.id },
        data: { isActive: false },
      });
    }
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({
      planId: perSitePlan.id,
      agreedMonthlyPrice: 17_500,
      agreedExtraSitePrice: 7_500,
      agreedSetupFee: 112_500,
      // Ocall Restaurant : établissements avec activité restaurant seulement (restaurant + mixte).
      billedSiteCount: 2,
    });
    // L'abonnement Park et le forfait de l'autre organisation n'ont pas bougé.
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } })).toMatchObject(
      { agreedSetupFee: 150_000, agreedExtraSitePrice: 7_500 },
    );
    expect(
      await prisma.subscription.findFirstOrThrow({
        where: { organizationId: flat.organizationId },
      }),
    ).toMatchObject({ agreedMonthlyPrice: 50_000, agreedExtraSitePrice: null });
  });

  it('aperçu de la séparation Parc / Restaurant : contrats combinés repérés, aucune écriture, aucun prix changé', async () => {
    const before = {
      activations: await prisma.siteActivation.count(),
      subs: await prisma.subscription.findMany({
        where: { organizationId: { in: [org.organizationId, flat.organizationId] } },
        orderBy: { id: 'asc' },
      }),
    };
    const preview = (
      await billing.agent.get(api('/platform/subscriptions/park-restaurant-split')).expect(200)
    ).body as {
      subscriptionId: string;
      combined: boolean;
      monthlyAmount: number;
      targets: { productCode: string; sites: number }[];
    }[];
    const mixed = preview.find((p) => p.subscriptionId === parkSubId)!;
    expect(mixed.combined).toBe(true);
    expect(mixed.targets.map((t) => [t.productCode, t.sites])).toEqual([
      ['OCALL_PARK', 2],
      ['OCALL_RESTAURANT', 2],
    ]);
    const flatSub = before.subs.find((s) => s.organizationId === flat.organizationId)!;
    expect(preview.find((p) => p.subscriptionId === flatSub.id)).toMatchObject({
      combined: false,
      monthlyAmount: 50_000,
    });
    expect(await prisma.siteActivation.count()).toBe(before.activations);
    expect(
      await prisma.subscription.findMany({
        where: { organizationId: { in: [org.organizationId, flat.organizationId] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before.subs);
  });

  it('Super Admin : prix par site modifiables sur une offre par site seulement', async () => {
    const flatPlan = await testPlan('OCALL_SCHOOL', false);
    const refused = await owner.agent
      .patch(api(`/platform/plans/${flatPlan.id}`))
      .send({ extraSiteMonthlyPrice: 9_000 });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('PLAN_NOT_PER_SITE');
    const perSitePlan = await testPlan('OCALL_SCHOOL', true);
    const noShowcase = await owner.agent
      .patch(api(`/platform/plans/${perSitePlan.id}`))
      .send({ showcaseMonthlyPrice: 5_000 });
    expect(noShowcase.body.code).toBe('PLAN_WITHOUT_SHOWCASE');
    await owner.agent
      .patch(api(`/platform/plans/${perSitePlan.id}`))
      .send({ extraSiteMonthlyPrice: 8_000, extraAppSetupFee: 100_000 })
      .expect(200);
    expect(
      await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: perSitePlan.id } }),
    ).toMatchObject({
      pricingMode: 'PER_SITE',
      extraSiteMonthlyPrice: 8_000,
      extraAppSetupFee: 100_000,
    });
    // Les prix figés des abonnements existants ne bougent pas.
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } })).toMatchObject(
      { agreedExtraSitePrice: 7_500 },
    );
  });

  it('rapprochement horaire : décompte des abonnements par site mis à jour, forfaits ignorés', async () => {
    await prisma.subscription.update({ where: { id: parkSubId }, data: { billedSiteCount: 1 } });
    const result = await sitesService.syncPerSiteOrganizations();
    expect(result.synced).toBeGreaterThanOrEqual(2);
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: parkSubId } })).billedSiteCount,
    ).toBe(3);
    expect(
      (
        await prisma.subscription.findFirstOrThrow({
          where: { organizationId: flat.organizationId },
        })
      ).billedSiteCount,
    ).toBeNull();
  });

  it('application illisible : facture refusée (503), aucune facture, aucune activation fermée', async () => {
    const registry = app.get(EstablishmentRegistryService);
    const before = {
      invoices: await prisma.invoice.count({ where: { subscriptionId: parkSubId } }),
      open: await prisma.siteActivation.count({
        where: { organizationId: org.organizationId, endedAt: null },
      }),
    };
    const spy = jest.spyOn(registry, 'billableSites').mockImplementation(async (orgId, source) => {
      if (source === 'OCALL_RESTAURANT')
        throw new Error('base Restaurant injoignable (simulation)');
      return EstablishmentRegistryService.prototype.billableSites.call(registry, orgId, source);
    });
    try {
      const res = await owner.agent.post(api('/platform/invoices')).send({
        subscriptionId: parkSubId,
        lines: [{ kind: 'MONTHLY', months: 1 }],
        idempotencyKey: randomUUID(),
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SITE_COUNT_UNAVAILABLE');
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.invoice.count({ where: { subscriptionId: parkSubId } })).toBe(
      before.invoices,
    );
    expect(
      await prisma.siteActivation.count({
        where: { organizationId: org.organizationId, endedAt: null },
      }),
    ).toBe(before.open);
    // Application non chargée : jamais « aucun site ».
    await expect(registry.billableSites(org.organizationId, 'OCALL_INCONNUE')).rejects.toThrow(
      'application non chargée',
    );
  });

  it('inscription et essai : jamais d’offre par site choisie automatiquement, même active', async () => {
    const perSite = await prisma.subscriptionPlan.findMany({
      where: {
        pricingMode: 'PER_SITE',
        isActive: false,
        name: { contains: '— Par site' },
        product: { code: { in: ['OCALL_PARK', 'OCALL_SCHOOL'] } },
      },
      select: { id: true },
    });
    expect(perSite).toHaveLength(4);
    const ids = perSite.map((p) => p.id);
    await prisma.subscriptionPlan.updateMany({
      where: { id: { in: ids } },
      data: { isActive: true },
    });
    try {
      const fresh = await signup(app, 's6fresh', 'PARK');
      const parkSub = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: fresh.organizationId },
        include: { plan: true },
      });
      expect(parkSub.plan).toMatchObject({ pricingMode: 'FLAT', monthlyPrice: 50_000 });
      await owner.agent
        .post(api('/platform/suite-commercial/trials'))
        .send({ organizationId: fresh.organizationId, productCode: 'OCALL_SCHOOL' })
        .expect(201);
      const schoolSub = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: fresh.organizationId, product: { code: 'OCALL_SCHOOL' } },
        include: { plan: true },
      });
      expect(schoolSub.plan.pricingMode).toBe('FLAT');
    } finally {
      await prisma.subscriptionPlan.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false },
      });
    }
    expect(
      await prisma.subscriptionPlan.count({ where: { id: { in: ids }, isActive: true } }),
    ).toBe(0);
  });

  it('droits : un client ne lit ni les sites facturés ni l’aperçu de séparation', async () => {
    expect((await org.agent.get(api(`/platform/subscriptions/${parkSubId}/sites`))).status).toBe(
      403,
    );
    expect((await org.agent.get(api('/platform/subscriptions/park-restaurant-split'))).status).toBe(
      403,
    );
  });

  (stockEnabled ? it : it.skip)(
    'Stock : boutiques rattachées et non rattachées comptées, boutique archivée exclue',
    async () => {
      const stockDb = app.get(OcallStockPrismaService);
      const product = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: STOCK_PRODUCT_CODE },
      });
      const plan = await testPlan(STOCK_PRODUCT_CODE, true);
      await prisma.productTrial.create({
        data: {
          organizationId: org.organizationId,
          productId: product.id,
          startedAt: new Date(),
          endsAt: new Date(Date.now() + 14 * DAY),
          startedByOcall: true,
        },
      });
      await prisma.subscription.create({
        data: {
          organizationId: org.organizationId,
          productId: product.id,
          planId: plan.id,
          status: 'TRIALING',
        },
      });
      const shop = (code: string, establishmentId: string | null) =>
        org.agent
          .post(api('/ocall-stock/sites'))
          .send({ code, name: `Boutique ${code}`, kind: 'STORE', establishmentId })
          .expect(201)
          .then((r) => r.body as { id: string });
      await shop('S6A', estNone);
      // Une boutique par établissement au plus (règle Stock) : l'établissement mixte compte aussi pour
      // Stock, une fois, indépendamment de Park.
      await shop('S6B', estBoth);
      const unlinked = await shop('S6C', null);
      const archived = await shop('S6D', null);
      await stockDb.stockSite.update({ where: { id: archived.id }, data: { isArchived: true } });
      expect(await sitesService.countLive(org.organizationId, STOCK_PRODUCT_CODE)).toBe(3);

      // Rattachement à un établissement : même activation (même début), nouvelle clé de décompte.
      const unit = `${STOCK_PRODUCT_CODE}:${unlinked.id}`;
      await sitesService.sync(org.organizationId, STOCK_PRODUCT_CODE);
      const before = await prisma.siteActivation.findFirstOrThrow({
        where: { organizationId: org.organizationId, unitKey: unit, endedAt: null },
      });
      expect(before.siteKey).toBe(unit);
      await org.agent
        .put(api(`/ocall-stock/sites/${unlinked.id}/establishment`))
        .send({ establishmentId: estResto })
        .expect((r) => expect(r.status).toBeLessThan(300));
      await sitesService.sync(org.organizationId, STOCK_PRODUCT_CODE);
      const rows = await prisma.siteActivation.findMany({
        where: { organizationId: org.organizationId, unitKey: unit },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: before.id,
        siteKey: estResto,
        endedAt: null,
        startedAt: before.startedAt,
      });
    },
  );

  it('base : une offre par site sans prix de site supplémentaire est refusée', async () => {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_PARK' } });
    await expect(
      prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `S6 invalide ${RUN}`,
          monthlyPrice: 17_500,
          pricingMode: 'PER_SITE',
          isActive: false,
        },
      }),
    ).rejects.toThrow(/SubscriptionPlan_per_site_prices_check/);
  });
});
