import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  signup,
} from './helpers';

/**
 * Sprint 12A — Ocall Suite : catalogue public, demandes de démonstration, règles de
 * commercialisation, règlements (espèces, virement) à quatre yeux, modes d'activation AUTO et
 * ADMIN_APPROVAL, remboursements, remises d'espèces, actions d'administration des abonnements,
 * expiration, paiement en ligne avec prestataire SIMULÉ (aucun appel réel).
 * Exécuté uniquement sur la base de test.
 */
describe('Sprint 12A — Ocall Suite, règlements et paiement en ligne (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let park: SignedUpOwner;
  let resto: SignedUpOwner;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let billing2: InternalAccount;
  let support: InternalAccount;
  let auditor: InternalAccount;

  const api = (path: string) => `/api/v1${path}`;
  const today = () => new Date().toISOString().slice(0, 10);

  async function subscriptionOf(organizationId: string, productCode: string) {
    return prisma.subscription.findFirstOrThrow({
      where: { organizationId, product: { code: productCode } },
      include: { plan: true },
    });
  }

  async function issue(subscriptionId: string, months = 1, setup = false) {
    const res = await billing.agent
      .post(api('/platform/invoices'))
      .send({
        subscriptionId,
        lines: [...(setup ? [{ kind: 'SETUP' }] : []), { kind: 'MONTHLY', months }],
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    return res.body as { id: string; total: number; number: string };
  }

  function declare(
    who: InternalAccount,
    organizationId: string,
    invoiceId: string,
    body: Record<string, unknown>,
  ) {
    const cash = body.method === 'CASH';
    return who.agent
      .post(api(cash ? '/platform/subscription-payments/cash' : '/platform/subscription-payments'))
      .send({
        organizationId,
        invoiceId,
        currency: 'XOF',
        paidAt: today(),
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        ...body,
      });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    park = await signup(app, 's12apark', 'PARK');
    resto = await signup(app, 's12aresto', 'RESTAURANT');
    owner = await internalAccount(app, prisma, 's12aowner', 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, 's12abilling', 'BILLING_MANAGER');
    billing2 = await internalAccount(app, prisma, 's12abilling2', 'BILLING_MANAGER');
    support = await internalAccount(app, prisma, 's12asupport', 'SUPPORT_AGENT');
    auditor = await internalAccount(app, prisma, 's12aauditor', 'READ_ONLY_AUDITOR');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  // ─── Site public ───

  describe('catalogue public et demandes de démonstration', () => {
    it('catalogue : produits publics, statut commercial, tarifs seulement si commercialisé', async () => {
      const list = (await park.agent.get(api('/public/suite/products')).expect(200)).body as {
        slug: string;
        status: string;
        statusLabel: string;
        plans: { monthlyPrice: number; setupFee: number }[];
      }[];
      const bySlug = (slug: string) => list.find((p) => p.slug === slug);
      expect(bySlug('ocall-park')).toMatchObject({ status: 'ACTIVE', statusLabel: 'Disponible' });
      expect(bySlug('ocall-park')!.plans[0]).toMatchObject({
        monthlyPrice: 15000,
        setupFee: 250000,
      });
      for (const slug of [
        'ocall-school',
        'ocall-clinic',
        'ocall-rh',
        'ocall-solar',
        'ocall-docs',
      ]) {
        expect(bySlug(slug)).toMatchObject({
          status: 'COMING_SOON',
          statusLabel: 'Bientôt disponible',
          plans: [],
        });
      }
      expect(bySlug('ocall-park-restaurant')).toBeUndefined(); // offre groupée, non listée
      await park.agent.get(api('/public/suite/products/ocall-park-restaurant')).expect(404);
      const clinic = (await park.agent.get(api('/public/suite/products/ocall-clinic')).expect(200))
        .body;
      expect(clinic.subscribable).toBe(false);
    });

    it('tarifs Ocall Park publiés exacts (250 000 / 15 000, 250 000 / 15 000, 350 000 / 25 000)', async () => {
      const plans = (await park.agent.get(api('/plans')).expect(200)).body as {
        businessType: string;
        monthlyPrice: number;
        setupFee: number;
      }[];
      const by = (t: string) => plans.find((p) => p.businessType === t);
      expect(by('RESTAURANT')).toMatchObject({ monthlyPrice: 15000, setupFee: 250000 });
      expect(by('PARK')).toMatchObject({ monthlyPrice: 15000, setupFee: 250000 });
      expect(by('PARK_RESTAURANT')).toMatchObject({ monthlyPrice: 25000, setupFee: 350000 });
    });

    it('démonstration : enregistrée sans abonnement ; anti-spam silencieux ; consultation interne', async () => {
      const subsBefore = await prisma.subscription.count();
      const body = {
        name: 'Awa Traoré',
        company: `Clinique du Fleuve ${RUN}`,
        country: 'Mali',
        phone: '+223 70 00 00 00',
        email: email('s12ademo'),
        product: 'ocall-clinic',
        message: 'Nous souhaitons découvrir Ocall Clinic pour deux cabinets.',
        consent: true,
        startedAt: Date.now() - 15_000,
      };
      const send = (extra: Record<string, unknown>) =>
        park.agent.post(api('/public/suite/demo-requests')).send({ ...body, ...extra });
      expect((await send({}).expect(201)).body).toEqual({ received: true });
      // Robots : même réponse, rien d'enregistré.
      await send({ website: 'http://spam.example', company: `Spam piège ${RUN}` }).expect(201);
      await send({ startedAt: Date.now(), company: `Spam rapide ${RUN}` }).expect(201);
      await send({ consent: false }).expect(400);
      const stored = await prisma.demoRequest.findMany({
        where: { email: body.email },
        include: { product: true },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ status: 'NEW', company: body.company });
      expect(stored[0]!.product?.code).toBe('OCALL_CLINIC');
      expect(stored[0]!.number).toMatch(/^DEM-\d{4}-\d{5}$/);
      expect(await prisma.subscription.count()).toBe(subsBefore);

      const listed = (await support.agent.get(api('/platform/demo-requests')).expect(200)).body;
      expect(listed.some((d: { id: string }) => d.id === stored[0]!.id)).toBe(true);
      await auditor.agent.get(api('/platform/demo-requests')).expect(403);
      await park.agent.get(api('/platform/demo-requests')).expect(403);
      await support.agent
        .patch(api(`/platform/demo-requests/${stored[0]!.id}`))
        .send({ status: 'CONTACTED', notes: 'Rappel prévu jeudi' })
        .expect(200);
      const dash = (await owner.agent.get(api('/platform/commercial')).expect(200)).body;
      expect(dash.demoRequests.received).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Règles de commercialisation ───

  describe('catalogue : commercialisation contrôlée par le serveur', () => {
    it('produit « bientôt disponible » non souscriptible ; produit sans offre jamais créé commercialisé', async () => {
      const products = (await owner.agent.get(api('/platform/products')).expect(200)).body;
      const school = products.find((p: { code: string }) => p.code === 'OCALL_SCHOOL');
      const res = await billing.agent
        .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
        .send({ productId: school.id, planId: randomUUID() });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE');
      const direct = await owner.agent
        .post(api('/platform/products'))
        .send({ code: `OCALL_X${RUN.toUpperCase()}`, name: `Direct ${RUN}`, status: 'ACTIVE' });
      expect(direct.body.code).toBe('PRODUCT_WITHOUT_PLAN');
    });
  });

  // ─── Espèces, quatre yeux, ADMIN_APPROVAL, remboursement, remise ───

  describe('espèces : déclaration, quatre yeux, approbation, remboursement, remise de caisse', () => {
    let invoice: { id: string; total: number };
    let p1: { id: string; receiptNumber: string };
    let p2: { id: string };

    it('déclaration : reçu numéroté, reçu en double, reste dû, double déclaration', async () => {
      const sub = await subscriptionOf(park.organizationId, 'OCALL_PARK');
      expect(sub.activationMode).toBe('ADMIN_APPROVAL');
      invoice = await issue(sub.id, 1);
      expect(invoice.total).toBe(15000);
      const cash = (amount: number, receiptReference?: string) =>
        declare(billing, park.organizationId, invoice.id, {
          method: 'CASH',
          amount,
          receiptReference,
        });

      expect((await cash(5000).expect(400)).body.code).toBe('RECEIPT_REFERENCE_REQUIRED');
      p1 = (await cash(5000, `R-${RUN}-1`).expect(201)).body;
      expect(p1.receiptNumber).toMatch(/^REC-\d{4}-\d{5}$/);
      expect((await cash(1000, `R-${RUN}-1`).expect(409)).body.code).toBe('RECEIPT_DUPLICATE');
      expect((await cash(10001, `R-${RUN}-2`).expect(409)).body.code).toBe(
        'PAYMENT_EXCEEDS_REMAINING',
      );
      p2 = (await cash(10000, `R-${RUN}-2`).expect(201)).body;
      expect((await cash(1, `R-${RUN}-3`).expect(409)).body.code).toBe('INVOICE_FULLY_COVERED');
      // Une déclaration n'est pas un encaissement et n'active rien.
      const sub2 = await subscriptionOf(park.organizationId, 'OCALL_PARK');
      expect(sub2.status).toBe(sub.status);
    });

    it('quatre yeux ; paiement partiel sans effet ; solde → activation à approuver', async () => {
      await billing.agent.post(api(`/platform/subscription-payments/${p1.id}/confirm`)).expect(403);
      const c1 = (
        await billing2.agent
          .post(api(`/platform/subscription-payments/${p1.id}/confirm`))
          .expect(200)
      ).body;
      expect(c1).toMatchObject({ invoicePaid: false, activation: null });
      const c2 = (
        await owner.agent.post(api(`/platform/subscription-payments/${p2.id}/confirm`)).expect(200)
      ).body;
      expect(c2.invoicePaid).toBe(true);
      expect(c2.activation).toMatchObject({ mode: 'ADMIN_APPROVAL', result: 'pending' });
      const sub = await subscriptionOf(park.organizationId, 'OCALL_PARK');
      expect(sub.status).toBe('PENDING_ACTIVATION');
      const pending = (
        await owner.agent
          .get(api('/platform/subscription-payments/pending-activations'))
          .expect(200)
      ).body;
      expect(pending.count).toBeGreaterThanOrEqual(1);
    });

    it('refus d’activation motivé : paiement compté, abonnement revenu à son état ; remboursement', async () => {
      await support.agent
        .post(api(`/platform/subscription-payments/${p2.id}/refuse-activation`))
        .send({ reason: 'Dossier incomplet' })
        .expect(403);
      const refused = (
        await billing2.agent
          .post(api(`/platform/subscription-payments/${p2.id}/refuse-activation`))
          .send({ reason: 'Dossier incomplet' })
          .expect(200)
      ).body;
      expect(refused).toMatchObject({ status: 'CONFIRMED', activationStatus: 'REFUSED' });
      const sub = await subscriptionOf(park.organizationId, 'OCALL_PARK');
      expect(sub.status).toBe('NOT_ACTIVATED');
      const dash = (await owner.agent.get(api('/platform/commercial')).expect(200)).body;
      expect(dash.collected.cash).toBeGreaterThanOrEqual(15000);

      const refunded = (
        await billing.agent
          .post(api(`/platform/subscription-payments/${p2.id}/refund`))
          .send({ reason: 'Remboursé en espèces au client' })
          .expect(200)
      ).body;
      expect(refunded.status).toBe('REFUNDED');
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(inv.status).toBe('ISSUED'); // plus soldée
      await billing.agent
        .post(api(`/platform/subscription-payments/${p2.id}/refund`))
        .send({ reason: 'Deuxième fois' })
        .expect(409);
    });

    it('remise de caisse confirmée par une autre personne ; rapprochement par collecteur', async () => {
      const remittance = (
        await billing.agent
          .post(api('/platform/cash-remittances'))
          .send({
            collectorId: billing.id,
            paymentIds: [p1.id],
            remittedAt: today(),
            reference: `BD-${RUN}`,
          })
          .expect(201)
      ).body;
      expect(remittance).toMatchObject({ amount: 5000, status: 'DECLARED' });
      expect(remittance.number).toMatch(/^RCA-\d{4}-\d{5}$/);
      // Règlement remboursé ou déjà remis : refusé.
      await billing.agent
        .post(api('/platform/cash-remittances'))
        .send({ collectorId: billing.id, paymentIds: [p1.id, p2.id], remittedAt: today() })
        .expect(409);
      await billing.agent
        .post(api(`/platform/cash-remittances/${remittance.id}/confirm`))
        .expect(403);
      await owner.agent
        .post(api(`/platform/cash-remittances/${remittance.id}/confirm`))
        .expect(200);
      const rows = (
        await auditor.agent.get(api('/platform/cash-remittances/reconciliation')).expect(200)
      ).body;
      const mine = rows.find((r: { collectorId: string }) => r.collectorId === billing.id);
      expect(mine).toMatchObject({ remittedConfirmed: 5000, refunded: 10000, toRemit: 0 });
    });

    it('annulation par le déclarant avant confirmation', async () => {
      const p3 = (
        await declare(billing, park.organizationId, invoice.id, {
          method: 'MANUAL_TRANSFER',
          amount: 1000,
          reference: `VIR-${RUN}-C`,
        }).expect(201)
      ).body;
      await auditor.agent
        .post(api(`/platform/subscription-payments/${p3.id}/cancel`))
        .send({ reason: 'Erreur' })
        .expect(403);
      const cancelled = (
        await billing.agent
          .post(api(`/platform/subscription-payments/${p3.id}/cancel`))
          .send({ reason: 'Saisie en double' })
          .expect(200)
      ).body;
      expect(cancelled.status).toBe('CANCELLED');
      await billing2.agent
        .post(api(`/platform/subscription-payments/${p3.id}/confirm`))
        .expect(409);
    });
  });

  // ─── Mode AUTO, non-rétroactivité, actions, historique, expiration ───

  describe('mode AUTO, configuration non rétroactive, actions d’administration', () => {
    let subId: string;
    let planId: string;
    let planB: string;

    it('offre AUTO : mode figé à la souscription ; un changement de l’offre n’est pas rétroactif', async () => {
      const code = `OCALL_A${RUN.toUpperCase()}`;
      const product = (
        await owner.agent
          .post(api('/platform/products'))
          .send({ code, name: `Produit auto ${RUN}`, status: 'COMING_SOON' })
          .expect(201)
      ).body;
      const plan = (
        await owner.agent
          .post(api(`/platform/products/${product.id}/plans`))
          .send({ name: 'Essentiel', monthlyPrice: 20000, setupFee: 0, activationMode: 'AUTO' })
          .expect(201)
      ).body;
      planId = plan.id;
      planB = (
        await owner.agent
          .post(api(`/platform/products/${product.id}/plans`))
          .send({ name: 'Pro', monthlyPrice: 30000, setupFee: 0, activationMode: 'AUTO' })
          .expect(201)
      ).body.id;
      await owner.agent
        .patch(api(`/platform/products/${product.id}`))
        .send({ status: 'ACTIVE' })
        .expect(200);
      subId = (
        await billing.agent
          .post(api(`/platform/organizations/${park.organizationId}/subscriptions`))
          .send({ productId: product.id, planId })
          .expect(201)
      ).body.id;
      await owner.agent
        .patch(api(`/platform/plans/${planId}`))
        .send({ activationMode: 'ADMIN_APPROVAL' })
        .expect(200);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.activationMode).toBe('AUTO');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'platform.plan_updated', targetId: planId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.metadata).toMatchObject({
        before: { activationMode: 'AUTO' },
        activationModeChanged: true,
      });
    });

    it('AUTO : activation automatique après encaissement confirmé', async () => {
      const inv = await issue(subId, 1);
      const p = (
        await declare(billing, park.organizationId, inv.id, {
          method: 'MANUAL_TRANSFER',
          amount: inv.total,
          reference: `VIR-${RUN}-A1`,
        }).expect(201)
      ).body;
      const c = (
        await billing2.agent
          .post(api(`/platform/subscription-payments/${p.id}/confirm`))
          .expect(200)
      ).body;
      expect(c.activation).toMatchObject({
        mode: 'AUTO',
        result: 'applied',
        subscriptionStatus: 'ACTIVE',
      });
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      const history = await prisma.subscriptionPriceHistory.findMany({
        where: { subscriptionId: subId },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ monthlyPrice: 20000, effectiveTo: null });
    });

    it('suspendu : AUTO bloqué → approbation requise, refusée tant que suspendu ; réactivation', async () => {
      await support.agent
        .post(api(`/platform/subscriptions/${subId}/suspend`))
        .send({ reason: 'Litige' })
        .expect(403);
      await billing.agent
        .post(api(`/platform/subscriptions/${subId}/suspend`))
        .send({ reason: 'Litige client' })
        .expect(200);
      const inv = await issue(subId, 1);
      const p = (
        await declare(billing, park.organizationId, inv.id, {
          method: 'MANUAL_TRANSFER',
          amount: inv.total,
          reference: `VIR-${RUN}-A2`,
          periodStart: '2026-12-01',
          periodEnd: '2026-12-31',
        }).expect(201)
      ).body;
      const c = (
        await billing2.agent
          .post(api(`/platform/subscription-payments/${p.id}/confirm`))
          .expect(200)
      ).body;
      expect(c.activation).toMatchObject({
        mode: 'AUTO',
        result: 'pending',
        blockedBy: 'SUBSCRIPTION_NOT_EXTENDABLE',
      });
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe(
        'SUSPENDED',
      );
      const blocked = await owner.agent.post(
        api(`/platform/subscription-payments/${p.id}/approve-activation`),
      );
      expect(blocked.status).toBe(409);
      // Changement d'offre impossible tant qu'une activation attend une décision.
      expect(
        (
          await billing.agent
            .post(api(`/platform/subscriptions/${subId}/change-plan`))
            .send({ planId: planB, reason: 'Montée en gamme' })
        ).body.code,
      ).toBe('ACTIVATION_PENDING');
      await billing.agent
        .post(api(`/platform/subscriptions/${subId}/reactivate`))
        .send({ reason: 'Litige réglé' })
        .expect(200);
      await owner.agent
        .post(api(`/platform/subscription-payments/${p.id}/approve-activation`))
        .expect(200);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.expiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('changement d’offre : tarif historisé ; résiliation définitive ; expiration des échus', async () => {
      await billing.agent
        .post(api(`/platform/subscriptions/${subId}/change-plan`))
        .send({ planId: planB, reason: 'Montée en gamme' })
        .expect(200);
      const history = (
        await auditor.agent.get(api(`/platform/subscriptions/${subId}/history`)).expect(200)
      ).body;
      expect(history.priceHistory.map((h: { monthlyPrice: number }) => h.monthlyPrice)).toEqual([
        30000, 20000,
      ]);
      expect(history.priceHistory[1].effectiveTo).not.toBeNull();

      await prisma.subscription.update({
        where: { id: subId },
        data: { expiresAt: new Date(Date.now() - 86_400_000) },
      });
      const run = (await owner.agent.post(api('/platform/subscriptions/expire-due')).expect(200))
        .body;
      expect(run.expired).toBeGreaterThanOrEqual(1);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe(
        'EXPIRED',
      );
      await owner.agent.post(api('/platform/subscriptions/expire-due')).expect(200); // idempotent

      await billing.agent
        .post(api(`/platform/subscriptions/${subId}/cancel`))
        .send({ reason: 'Fin de contrat' })
        .expect(200);
      const inv = await issue(subId, 1);
      const p = (
        await declare(billing, park.organizationId, inv.id, {
          method: 'MANUAL_TRANSFER',
          amount: inv.total,
          reference: `VIR-${RUN}-A3`,
        }).expect(201)
      ).body;
      const c = (
        await billing2.agent
          .post(api(`/platform/subscription-payments/${p.id}/confirm`))
          .expect(200)
      ).body;
      expect(c.activation).toMatchObject({
        result: 'pending',
        blockedBy: 'SUBSCRIPTION_NOT_EXTENDABLE',
      });
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).status).toBe(
        'CANCELED',
      );
    });

    it('produit retiré : plus aucune facture (A45)', async () => {
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
      await owner.agent
        .patch(api(`/platform/products/${sub.productId}`))
        .send({ status: 'RETIRED' })
        .expect(200);
      const res = await billing.agent.post(api('/platform/invoices')).send({
        subscriptionId: subId,
        lines: [{ kind: 'MONTHLY', months: 1 }],
        idempotencyKey: randomUUID(),
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE');
    });
  });

  // ─── Paiement en ligne (prestataire simulé) ───

  describe('paiement en ligne : vérification serveur, idempotence, cohérence, isolation', () => {
    let invoice: { id: string; total: number };

    const initiate = (who: SignedUpOwner, invoiceId: string, channels = 'ALL') =>
      who.agent.post(api('/billing/online-payments')).send({ invoiceId, channels });
    const complete = (reference: string, body: Record<string, unknown>) =>
      resto.agent.post(api(`/online-payments/simulated/${reference}/complete`)).send(body);

    it('factures visibles par leur seule organisation ; paiement initié avec une référence persistante', async () => {
      const sub = await subscriptionOf(resto.organizationId, 'OCALL_RESTAURANT');
      invoice = await issue(sub.id, 1);
      const list = (await resto.agent.get(api('/billing/invoices')).expect(200)).body;
      const mine = list.find((i: { id: string }) => i.id === invoice.id);
      expect(mine).toMatchObject({ remaining: invoice.total, payableOnline: true });
      const parkList = (await park.agent.get(api('/billing/invoices')).expect(200)).body;
      expect(parkList.some((i: { id: string }) => i.id === invoice.id)).toBe(false);
      await initiate(park, invoice.id).expect(404);

      const first = (await initiate(resto, invoice.id).expect(201)).body;
      expect(first.reference).toMatch(/^OCS[0-9A-F]{18}$/);
      expect(first.paymentUrl).toContain(`/paiement-simule/${first.reference}`);
      const again = (await initiate(resto, invoice.id).expect(201)).body;
      expect(again.reference).toBe(first.reference);
      // Le retour du navigateur ne confirme rien : toujours en attente.
      const status = (
        await resto.agent.get(api(`/billing/online-payments/${first.reference}`)).expect(200)
      ).body;
      expect(status.status).toBe('PENDING');
      await park.agent.get(api(`/billing/online-payments/${first.reference}`)).expect(404);

      // Notification non authentique : ignorée.
      const forged = (
        await park.agent
          .post(api('/online-payments/notify'))
          .set('x-simulated-token', 'ab'.repeat(32))
          .send({ reference: first.reference })
          .expect(200)
      ).body;
      expect(forged).toEqual({ received: false });

      // Succès annoncé avec un montant différent : jamais encaissé, examen requis.
      const mismatch = (
        await complete(first.reference, { outcome: 'SUCCEEDED', amount: invoice.total - 5 }).expect(
          200,
        )
      ).body;
      expect(mismatch.status).toBe('REVIEW_REQUIRED');
      expect(await prisma.subscriptionPayment.count({ where: { invoiceId: invoice.id } })).toBe(0);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(
        'ISSUED',
      );
    });

    it('échec, annulation, attente, puis succès vérifié : un seul encaissement malgré les notifications répétées', async () => {
      const run = async (outcome: string) => {
        const { reference } = (await initiate(resto, invoice.id).expect(201)).body;
        const view = (await complete(reference, { outcome, method: 'CARD' }).expect(200)).body;
        return { reference, view };
      };
      expect((await run('FAILED')).view.status).toBe('FAILED');
      expect((await run('CANCELLED')).view.status).toBe('CANCELLED');
      const pending = await run('PENDING');
      expect(pending.view.status).toBe('PENDING');
      // La tentative en attente est réutilisée, puis aboutit.
      const ok = (
        await complete(pending.reference, { outcome: 'SUCCEEDED', method: 'CARD' }).expect(200)
      ).body;
      expect(ok).toMatchObject({
        status: 'SUCCEEDED',
        paymentMethod: 'CARD',
        activationStatus: 'PENDING',
      });
      expect(ok.invoice.status).toBe('PAID');

      // Notifications répétées (signées) : aucun second encaissement.
      for (let i = 0; i < 3; i++) {
        await complete(pending.reference, { outcome: 'SUCCEEDED', method: 'CARD' }).expect(200);
      }
      const payments = await prisma.subscriptionPayment.findMany({
        where: { invoiceId: invoice.id },
      });
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        status: 'CONFIRMED',
        method: 'CINETPAY_CARD',
        amount: invoice.total,
      });
      const sub = await subscriptionOf(resto.organizationId, 'OCALL_RESTAURANT');
      expect(sub.status).toBe('PENDING_ACTIVATION'); // ADMIN_APPROVAL par défaut
      await initiate(resto, invoice.id).expect(409); // facture payée

      const online = (
        await billing.agent
          .get(api('/platform/online-payments'))
          .query({ organizationId: resto.organizationId })
          .expect(200)
      ).body;
      expect(online.map((o: { status: string }) => o.status).sort()).toEqual(
        ['CANCELLED', 'FAILED', 'REVIEW_REQUIRED', 'SUCCEEDED'].sort(),
      );
      await resto.agent.get(api('/platform/online-payments')).expect(403);

      // Approbation : activation de la période payée.
      await billing2.agent
        .post(api(`/platform/subscription-payments/${payments[0]!.id}/approve-activation`))
        .expect(200);
      expect((await subscriptionOf(resto.organizationId, 'OCALL_RESTAURANT')).status).toBe(
        'ACTIVE',
      );
    });
  });

  // ─── Autorisations ───

  describe('autorisations (serveur)', () => {
    it('chaque action exige sa permission ; un client n’atteint aucune route plateforme', async () => {
      const sub = await subscriptionOf(park.organizationId, 'OCALL_PARK');
      const inv = await issue(sub.id, 1);
      await declare(support, park.organizationId, inv.id, {
        method: 'CASH',
        amount: 100,
        receiptReference: `R-${RUN}-S`,
      }).expect(403);
      await declare(auditor, park.organizationId, inv.id, {
        method: 'MANUAL_TRANSFER',
        amount: 100,
      }).expect(403);
      // La route des virements refuse les espèces (et inversement).
      await declare(billing, park.organizationId, inv.id, {
        method: 'CASH',
        amount: 100,
        receiptReference: 'X',
      })
        .expect(201)
        .then(async (r) => {
          await billing.agent
            .post(api(`/platform/subscription-payments/${r.body.id}/cancel`))
            .send({ reason: 'Test' })
            .expect(200);
        });
      const wrongRoute = await billing.agent.post(api('/platform/subscription-payments')).send({
        organizationId: park.organizationId,
        invoiceId: inv.id,
        currency: 'XOF',
        method: 'CASH',
        amount: 100,
        paidAt: today(),
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
      });
      expect(wrongRoute.body.code).toBe('METHOD_ROUTE_MISMATCH');
      for (const path of [
        '/platform/subscription-payments',
        '/platform/cash-remittances',
        '/platform/online-payments',
        '/platform/demo-requests',
      ]) {
        await park.agent.get(api(path)).expect(403);
      }
      await park.agent
        .post(api(`/platform/subscriptions/${sub.id}/suspend`))
        .send({ reason: 'Essai' })
        .expect(403);
    });
  });
});
