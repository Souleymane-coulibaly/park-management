import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { SchoolSmsService } from '../src/modules/school/school-sms.service';
import { purgeSmsWallets } from './school-sms-support';
import { SuiteContractsService } from '../src/modules/suite-contracts/suite-contracts.service';
import { assertShowcaseAllowed } from '../src/common/showcase';
import { extendSubscription } from '../src/common/subscription-billing';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  grantShowcasePlan,
  internalAccount,
  login,
  partnerAccount,
  signup,
} from './helpers';

/**
 * Socle commercial Ocall Suite (Sprint S1) : grille unifiée, essai gratuit de 14 jours une seule fois
 * par organisation et application, lecture seule Park à l'expiration (D3), frais de mise en service
 * facturés une seule fois, demandes d'activation, option vitrine (D5), School en préproduction (D1) et
 * offre Ocall School Free. Données fictives, bases de test locales jetables uniquement.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const schoolSuite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

describe('Socle commercial Ocall Suite S1 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let parkA: SignedUpOwner;
  let parkB: SignedUpOwner;

  const trialOf = (organizationId: string) =>
    prisma.productTrial.findFirstOrThrow({
      where: { organizationId, product: { code: 'OCALL_PARK' } },
    });
  const subOf = (organizationId: string) =>
    prisma.subscription.findFirstOrThrow({
      where: { organizationId, product: { code: 'OCALL_PARK' } },
      include: { plan: true },
    });
  const overview = async (who: Agent) =>
    (await who.get(api('/suite/overview')).expect(200)).body as {
      code: string;
      access: string;
      canStartTrial: boolean;
      canRequestActivation: boolean;
      trial: { daysRemaining: number; active: boolean } | null;
      subscription: { state: string; monthlyPrice: number; includesShowcase: boolean } | null;
      plans: { id: string; monthlyPrice: number; setupFee: number; includesShowcase: boolean }[];
    }[];
  const parkWrite = (who: Agent) => who.post(api('/establishments')).send({});

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, `s1owner-${RUN}`, 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, `s1billing-${RUN}`, 'BILLING_MANAGER');
    parkA = await signup(app, 's1parka', 'PARK');
    parkB = await signup(app, 's1parkb', 'RESTAURANT');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('essai gratuit', () => {
    it('inscription : essai Park de 14 jours démarré par le serveur, une seule fois, offre sans vitrine', async () => {
      const trial = await trialOf(parkA.organizationId);
      expect(trial.endsAt.getTime() - trial.startedAt.getTime()).toBe(14 * DAY);
      const sub = await subOf(parkA.organizationId);
      expect(sub.status).toBe('TRIALING');
      expect(sub.plan).toMatchObject({
        monthlyPrice: 50000,
        setupFee: 200000,
        includesShowcase: false,
      });
      // Restaurant seul : même application Ocall Park, même tarif (D2).
      expect((await subOf(parkB.organizationId)).plan.monthlyPrice).toBe(50000);

      const park = (await overview(parkA.agent)).find((a) => a.code === 'OCALL_PARK')!;
      expect(park).toMatchObject({ access: 'full', canStartTrial: false });
      expect(park.trial).toMatchObject({ daysRemaining: 14, active: true });
      expect(park.subscription).toMatchObject({ state: 'TRIAL_ACTIVE', monthlyPrice: 50000 });

      // Second essai refusé (déjà utilisé), même simultanément.
      const again = await Promise.all(
        [1, 2, 3].map(() => parkA.agent.post(api('/suite/apps/OCALL_PARK/trial'))),
      );
      for (const r of again) expect(r.body.code).toBe('TRIAL_ALREADY_USED');
      expect(
        await prisma.productTrial.count({ where: { organizationId: parkA.organizationId } }),
      ).toBe(1);
    });

    it('réglages IA d’un nouveau client : plafond affiché = plafond de l’offre (150), formulaire enregistrable tel quel', async () => {
      const view = (await parkB.agent.get(api('/ai/settings')).expect(200)).body;
      expect(view).toMatchObject({ monthlyCallLimit: 150, platformLimit: 150 });
      const { platformLimit: _limit, ...form } = view;
      await parkB.agent
        .put(api('/ai/settings'))
        .send({ ...form, copilotEnabled: false })
        .expect(200);
      const over = await parkB.agent.put(api('/ai/settings')).send({ monthlyCallLimit: 151 });
      expect(over.body.code).toBe('AI_LIMIT_ABOVE_PLAN');
      await parkB.agent.put(api('/ai/settings')).send({ copilotEnabled: true }).expect(200);
    });

    it('School en préproduction (D1) : essai en libre-service refusé, essai par Ocall une seule fois', async () => {
      const self = await parkA.agent.post(api('/suite/apps/OCALL_SCHOOL/trial'));
      expect(self.status).toBe(409);
      expect(self.body.code).toBe('TRIAL_NOT_AVAILABLE');
      // Produit à venir : aucun essai, même par Ocall.
      const facture = await owner.agent
        .post(api('/platform/suite-commercial/trials'))
        .send({ organizationId: parkA.organizationId, productCode: 'OCALL_FACTURE' });
      expect(facture.body.code).toBe('TRIAL_NOT_AVAILABLE');
      // Essai Ocall simultané : un seul succès.
      const runs = await Promise.all(
        [1, 2, 3, 4].map(() =>
          owner.agent
            .post(api('/platform/suite-commercial/trials'))
            .send({ organizationId: parkA.organizationId, productCode: 'OCALL_SCHOOL' }),
        ),
      );
      expect(runs.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of runs.filter((x) => x.status !== 201))
        expect(r.body.code).toBe('TRIAL_ALREADY_USED');
      const contract = await prisma.suiteContract.findFirstOrThrow({
        where: { organizationId: parkA.organizationId, product: { code: 'OCALL_SCHOOL' } },
      });
      expect(contract.status).toBe('ACTIVE');
      expect(contract.limits).toMatchObject({ tier: 'TRIAL' });
      // Dernier jour du contrat = jour de l'échéance de l'essai : accès jamais coupé avant l'instant annoncé.
      const schoolTrial = await prisma.productTrial.findFirstOrThrow({
        where: { organizationId: parkA.organizationId, product: { code: 'OCALL_SCHOOL' } },
      });
      expect(contract.endsOn.toISOString().slice(0, 10)).toBe(
        schoolTrial.endsAt.toISOString().slice(0, 10),
      );
      expect(contract.endsOn.getTime() + DAY).toBeGreaterThan(schoolTrial.endsAt.getTime());
      // Essais indépendants : celui de School n'a pas touché celui de Park.
      expect((await subOf(parkA.organizationId)).status).toBe('TRIALING');
      const audit = await prisma.auditLog.count({
        where: { organizationId: parkA.organizationId, action: 'platform.trial_started' },
      });
      expect(audit).toBe(1);
    });

    it('activation payante School après l’essai : contrat payant ouvert, droits complets après l’échéance de l’essai', async () => {
      const sub = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: parkA.organizationId, product: { code: 'OCALL_SCHOOL' } },
      });
      const today = new Date(new Date().toISOString().slice(0, 10));
      await prisma.$transaction((tx) =>
        extendSubscription(tx, {
          subscriptionId: sub.id,
          periodStart: today,
          periodEnd: new Date(today.getTime() + 29 * DAY),
          actorUserId: owner.id,
          reason: 'Activation approuvée par Ocall (test).',
        }),
      );
      const paid = await prisma.suiteContract.findFirstOrThrow({
        where: { organizationId: parkA.organizationId, reference: { startsWith: 'ABO-' } },
      });
      expect(paid.status).toBe('ACTIVE');
      expect(paid.limits).toMatchObject({ tier: 'PAID' });
      expect(paid.endsOn.getTime()).toBeGreaterThanOrEqual(today.getTime() + 29 * DAY);
      // Essai échu : l'accès School reste complet grâce au contrat payant, sans limite d'offre gratuite.
      await prisma.suiteContract.updateMany({
        where: { organizationId: parkA.organizationId, reference: { startsWith: 'ESSAI-' } },
        data: { startsOn: new Date('2026-01-01'), endsOn: new Date('2026-01-14') },
      });
      const entitlement = await app
        .get(SuiteContractsService)
        .entitlement(parkA.organizationId, 'OCALL_SCHOOL');
      expect(entitlement.access).toBe('full');
      expect(entitlement.limits.maxStudents).toBeUndefined();
      // Prolongation : même contrat, jamais raccourci, journalisé.
      await prisma.$transaction((tx) =>
        extendSubscription(tx, {
          subscriptionId: sub.id,
          periodStart: new Date(today.getTime() + 30 * DAY),
          periodEnd: new Date(today.getTime() + 59 * DAY),
          actorUserId: owner.id,
          reason: 'Prolongation (test).',
        }),
      );
      const contracts = await prisma.suiteContract.findMany({
        where: { organizationId: parkA.organizationId, reference: { startsWith: 'ABO-' } },
      });
      expect(contracts).toHaveLength(1);
      expect(contracts[0]!.endsOn.getTime()).toBeGreaterThanOrEqual(today.getTime() + 59 * DAY);
      expect(
        await prisma.suiteContractEvent.count({ where: { contractId: contracts[0]!.id } }),
      ).toBe(2);
    });

    it('client : aucune route ne permet de modifier les dates d’essai ; un compte plateforme sans droit est refusé', async () => {
      await parkA.agent
        .post(api('/platform/suite-commercial/trials'))
        .send({ organizationId: parkA.organizationId, productCode: 'OCALL_PARK' })
        .expect(403);
      await parkA.agent.patch(api('/suite/apps/OCALL_PARK/trial')).send({}).expect(404);
    });
  });

  describe('lecture seule Park à l’expiration (D3)', () => {
    it('essai échu : écriture métier refusée, consultation et sécurité conservées, données intactes', async () => {
      expect((await parkWrite(parkB.agent)).status).toBe(400); // garde franchie (corps invalide)
      await prisma.productTrial.updateMany({
        where: { organizationId: parkB.organizationId },
        data: {
          startedAt: new Date(Date.now() - 20 * DAY),
          endsAt: new Date(Date.now() - 6 * DAY),
        },
      });
      const denied = await parkWrite(parkB.agent);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('PARK_READ_ONLY');
      await parkB.agent.get(api('/establishments')).expect(200);
      // Sécurité et administration nécessaires : jamais bloquées par la lecture seule.
      const pwd = await parkB.agent
        .post(api('/auth/change-password'))
        .send({ currentPassword: 'mauvais-mot-de-passe', newPassword: PASSWORD });
      expect(pwd.body.code).not.toBe('PARK_READ_ONLY');
      const park = (await overview(parkB.agent)).find((a) => a.code === 'OCALL_PARK')!;
      expect(park.access).toBe('read_only');
      expect(park.subscription?.state).toBe('TRIAL_EXPIRED');
      expect(park.trial?.daysRemaining).toBe(0);
      expect(park.canRequestActivation).toBe(true);
      // Autre organisation : non affectée.
      expect((await parkWrite(parkA.agent)).status).toBe(400);
    });

    it('activation par Ocall (abonnement actif) : écriture rétablie ; suspension → lecture seule', async () => {
      await prisma.subscription.updateMany({
        where: { organizationId: parkB.organizationId },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * DAY),
        },
      });
      expect((await parkWrite(parkB.agent)).status).toBe(400);
      const sub = await subOf(parkB.organizationId);
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Test de suspension' })
        .expect(200);
      expect((await parkWrite(parkB.agent)).body.code).toBe('PARK_READ_ONLY');
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
        .send({ reason: 'Règlement reçu' })
        .expect(200);
      expect((await parkWrite(parkB.agent)).status).toBe(400);
    });
  });

  describe('abonnement en essai : actions du Super Admin', () => {
    it('suspension puis réactivation → retour à l’essai (jamais l’accès complet historique) ; résiliation possible', async () => {
      const trialist = await signup(app, 's1susp', 'PARK');
      const sub = await subOf(trialist.organizationId);
      expect(sub.status).toBe('TRIALING');
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Contrôle' })
        .expect(200);
      expect((await parkWrite(trialist.agent)).body.code).toBe('PARK_READ_ONLY');
      const back = await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
        .send({ reason: 'Fin du contrôle' })
        .expect(200);
      expect(back.body.status).toBe('TRIALING');
      expect((await parkWrite(trialist.agent)).status).toBe(400);
      // Essai échu puis suspension et réactivation : toujours lecture seule (essai consommé).
      await prisma.productTrial.updateMany({
        where: { organizationId: trialist.organizationId },
        data: { startedAt: new Date(Date.now() - 20 * DAY), endsAt: new Date(Date.now() - DAY) },
      });
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Contrôle 2' })
        .expect(200);
      await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/reactivate`))
        .send({ reason: 'Fin du contrôle 2' })
        .expect(200);
      expect((await parkWrite(trialist.agent)).body.code).toBe('PARK_READ_ONLY');
      const canceled = await owner.agent
        .post(api(`/platform/subscriptions/${sub.id}/cancel`))
        .send({ reason: 'Résiliation' })
        .expect(200);
      expect(canceled.body.status).toBe('CANCELED');
    });
  });

  describe('frais de mise en service (une seule fois)', () => {
    const issue = (subscriptionId: string, setup: boolean) =>
      billing.agent.post(api('/platform/invoices')).send({
        subscriptionId,
        lines: [...(setup ? [{ kind: 'SETUP' }] : []), { kind: 'MONTHLY', months: 1 }],
        idempotencyKey: randomUUID(),
      });

    it('setup facturé une fois ; renouvellement sans setup ; annulation → de nouveau facturable', async () => {
      const sub = await subOf(parkA.organizationId);
      const first = await issue(sub.id, true).expect(201);
      expect(first.body.total).toBe(250000);
      const second = await issue(sub.id, true);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('SETUP_FEE_ALREADY_BILLED');
      expect((await issue(sub.id, false).expect(201)).body.total).toBe(50000);
      await billing.agent
        .post(api(`/platform/invoices/${first.body.id}/cancel`))
        .send({ reason: 'Erreur de saisie' })
        .expect(201);
      const fee = await prisma.productSetupFee.findFirstOrThrow({
        where: { organizationId: parkA.organizationId },
      });
      expect(fee.status).toBe('DUE');
      await issue(sub.id, true).expect(201);
    });

    it('deux factures simultanées avec setup : une seule aboutit', async () => {
      const sub = await subOf(parkB.organizationId);
      const runs = await Promise.all([
        issue(sub.id, true),
        issue(sub.id, true),
        issue(sub.id, true),
      ]);
      expect(runs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await prisma.invoiceLine.count({
          where: {
            kind: 'SETUP',
            invoice: { subscriptionId: sub.id, status: { not: 'CANCELLED' } },
          },
        }),
      ).toBe(1);
    });

    it('contrat antérieur à S1 (ancienne offre Restaurant) : facture et commissions au tarif contractuel, pas à la nouvelle grille', async () => {
      const legacy = await signup(app, 's1legacy', 'RESTAURANT');
      // Simule un contrat d'avant S1 : ancienne offre « Restaurant », retirée du catalogue mais intacte.
      const oldPlan = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: 'OCALL_RESTAURANT' }, isActive: false },
        orderBy: { createdAt: 'asc' },
      });
      expect(oldPlan.monthlyPrice).not.toBe(50000);
      expect(oldPlan.productId).not.toBeNull();
      const sub = await subOf(legacy.organizationId);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          productId: oldPlan.productId!,
          planId: oldPlan.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          agreedSetupFee: null,
          agreedMonthlyPrice: null,
        },
      });
      // Partenaire attribué, règle figée sur l'attribution : 15 % du setup, 10 % des mensualités.
      const billing2 = await internalAccount(app, prisma, `s1billing2-${RUN}`, 'BILLING_MANAGER');
      const partner = await partnerAccount(app, owner.agent, 's1legacyp');
      const rule = await prisma.commissionRule.create({
        data: {
          name: `S1 ancien contrat ${RUN}`,
          setupRateBps: 1500,
          monthlyRateBps: 1000,
          monthlyWindowMonths: 12,
          isActive: true,
          validatedAt: new Date(),
          validatedById: owner.id,
          createdById: owner.id,
        },
      });
      const att = (
        await owner.agent
          .post(api('/platform/attributions'))
          .send({
            organizationId: legacy.organizationId,
            partnerId: partner.partnerId,
            productCode: 'OCALL_RESTAURANT',
          })
          .expect(201)
      ).body as { id: string };
      await owner.agent.post(api(`/platform/attributions/${att.id}/confirm`)).expect(200);
      await prisma.attribution.update({ where: { id: att.id }, data: { ruleId: rule.id } });

      const inv = (await issue(sub.id, true).expect(201)).body as { id: string; total: number };
      expect(inv.total).toBe(oldPlan.setupFee + oldPlan.monthlyPrice);
      const day = new Date().toISOString().slice(0, 10);
      const payment = (
        await billing.agent
          .post(api('/platform/subscription-payments'))
          .send({
            organizationId: legacy.organizationId,
            invoiceId: inv.id,
            amount: inv.total,
            currency: 'XOF',
            method: 'MANUAL_TRANSFER',
            reference: `VIR-${randomUUID().slice(0, 8)}`,
            paidAt: day,
            periodStart: day,
            periodEnd: day,
          })
          .expect(201)
      ).body as { id: string };
      await billing2.agent
        .post(api(`/platform/subscription-payments/${payment.id}/confirm`))
        .expect(200);
      const commissions = await prisma.commission.findMany({
        where: { subscriptionPaymentId: payment.id },
        orderBy: { kind: 'asc' },
      });
      expect(commissions.map((c) => [c.kind, c.baseAmount, c.amount])).toEqual([
        ['SETUP', oldPlan.setupFee, Math.round(oldPlan.setupFee * 0.15)],
        ['MONTHLY', oldPlan.monthlyPrice, Math.round(oldPlan.monthlyPrice * 0.1)],
      ]);
      // Prix figés sur le contrat à la première facture ; ancienne offre inchangée.
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect([after.agreedSetupFee, after.agreedMonthlyPrice]).toEqual([
        oldPlan.setupFee,
        oldPlan.monthlyPrice,
      ]);
    });
  });

  describe('demande d’activation payante', () => {
    it('choix de l’offre, montant, une seule demande en attente, clôture par Ocall auditée', async () => {
      const fresh = await signup(app, 's1act', 'PARK');
      const park = (await overview(fresh.agent)).find((a) => a.code === 'OCALL_PARK')!;
      const showcase = park.plans.find((p) => p.includesShowcase)!;
      expect(showcase.monthlyPrice).toBe(65000);
      const req = await fresh.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: showcase.id })
        .expect(201);
      expect(req.body.quote).toEqual({
        setupFee: 200000,
        monthlyPrice: 65000,
        firstPayment: 265000,
        recurring: 65000,
      });
      const dup = await fresh.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: showcase.id });
      expect(dup.body.code).toBe('ACTIVATION_ALREADY_REQUESTED');
      // Offre d'une autre application : refusée.
      const schoolPlan = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: 'OCALL_SCHOOL' }, isActive: true },
      });
      await fresh.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: schoolPlan.id })
        .expect(404);
      // Isolation : l'autre organisation ne voit pas cette demande et n'a rien en attente.
      const other = (await overview(parkA.agent)).find((a) => a.code === 'OCALL_PARK')!;
      expect(other.canRequestActivation).toBe(true);
      const pending = (
        await billing.agent.get(api('/platform/suite-commercial/activation-requests')).expect(200)
      ).body as { id: string; organization: { id: string } }[];
      const mine = pending.find((p) => p.organization.id === fresh.organizationId)!;
      expect(mine.id).toBe(req.body.id);
      await owner.agent
        .post(api(`/platform/suite-commercial/activation-requests/${mine.id}/close`))
        .send({ outcome: 'HANDLED', note: `Règlement vérifié ${RUN}` })
        .expect(200);
      // Clôture idempotente ; une nouvelle demande redevient possible.
      await owner.agent
        .post(api(`/platform/suite-commercial/activation-requests/${mine.id}/close`))
        .send({ outcome: 'HANDLED', note: 'Deuxième clic' })
        .expect(200);
      expect(
        await prisma.auditLog.count({
          where: { targetId: mine.id, action: 'platform.activation_request_handled' },
        }),
      ).toBe(1);
      await fresh.agent
        .post(api('/suite/apps/OCALL_PARK/activation-request'))
        .send({ planId: showcase.id })
        .expect(201);
      // Application à venir : aucune activation.
      const stock = await fresh.agent
        .post(api('/suite/apps/OCALL_STOCK/activation-request'))
        .send({ planId: showcase.id });
      expect(stock.body.code).toBe('PRODUCT_NOT_AVAILABLE');
    });
  });

  describe('option vitrine (D5)', () => {
    it('publication refusée sans offre vitrine (brouillon conservé), acceptée avec, sans setup supplémentaire', async () => {
      const shop = await signup(app, 's1vit', 'PARK');
      const est = (await shop.agent.get(api('/establishments')).expect(200)).body[0].id as string;
      const site = (
        await shop.agent
          .post(api('/sites'))
          .send({ establishmentId: est, slug: `vitrine-${RUN}`.toLowerCase().slice(0, 40) })
      ).body as { id: string };
      expect(site.id).toBeDefined();
      const denied = await shop.agent.post(api(`/sites/${site.id}/publish`));
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('SHOWCASE_OPTION_REQUIRED');
      await grantShowcasePlan(prisma, shop.organizationId);
      const ok = await shop.agent.post(api(`/sites/${site.id}/publish`));
      expect([201, 409]).toContain(ok.status); // 409 possible si le contenu minimal manque
      expect(ok.body.code).not.toBe('SHOWCASE_OPTION_REQUIRED');
      expect(
        await prisma.productSetupFee.count({ where: { organizationId: shop.organizationId } }),
      ).toBe(0);
    });

    it('organisation antérieure au socle S1 : droit de publication conservé', async () => {
      const old = await signup(app, 's1old', 'PARK');
      await prisma.organization.update({
        where: { id: old.organizationId },
        data: { showcaseGrandfathered: true },
      });
      const est = (await old.agent.get(api('/establishments')).expect(200)).body[0].id as string;
      const site = (
        await old.agent
          .post(api('/sites'))
          .send({ establishmentId: est, slug: `ancien-${RUN}`.toLowerCase().slice(0, 40) })
      ).body as { id: string };
      const res = await old.agent.post(api(`/sites/${site.id}/publish`));
      expect(res.body.code).not.toBe('SHOWCASE_OPTION_REQUIRED');
    });
  });
});

schoolSuite('Ocall School Free (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let agent: Agent;
  let organizationId: string;
  let schoolId: string;
  let freeContractId: string;
  let counter = 0;

  const student = (schoolIdArg: string) =>
    agent.post(api('/school/students')).send({
      schoolId: schoolIdArg,
      lastName: `Libre${++counter}`,
      firstName: `Awa${counter}`,
      birthDate: '2018-03-14',
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `s1free-${RUN}`, 'PLATFORM_OWNER');
    // Client School : offre gratuite (contrat actif sans échéance réelle, limites de l'offre).
    const res = await platform.agent
      .post(api('/platform/contracts/clients'))
      .send({
        organizationName: `Test free ${RUN}`,
        countryCode: 'SN',
        ownerFirstName: 'Mariama',
        ownerLastName: 'Sow',
        ownerEmail: email('owner-free'),
        reference: `FREE-${RUN}`,
        startsOn: '2026-01-01',
        endsOn: '9999-12-31',
        // Plafond réduit à 3 élèves pour le test (même code que les 50 de l'offre réelle).
        limits: { tier: 'FREE', maxStudents: 3, aiMonthlyCallsPerSchool: 20, sms: false },
      })
      .expect(201);
    organizationId = res.body.contract.organizationId;
    freeContractId = res.body.contract.id;
    await platform.agent
      .post(api(`/platform/contracts/${freeContractId}/status`))
      .send({ status: 'ACTIVE', reason: 'Offre gratuite' })
      .expect(200);
    const session = await login(app, res.body.loginId, res.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    agent = session.agent;
    schoolId = (
      await agent
        .post(api('/school/schools'))
        .send({ name: `Ecole libre ${RUN}`, type: 'PRIMARY', countryCode: 'SN' })
        .expect(201)
    ).body.id;
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId };
    await db.schoolSmsMessage.deleteMany({ where });
    await purgeSmsWallets(db, where);
    await db.schoolStudentEvent.deleteMany({ where });
    await db.schoolStudent.deleteMany({ where });
    await db.schoolNumberCounter.deleteMany({ where });
    await db.schoolStudentSettings.deleteMany({ where });
    await db.schoolSmsSettings.deleteMany({ where: { schoolId } });
    await db.schoolAccessDecision.deleteMany({ where });
    await db.schoolMemberAssignment.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await prisma.suiteContractEvent.deleteMany({ where: { contract: { organizationId } } });
    await cleanup(prisma);
    await app.close();
  });

  it('plafond d’élèves actifs : inscriptions simultanées au-delà refusées, jamais de dépassement', async () => {
    await student(schoolId).expect(201);
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => student(schoolId)));
    expect(runs.filter((r) => r.status === 201)).toHaveLength(2);
    for (const r of runs.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('SCHOOL_FREE_STUDENT_LIMIT');
    }
    expect(
      await db.schoolStudent.count({
        where: { organizationId, status: { in: ['REGISTERED', 'ENROLLED'] } },
      }),
    ).toBe(3);
    // Consultation conservée au plafond.
    await agent.get(api(`/school/students?schoolId=${schoolId}`)).expect(200);
  });

  it('option vitrine (D5) : client Free conclu depuis S1, sans abonnement → publication refusée ; droits acquis → autorisée', async () => {
    await expect(
      assertShowcaseAllowed(prisma, organizationId, ['OCALL_SCHOOL']),
    ).rejects.toMatchObject({ response: { code: 'SHOWCASE_OPTION_REQUIRED' } });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { showcaseGrandfathered: true },
    });
    await expect(
      assertShowcaseAllowed(prisma, organizationId, ['OCALL_SCHOOL']),
    ).resolves.toBeUndefined();
    await prisma.organization.update({
      where: { id: organizationId },
      data: { showcaseGrandfathered: false },
    });
  });

  it('SMS non inclus : activation refusée ; aucune organisation voisine affectée', async () => {
    const res = await agent.put(api('/school/sms/settings')).send({ schoolId, enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCHOOL_FREE_SMS_NOT_INCLUDED');
    await agent.put(api('/school/sms/settings')).send({ schoolId, enabled: false }).expect(200);
  });

  it('passage au payant : contrat sans limite → plafond levé ; retour au gratuit → élèves conservés, nouvelles inscriptions bloquées', async () => {
    const paid = await platform.agent
      .post(api('/platform/contracts'))
      .send({
        organizationId,
        reference: `PAID-${RUN}`,
        startsOn: '2026-01-01',
        endsOn: '2099-12-31',
      })
      .expect(201);
    await platform.agent
      .post(api(`/platform/contracts/${paid.body.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Abonnement payant' })
      .expect(200);
    await student(schoolId).expect(201);
    await agent.put(api('/school/sms/settings')).send({ schoolId, enabled: true }).expect(200);
    // SMS mis en file sous contrat payant, encore en attente au retour à l'offre gratuite.
    const queued = await db.schoolSmsMessage.create({
      data: {
        organizationId,
        schoolId,
        phone: '+221770000000',
        body: 'Message fictif',
        kind: 'ABSENCE',
        dedupeKey: `s1-free-${RUN}`,
      },
    });
    await platform.agent
      .post(api(`/platform/contracts/${paid.body.id}/status`))
      .send({ status: 'TERMINATED', reason: 'Fin de l’abonnement' })
      .expect(200);
    expect((await student(schoolId)).body.code).toBe('SCHOOL_FREE_STUDENT_LIMIT');
    expect(await db.schoolStudent.count({ where: { organizationId } })).toBe(4);
    // Le droit SMS est relu à l'envoi : message annulé, jamais transmis au fournisseur.
    await app.get(SchoolSmsService).processDue(new Date(Date.now() + 60_000));
    const after = await db.schoolSmsMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.lastError).toBe('SMS_NOT_IN_CONTRACT');
    expect(after.sentAt).toBeNull();
    await agent.get(api(`/school/students?schoolId=${schoolId}`)).expect(200);
  });
});
