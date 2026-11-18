import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  agent,
  createTestApp,
  internalAccount,
  signup,
} from './helpers';

/**
 * Commercialisation J1 : lancement de la grille par site pour Ocall Stock et Ocall Facture.
 *
 * Ocall retire les forfaits du catalogue de ces deux applications et active leurs offres par site
 * (17 500 FCFA le premier site, 7 500 par site supplémentaire, mise en service 150 000 puis 112 500,
 * essai de 14 jours). Parcours d'un nouveau client : inscription, essais, facture, règlement manuel
 * (déclaré puis confirmé par une autre personne), activation. Un essai démarré avant le changement
 * garde son forfait ; tant qu'un forfait est actif, l'essai le garde (règle de l'étape 6). Bases de test
 * locales jetables uniquement ; l'état du catalogue est rétabli à la fin.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const CODES = ['OCALL_STOCK', 'OCALL_FACTURE'] as const;

describe('Commercialisation J1 — grille par site Stock + Facture', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let client: SignedUpOwner;
  let early: SignedUpOwner;
  let earlyPlanId: string;
  /** État du catalogue avant le test, rétabli à la fin. */
  let savedPlans: { id: string; isActive: boolean }[] = [];
  let savedProducts: { id: string; status: string }[] = [];
  const createdPlans: string[] = [];

  const subscriptionOf = (organizationId: string, code: string) =>
    prisma.subscription.findFirstOrThrow({
      where: { organizationId, product: { code } },
      include: { plan: true },
    });

  async function issue(subscriptionId: string) {
    const res = await owner.agent.post(api('/platform/invoices')).send({
      subscriptionId,
      lines: [{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 1 }],
      idempotencyKey: randomUUID(),
    });
    if (res.status !== 201) throw new Error(`facture ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as {
      id: string;
      total: number;
      lines: { kind: string; quantity: number; amount: number }[];
    };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, `j1owner-${RUN}`, 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, `j1billing-${RUN}`, 'BILLING_MANAGER');
    const products = await prisma.saasProduct.findMany({ where: { code: { in: [...CODES] } } });
    savedProducts = products.map((p) => ({ id: p.id, status: p.status }));
    savedPlans = await prisma.subscriptionPlan.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      select: { id: true, isActive: true },
    });
    // Catalogue d'avant le lancement : un forfait actif par application (comme en préproduction).
    await prisma.saasProduct.updateMany({
      where: { code: { in: [...CODES] } },
      data: { status: 'ACTIVE' },
    });
    for (const product of products) {
      const plan = await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `J1 forfait ${product.code} ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: true,
        },
      });
      createdPlans.push(plan.id);
    }
    early = await signup(app, 'j1early', 'PARK');
    await early.agent.post(api('/suite/apps/OCALL_FACTURE/trial')).expect(201);
    earlyPlanId = (await subscriptionOf(early.organizationId, 'OCALL_FACTURE')).planId;
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) {
        for (const p of savedPlans)
          await prisma.subscriptionPlan.update({
            where: { id: p.id },
            data: { isActive: p.isActive },
          });
        for (const p of savedProducts)
          await prisma.saasProduct.update({
            where: { id: p.id },
            data: { status: p.status as never },
          });
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: createdPlans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('forfait actif : l’essai garde le forfait (règle de l’étape 6 inchangée)', async () => {
    const sub = await subscriptionOf(early.organizationId, 'OCALL_FACTURE');
    expect(sub.plan).toMatchObject({ pricingMode: 'FLAT', isActive: true });
    expect(sub.status).toBe('TRIALING');
  });

  it('lancement : forfaits retirés, offres par site actives aux bons prix', async () => {
    const products = await prisma.saasProduct.findMany({ where: { code: { in: [...CODES] } } });
    await prisma.subscriptionPlan.updateMany({
      where: { productId: { in: products.map((p) => p.id) }, pricingMode: 'FLAT' },
      data: { isActive: false },
    });
    await prisma.subscriptionPlan.updateMany({
      where: {
        productId: { in: products.map((p) => p.id) },
        pricingMode: 'PER_SITE',
        includesShowcase: false,
      },
      data: { isActive: true },
    });
    const grid = await prisma.subscriptionPlan.findMany({
      where: { productId: { in: products.map((p) => p.id) }, isActive: true },
    });
    expect(grid).toHaveLength(2);
    for (const plan of grid) {
      expect(plan).toMatchObject({
        pricingMode: 'PER_SITE',
        monthlyPrice: 17_500,
        extraSiteMonthlyPrice: 7_500,
        setupFee: 150_000,
        extraAppSetupFee: 112_500,
        trialDays: 14,
      });
    }
    // Le catalogue public ne montre plus le forfait retiré.
    const pub = (await agent(app).get(api('/plans')).expect(200)).body as {
      name: string;
      monthlyPrice: number;
    }[];
    const names = pub.map((p) => p.name);
    expect(names).not.toContain(`J1 forfait OCALL_STOCK ${RUN}`);
  });

  it('nouveau client : inscription, essais de 14 jours sur l’offre par site', async () => {
    client = await signup(app, 'j1client', 'PARK');
    for (const code of CODES) {
      const before = Date.now();
      await client.agent.post(api(`/suite/apps/${code}/trial`)).expect(201);
      const sub = await subscriptionOf(client.organizationId, code);
      expect(sub.status).toBe('TRIALING');
      expect(sub.plan).toMatchObject({ pricingMode: 'PER_SITE', includesShowcase: false });
      const trial = await prisma.productTrial.findFirstOrThrow({
        where: { organizationId: client.organizationId, productId: sub.productId },
      });
      const days = (trial.endsAt.getTime() - before) / DAY;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14.01);
    }
  });

  it('contrat antérieur : l’essai démarré avant le lancement garde son forfait', async () => {
    const sub = await subscriptionOf(early.organizationId, 'OCALL_FACTURE');
    expect(sub.planId).toBe(earlyPlanId);
    expect(sub.plan).toMatchObject({ pricingMode: 'FLAT', isActive: false });
    const invoice = await issue(sub.id);
    expect(invoice.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['SETUP', 200_000],
      ['MONTHLY', 50_000],
    ]);
  });

  it('factures : 17 500 + mise en service 150 000, puis 112 500 pour la seconde application', async () => {
    const stock = await subscriptionOf(client.organizationId, 'OCALL_STOCK');
    const first = await issue(stock.id);
    expect(first.lines.map((l) => [l.kind, l.quantity, l.amount])).toEqual([
      ['SETUP', 1, 150_000],
      ['MONTHLY', 1, 17_500],
    ]);
    expect(first.total).toBe(167_500);
    const facture = await subscriptionOf(client.organizationId, 'OCALL_FACTURE');
    const second = await issue(facture.id);
    expect(second.lines.map((l) => [l.kind, l.quantity, l.amount])).toEqual([
      ['SETUP', 1, 112_500],
      ['MONTHLY', 1, 17_500],
    ]);
    expect(second.total).toBe(130_000);
  });

  it('règlement manuel : déclaré, confirmé par une autre personne, activation approuvée', async () => {
    const stock = await subscriptionOf(client.organizationId, 'OCALL_STOCK');
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { subscriptionId: stock.id },
      orderBy: { createdAt: 'desc' },
    });
    const declared = (
      await billing.agent
        .post(api('/platform/subscription-payments'))
        .send({
          organizationId: client.organizationId,
          invoiceId: invoice.id,
          currency: 'XOF',
          method: 'MANUAL_TRANSFER',
          amount: invoice.total,
          reference: `VIR-J1-${RUN}`,
          paidAt: new Date().toISOString().slice(0, 10),
          periodStart: new Date().toISOString().slice(0, 10),
          periodEnd: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
        })
        .expect(201)
    ).body as { id: string };
    // Déclaration seule : rien n'est activé ; le déclarant ne peut pas confirmer.
    expect((await subscriptionOf(client.organizationId, 'OCALL_STOCK')).status).toBe('TRIALING');
    await billing.agent
      .post(api(`/platform/subscription-payments/${declared.id}/confirm`))
      .expect(403);
    const confirmed = (
      await owner.agent
        .post(api(`/platform/subscription-payments/${declared.id}/confirm`))
        .expect(200)
    ).body;
    expect(confirmed.invoicePaid).toBe(true);
    expect(confirmed.activation).toMatchObject({ mode: 'ADMIN_APPROVAL', result: 'pending' });
    await owner.agent
      .post(api(`/platform/subscription-payments/${declared.id}/approve-activation`))
      .expect(200);
    const active = await subscriptionOf(client.organizationId, 'OCALL_STOCK');
    expect(active.status).toBe('ACTIVE');
    expect(active).toMatchObject({
      agreedMonthlyPrice: 17_500,
      agreedExtraSitePrice: 7_500,
      agreedSetupFee: 150_000,
    });
    // Accès complet à Ocall Stock pour le client.
    const access = (await client.agent.get(api('/suite/overview')).expect(200)).body;
    expect(JSON.stringify(access)).toContain('OCALL_STOCK');
  });

  it('Restaurant indépendant : ouverture sur la grille par site, inscription d’un restaurant seul', async () => {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: 'OCALL_RESTAURANT' },
    });
    const plans = await prisma.subscriptionPlan.findMany({
      where: { productId: product.id },
      select: { id: true, isActive: true, pricingMode: true, includesShowcase: true },
    });
    const perSite = plans.find((p) => p.pricingMode === 'PER_SITE' && !p.includesShowcase)!;
    try {
      await prisma.subscriptionPlan.updateMany({
        where: { productId: product.id },
        data: { isActive: false },
      });
      // Sans aucune offre active : ouverture refusée.
      const refused = await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ listed: true });
      expect(refused.body.code).toBe('RESTAURANT_PLAN_REQUIRED');
      await owner.agent
        .patch(api(`/platform/plans/${perSite.id}`))
        .send({ isActive: true })
        .expect(200);
      await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ listed: true })
        .expect(200);
      const resto = await signup(app, 'j1resto', 'RESTAURANT');
      const subs = await prisma.subscription.findMany({
        where: { organizationId: resto.organizationId },
        include: { plan: true, product: true, parkCombined: true },
      });
      expect(
        subs.map((s) => [s.product.code, s.status, s.plan.pricingMode, s.parkCombined]),
      ).toEqual([['OCALL_RESTAURANT', 'TRIALING', 'PER_SITE', null]]);
      expect(subs[0]!.planId).toBe(perSite.id);
      const me = (await resto.agent.get(api('/auth/me')).expect(200)).body;
      expect(me.activityAccess).toMatchObject({ RESTAURANT: 'full' });
    } finally {
      await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ listed: product.listed })
        .expect(200);
      for (const p of plans)
        await prisma.subscriptionPlan.update({
          where: { id: p.id },
          data: { isActive: p.isActive },
        });
    }
  });
});
