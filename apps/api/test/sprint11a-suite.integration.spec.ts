import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { currentStep, totpCode } from '../src/common/security/totp';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  login,
  signup,
} from './helpers';

/**
 * Sprint 11A — Ocall Suite : comptes internes et double authentification, catalogue de produits,
 * abonnements multi-produits, factures et règlements manuels, tableau de bord commercial.
 * Aucun prestataire de paiement : tout règlement est saisi puis validé par un compte interne.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 11A — Ocall Suite (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let park: SignedUpOwner;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let support: InternalAccount;
  let auditor: InternalAccount;
  const productCode = `TEST_X_${RUN.toUpperCase()}`;

  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    park = await signup(app, 's11park', 'PARK');
    owner = await internalAccount(app, prisma, 's11owner', 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, 's11billing', 'BILLING_MANAGER');
    support = await internalAccount(app, prisma, 's11support', 'SUPPORT_AGENT');
    auditor = await internalAccount(app, prisma, 's11auditor', 'READ_ONLY_AUDITOR');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { product: { code: productCode } } });
        await prisma.saasProduct.deleteMany({ where: { code: productCode } });
      }
    } finally {
      await app?.close();
    }
  });

  describe('double authentification des comptes internes', () => {
    it('bloque un rôle sensible tant que la MFA n’est pas enrôlée, puis validée à chaque connexion', async () => {
      const fresh = await internalAccount(app, prisma, 's11admin', 'SUPPORT_AGENT');
      // Passage à un rôle sensible côté serveur : la MFA devient obligatoire.
      await prisma.user.update({
        where: { id: fresh.id },
        data: { platformRole: 'PLATFORM_ADMIN' },
      });
      const s1 = await login(app, fresh.email, PASSWORD);
      expect(s1.body.mfa).toEqual({ required: true, enrolled: false, verified: false });
      const blocked = await s1.agent.get(api('/platform/overview')).expect(403);
      expect(blocked.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
      await s1.agent.get(api('/auth/me')).expect(200);

      const setup = (await s1.agent.post(api('/auth/mfa/setup')).expect(200)).body;
      expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      const bad = await s1.agent.post(api('/auth/mfa/enable')).send({ code: '000000' });
      expect(bad.status).toBe(401);
      const step = currentStep();
      const enabled = await s1.agent
        .post(api('/auth/mfa/enable'))
        .send({ code: totpCode(setup.secret, step) })
        .expect(200);
      expect(enabled.body.recoveryCodes).toHaveLength(10);
      await s1.agent.get(api('/platform/overview')).expect(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } });
      // Secret chiffré au repos, codes de secours hachés.
      expect(stored.mfaSecret).not.toContain(setup.secret);
      expect(stored.mfaRecoveryCodes).not.toContain(enabled.body.recoveryCodes[0]);

      // Nouvelle connexion : second facteur exigé ; code de secours à usage unique.
      const s2 = await login(app, fresh.email, PASSWORD);
      const required = await s2.agent.get(api('/platform/overview')).expect(403);
      expect(required.body.code).toBe('MFA_REQUIRED');
      const replay = await s2.agent
        .post(api('/auth/mfa/verify'))
        .send({ code: totpCode(setup.secret, step) });
      expect(replay.status).toBe(401);
      const recovery = enabled.body.recoveryCodes[0];
      const ok = await s2.agent
        .post(api('/auth/mfa/verify'))
        .send({ recoveryCode: recovery })
        .expect(200);
      expect(ok.body.recoveryCodesLeft).toBe(9);
      await s2.agent.get(api('/platform/overview')).expect(200);
      const s3 = await login(app, fresh.email, PASSWORD);
      const reused = await s3.agent.post(api('/auth/mfa/verify')).send({ recoveryCode: recovery });
      expect(reused.status).toBe(401);

      const actions = (
        await prisma.auditLog.findMany({
          where: { actorUserId: fresh.id },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'auth.mfa_enabled',
          'auth.mfa_recovery_code_used',
          'auth.mfa_failed',
        ]),
      );
    });
  });

  describe('rôles internes', () => {
    it('applique la matrice de permissions plateforme', async () => {
      await support.agent.get(api('/platform/organizations')).expect(200);
      await support.agent.get(api('/platform/invoices')).expect(403);
      await auditor.agent.get(api('/platform/audit')).expect(200);
      await auditor.agent.get(api('/platform/invoices')).expect(200);
      await auditor.agent.post(api('/platform/invoices')).send({}).expect(403);
      await billing.agent.get(api('/platform/users')).expect(403);
      await billing.agent.get(api('/platform/commercial')).expect(200);
      // Un membre d'organisation n'accède jamais à l'administration centrale.
      await park.agent.get(api('/platform/commercial')).expect(403);
    });

    it('réserve la gestion des comptes internes au propriétaire, sans auto-gestion', async () => {
      const created = (
        await owner.agent
          .post(api('/platform/users'))
          .send({
            firstName: 'Nouvel',
            lastName: 'Agent',
            email: `s11new-${RUN}@test.ocallpark.local`,
            role: 'SUPPORT_AGENT',
          })
          .expect(201)
      ).body;
      expect(created.temporaryPassword).toEqual(expect.any(String));
      const forbidden = await owner.agent.post(api('/platform/users')).send({
        firstName: 'X',
        lastName: 'Y',
        email: `s11own-${RUN}@test.ocallpark.local`,
        role: 'PLATFORM_OWNER',
      });
      expect(forbidden.status).toBeGreaterThanOrEqual(400);
      const self = await owner.agent.post(api(`/platform/users/${owner.id}/deactivate`));
      expect(self.body.code).toBe('SELF_MANAGEMENT_FORBIDDEN');
      await owner.agent
        .patch(api(`/platform/users/${created.user.id}/role`))
        .send({ role: 'READ_ONLY_AUDITOR' })
        .expect(200);
      // Réinitialisation de la MFA (téléphone perdu) : sessions de la personne fermées, action journalisée.
      await owner.agent.post(api(`/platform/users/${created.user.id}/reset-mfa`)).expect(201);
    });
  });

  describe('catalogue et abonnements multi-produits', () => {
    it('expose les 4 produits ; Ocall School est à venir et non souscriptible', async () => {
      const products = (await support.agent.get(api('/platform/products')).expect(200)).body as {
        id: string;
        code: string;
        status: string;
      }[];
      const byCode = (code: string) => {
        const found = products.find((p) => p.code === code);
        if (!found) throw new Error(`Produit ${code} absent du catalogue.`);
        return found;
      };
      expect(products.map((p) => p.code)).toEqual(
        expect.arrayContaining([
          'OCALL_PARK',
          'OCALL_RESTAURANT',
          'OCALL_PARK_RESTAURANT',
          'OCALL_SCHOOL',
        ]),
      );
      expect(byCode('OCALL_SCHOOL').status).toBe('UPCOMING');
      const refused = await owner.agent
        .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
        .send({ productId: byCode('OCALL_SCHOOL').id, planId: randomUUID() });
      expect(refused.status).toBe(409);
      // Un seul produit de la famille Ocall Park par organisation.
      const restaurant = await prisma.subscriptionPlan.findFirstOrThrow({
        where: { product: { code: 'OCALL_RESTAURANT' } },
      });
      const parkFamily = await owner.agent
        .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
        .send({ productId: byCode('OCALL_RESTAURANT').id, planId: restaurant.id });
      expect(parkFamily.body.code).toBe('PARK_PRODUCT_EXISTS');
    });

    it('souscrit un autre produit commercialisé (un abonnement par produit)', async () => {
      const product = (
        await owner.agent
          .post(api('/platform/products'))
          .send({ code: productCode, name: `Produit test ${RUN}`, status: 'UPCOMING' })
          .expect(201)
      ).body;
      const noPlan = await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ status: 'AVAILABLE' });
      expect(noPlan.body.code).toBe('PRODUCT_WITHOUT_PLAN');
      // Les comptes sans gestion des offres ne peuvent pas en créer.
      await billing.agent
        .post(api(`/platform/products/${product.id}/plans`))
        .send({ name: 'Standard', monthlyPrice: 10000, setupFee: 50000 })
        .expect(403);
      const plan = (
        await owner.agent
          .post(api(`/platform/products/${product.id}/plans`))
          .send({ name: 'Standard', monthlyPrice: 10000, setupFee: 50000 })
          .expect(201)
      ).body;
      expect(plan).toMatchObject({ businessType: null, monthlyPrice: 10000, setupFee: 50000 });
      const duplicate = await owner.agent
        .post(api(`/platform/products/${product.id}/plans`))
        .send({ name: 'Standard', monthlyPrice: 1 });
      expect(duplicate.body.code).toBe('PLAN_NAME_TAKEN');
      // Les offres Ocall Park (une par métier, utilisées à l'inscription) ne se multiplient pas.
      const parkProduct = await prisma.saasProduct.findUniqueOrThrow({
        where: { code: 'OCALL_PARK' },
      });
      const parkPlan = await owner.agent
        .post(api(`/platform/products/${parkProduct.id}/plans`))
        .send({ name: 'Autre', monthlyPrice: 1 });
      expect(parkPlan.body.code).toBe('PARK_PLAN_FIXED');
      await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ status: 'AVAILABLE' })
        .expect(200);
      await billing.agent
        .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
        .send({ productId: product.id, planId: plan.id })
        .expect(201);
      const again = await billing.agent
        .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
        .send({ productId: product.id, planId: plan.id });
      expect(again.body.code).toBe('SUBSCRIPTION_EXISTS');
      const org = (
        await support.agent.get(api(`/platform/organizations/${park.organizationId}`)).expect(200)
      ).body;
      expect(
        org.subscriptions.map((s: { product: { code: string } }) => s.product.code).sort(),
      ).toEqual(['OCALL_PARK', productCode].sort());
    });
  });

  describe('factures et règlements manuels', () => {
    it('facture au tarif de l’offre, rapproche un règlement exact et fige le tarif accepté', async () => {
      const sub = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: park.organizationId, product: { code: 'OCALL_PARK' } },
        include: { plan: true },
      });
      const key = randomUUID();
      const issue = () =>
        billing.agent.post(api('/platform/invoices')).send({
          subscriptionId: sub.id,
          lines: [{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 2 }],
          idempotencyKey: key,
        });
      const invoice = (await issue().expect(201)).body;
      const expected = sub.plan.setupFee + 2 * sub.plan.monthlyPrice;
      expect(invoice.total).toBe(expected);
      expect(invoice.number).toMatch(/^OCP-\d{4}-\d{5}$/);
      // Nouvelle tentative avec la même clé : la même facture, pas de doublon.
      expect((await issue().expect(201)).body.id).toBe(invoice.id);

      const record = (amount: number) =>
        billing.agent.post(api('/platform/subscription-payments')).send({
          organizationId: park.organizationId,
          invoiceId: invoice.id,
          amount,
          method: 'BANK_TRANSFER',
          reference: `VIR-S11-${amount}`,
          paidAt: new Date().toISOString().slice(0, 10),
          periodStart: '2026-11-01',
          periodEnd: '2026-12-31',
        });
      expect((await record(expected - 1)).body.code).toBe('PAYMENT_AMOUNT_MISMATCH');
      const payment = (await record(expected).expect(201)).body;
      const validated = (
        await billing.agent
          .post(api(`/platform/subscription-payments/${payment.id}/validate`))
          .send({ extendSubscription: true })
          .expect(201)
      ).body;
      expect(validated.invoicePaid).toBe(true);

      const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(paid.status).toBe('PAID');
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(after.status).toBe('ACTIVE');
      expect(after.agreedMonthlyPrice).toBe(sub.plan.monthlyPrice);
      expect(after.agreedSetupFee).toBe(sub.plan.setupFee);

      const cancel = await billing.agent
        .post(api(`/platform/invoices/${invoice.id}/cancel`))
        .send({ reason: 'Erreur de saisie' });
      expect(cancel.status).toBe(409);

      // Le tarif accepté reste figé si l'offre change ensuite.
      await prisma.subscriptionPlan.update({
        where: { id: sub.planId },
        data: { monthlyPrice: sub.plan.monthlyPrice + 5000 },
      });
      try {
        const next = (
          await billing.agent
            .post(api('/platform/invoices'))
            .send({
              subscriptionId: sub.id,
              lines: [{ kind: 'MONTHLY', months: 1 }],
              idempotencyKey: randomUUID(),
            })
            .expect(201)
        ).body;
        expect(next.total).toBe(sub.plan.monthlyPrice);
        await billing.agent
          .post(api(`/platform/invoices/${next.id}/cancel`))
          .send({ reason: 'Facture de contrôle' })
          .expect(201);
      } finally {
        await prisma.subscriptionPlan.update({
          where: { id: sub.planId },
          data: { monthlyPrice: sub.plan.monthlyPrice },
        });
      }

      const dashboard = (await auditor.agent.get(api('/platform/commercial')).expect(200)).body;
      expect(dashboard.collected.total).toBeGreaterThanOrEqual(expected);
      expect(dashboard.theoreticalMrr).toBeGreaterThanOrEqual(sub.plan.monthlyPrice);
      const audit = (await auditor.agent.get(api('/platform/audit')).expect(200)).body as {
        action: string;
      }[];
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining(['platform.invoice_issued', 'platform.invoice_cancelled']),
      );
    });
  });
});
