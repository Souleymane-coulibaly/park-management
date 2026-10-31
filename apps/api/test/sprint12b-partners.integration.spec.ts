import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  type PartnerAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
  partnerAccount,
  PASSWORD,
  signup,
} from './helpers';

/**
 * Sprint 12B — partenaires commerciaux : création et vérification, connexion (MFA obligatoire),
 * prospects et doublons, attribution confirmée par Ocall, commissions sur encaissements confirmés
 * (mise en service, mensualités dans la fenêtre), impayés, remboursements, versements à quatre
 * yeux, collecte d'espèces plafonnée, isolation, suspension, refus des espaces client et Super
 * Admin. Exécuté uniquement sur la base de test.
 */
describe('Sprint 12B — portail partenaires et commissions (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let billing2: InternalAccount;
  let support: InternalAccount;
  let clientA: SignedUpOwner;
  let clientB: SignedUpOwner;
  let p1: PartnerAccount;
  let p2: PartnerAccount;
  let prospectA: string;
  let ruleId: string;

  const api = (path: string) => `/api/v1${path}`;
  const today = () => new Date().toISOString().slice(0, 10);

  async function subscriptionOf(organizationId: string) {
    return prisma.subscription.findFirstOrThrow({ where: { organizationId } });
  }

  async function invoice(organizationId: string, lines: Record<string, unknown>[]) {
    const sub = await subscriptionOf(organizationId);
    return (
      await billing.agent
        .post(api('/platform/invoices'))
        .send({ subscriptionId: sub.id, lines, idempotencyKey: randomUUID() })
        .expect(201)
    ).body as { id: string; total: number };
  }

  /** Virement déclaré par `billing`, confirmé par `billing2` (quatre yeux). */
  async function paid(
    organizationId: string,
    inv: { id: string; total: number },
    amount = inv.total,
  ) {
    const p = (
      await billing.agent
        .post(api('/platform/subscription-payments'))
        .send({
          organizationId,
          invoiceId: inv.id,
          amount,
          currency: 'XOF',
          method: 'MANUAL_TRANSFER',
          reference: `VIR-${randomUUID().slice(0, 8)}`,
          paidAt: today(),
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
        })
        .expect(201)
    ).body as { id: string };
    await billing2.agent.post(api(`/platform/subscription-payments/${p.id}/confirm`)).expect(200);
    return p.id;
  }

  const commissionsOf = (paymentId: string) =>
    prisma.commission.findMany({
      where: { subscriptionPaymentId: paymentId },
      orderBy: { kind: 'asc' },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, 's12bowner', 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, 's12bbilling', 'BILLING_MANAGER');
    billing2 = await internalAccount(app, prisma, 's12bbilling2', 'BILLING_MANAGER');
    support = await internalAccount(app, prisma, 's12bsupport', 'SUPPORT_AGENT');
    clientA = await signup(app, 's12bclienta', 'RESTAURANT');
    clientB = await signup(app, 's12bclientb', 'RESTAURANT');
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('1-2. création par le Super Admin, connexion avec MFA, accès limité avant vérification', async () => {
    await support.agent.post(api('/platform/partners')).send({}).expect(403);
    await billing.agent.get(api('/platform/partners')).expect(403);
    p1 = await partnerAccount(app, owner.agent, 's12bp1', { verify: false });
    const me = (await p1.agent.get(api('/auth/me')).expect(200)).body;
    expect(me).toMatchObject({
      accountKind: 'partner',
      organization: null,
      platformPermissions: [],
    });
    expect(me.partner).toMatchObject({ status: 'PENDING_VERIFICATION', code: p1.code });
    await p1.agent.get(api('/partner/profile')).expect(200);
    expect((await p1.agent.get(api('/partner/prospects')).expect(403)).body.code).toBe(
      'PARTNER_NOT_VERIFIED',
    );
    await owner.agent.post(api(`/platform/partners/${p1.partnerId}/verify`)).expect(200);
    await p1.agent.get(api('/partner/prospects')).expect(200);
    p2 = await partnerAccount(app, owner.agent, 's12bp2');
  });

  it('13. aucun accès au Super Admin ni à l’espace client', async () => {
    for (const path of [
      '/platform/partners',
      '/platform/subscription-payments',
      '/platform/commercial',
    ]) {
      await p1.agent.get(api(path)).expect(403);
    }
    await p1.agent.get(api('/establishments')).expect(403);
    await p1.agent.get(api('/billing/invoices')).expect(403);
    // Un client et un compte interne n'atteignent pas le portail partenaire.
    await clientA.agent.get(api('/partner/dashboard')).expect(403);
    await owner.agent.get(api('/partner/dashboard')).expect(403);
  });

  it('3-4. prospect enregistré ; doublon détecté côté serveur, sans révéler le partenaire', async () => {
    const created = (
      await p1.agent
        .post(api('/partner/prospects'))
        .send({
          companyName: `Maquis Le Fleuve ${RUN}`,
          contactName: 'Aminata Diallo',
          phone: '+223 70 11 22 33',
          email: email('s12bprospect'),
          country: 'Mali',
          city: 'Bamako',
          product: 'ocall-restaurant',
        })
        .expect(201)
    ).body;
    prospectA = created.id;
    const days = (new Date(created.protectedUntil).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);

    const dup = (body: Record<string, unknown>) =>
      p2.agent.post(api('/partner/prospects')).send({
        companyName: 'Autre nom',
        contactName: 'Xavier Koné',
        phone: '+223 66 00 00 00',
        country: 'Mali',
        ...body,
      });
    // Même numéro, autre format ; même nom avec forme juridique et accents ; même e-mail.
    expect((await dup({ phone: '0022370112233' }).expect(409)).body.code).toBe(
      'PROSPECT_ALREADY_ATTRIBUTED',
    );
    expect((await dup({ companyName: `SARL MAQUIS le fleuve ${RUN}` }).expect(409)).body.code).toBe(
      'PROSPECT_ALREADY_ATTRIBUTED',
    );
    const conflict = (await dup({ email: email('s12bprospect') }).expect(409)).body;
    expect(JSON.stringify(conflict)).not.toContain(p1.code);
    expect(
      (
        await p1.agent
          .post(api('/partner/prospects'))
          .send({
            companyName: `Maquis Le Fleuve ${RUN}`,
            contactName: 'Awa Diallo',
            phone: '70112233',
            country: 'Mali',
          })
          .expect(409)
      ).body.code,
    ).toBe('PROSPECT_DUPLICATE');
    // Statut « gagné » réservé à Ocall.
    await p1.agent
      .patch(api(`/partner/prospects/${prospectA}`))
      .send({ status: 'WON' })
      .expect(400);
    await p1.agent
      .patch(api(`/partner/prospects/${prospectA}`))
      .send({ status: 'QUALIFIED' })
      .expect(200);
  });

  it('12. isolation entre partenaires', async () => {
    await p2.agent
      .patch(api(`/partner/prospects/${prospectA}`))
      .send({ notes: 'intrusion' })
      .expect(404);
    await p2.agent
      .post(api(`/partner/prospects/${prospectA}/demo`))
      .send({ message: 'Demande de démo test' })
      .expect(404);
    const list = (await p2.agent.get(api('/partner/prospects')).expect(200)).body;
    expect(list.some((p: { id: string }) => p.id === prospectA)).toBe(false);
  });

  it('5-6. conversion : attribution proposée puis confirmée par Ocall ; conflit tranché', async () => {
    const a1 = (
      await owner.agent
        .post(api('/platform/attributions'))
        .send({
          organizationId: clientA.organizationId,
          partnerId: p1.partnerId,
          prospectId: prospectA,
        })
        .expect(201)
    ).body;
    const a2 = (
      await owner.agent
        .post(api('/platform/attributions'))
        .send({ organizationId: clientA.organizationId, partnerId: p2.partnerId })
        .expect(201)
    ).body;
    // Aucune commission tant que rien n'est confirmé (et sans règle validée).
    const confirmed = (
      await owner.agent.post(api(`/platform/attributions/${a1.id}/confirm`)).expect(200)
    ).body;
    expect(confirmed.conflictsRejected).toBe(1);
    expect((await prisma.attribution.findUniqueOrThrow({ where: { id: a2.id } })).status).toBe(
      'REJECTED',
    );
    expect((await prisma.prospect.findUniqueOrThrow({ where: { id: prospectA } })).status).toBe(
      'WON',
    );
    await owner.agent.post(api(`/platform/attributions/${a1.id}/confirm`)).expect(409);
    const a3 = (
      await owner.agent
        .post(api('/platform/attributions'))
        .send({ organizationId: clientA.organizationId, partnerId: p2.partnerId })
        .expect(201)
    ).body;
    expect(
      (await owner.agent.post(api(`/platform/attributions/${a3.id}/confirm`)).expect(409)).body
        .code,
    ).toBe('ORGANIZATION_ALREADY_ATTRIBUTED');
    const clients = (await p1.agent.get(api('/partner/clients')).expect(200)).body;
    expect(clients).toHaveLength(1);
    expect(Object.keys(clients[0]).sort()).toEqual([
      'attributedAt',
      'collected',
      'name',
      'products',
    ]);
  });

  it('règle de commission : créée inactive, validée par le propriétaire seulement', async () => {
    const before = await invoice(clientA.organizationId, [{ kind: 'MONTHLY', months: 1 }]);
    const noRule = await paid(clientA.organizationId, before);
    expect(await commissionsOf(noRule)).toHaveLength(0); // aucune règle active
    const rule = (
      await owner.agent
        .post(api('/platform/commission-rules'))
        .send({
          name: `Standard ${RUN}`,
          setupRateBps: 1500,
          monthlyRateBps: 1000,
          monthlyWindowMonths: 12,
        })
        .expect(201)
    ).body;
    ruleId = rule.id;
    expect(rule.isActive).toBe(false);
    const admin = await internalAccount(app, prisma, 's12badmin', 'PLATFORM_ADMIN');
    expect(
      (await admin.agent.post(api(`/platform/commission-rules/${ruleId}/activate`)).expect(403))
        .body.code,
    ).toBe('OWNER_ONLY');
    await owner.agent.post(api(`/platform/commission-rules/${ruleId}/activate`)).expect(200);
  });

  it('7-10. commissions : mise en service 15 %, mensualités 10 % dans les 12 mois, jamais sur impayé', async () => {
    // Mise en service + 1 mois : 250 000 + 15 000.
    const inv = await invoice(clientA.organizationId, [
      { kind: 'SETUP' },
      { kind: 'MONTHLY', months: 1 },
    ]);
    expect(inv.total).toBe(265_000);
    // 14. Déclaration non confirmée : aucune commission.
    const declared = (
      await billing.agent
        .post(api('/platform/subscription-payments'))
        .send({
          organizationId: clientA.organizationId,
          invoiceId: inv.id,
          amount: inv.total,
          currency: 'XOF',
          method: 'MANUAL_TRANSFER',
          reference: `VIR-${RUN}-D`,
          paidAt: today(),
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
        })
        .expect(201)
    ).body;
    expect(await commissionsOf(declared.id)).toHaveLength(0);
    await billing2.agent
      .post(api(`/platform/subscription-payments/${declared.id}/confirm`))
      .expect(200);
    const c = await commissionsOf(declared.id);
    expect(c.map((x) => [x.kind, x.baseAmount, x.rateBps, x.amount, x.status])).toEqual([
      ['SETUP', 250_000, 1500, 37_500, 'ACCRUED'],
      ['MONTHLY', 15_000, 1000, 1_500, 'ACCRUED'],
    ]);
    // Nouvelle confirmation impossible ; aucune commission en double.
    await billing2.agent
      .post(api(`/platform/subscription-payments/${declared.id}/confirm`))
      .expect(409);
    expect(await commissionsOf(declared.id)).toHaveLength(2);

    // Mensualités suivantes : 10 % de 30 000.
    const inv2 = await invoice(clientA.organizationId, [{ kind: 'MONTHLY', months: 2 }]);
    expect(
      (await commissionsOf(await paid(clientA.organizationId, inv2))).map((x) => x.amount),
    ).toEqual([3_000]);

    // Hors fenêtre (première activation il y a 13 mois) : plus de commission sur les mensualités.
    const sub = await subscriptionOf(clientA.organizationId);
    const original = sub.startedAt;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { startedAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const inv3 = await invoice(clientA.organizationId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(await commissionsOf(await paid(clientA.organizationId, inv3))).toHaveLength(0);
    await prisma.subscription.update({ where: { id: sub.id }, data: { startedAt: original } });

    const portal = (await p1.agent.get(api('/partner/commissions')).expect(200)).body;
    expect(portal.reduce((t: number, x: { amount: number }) => t + x.amount, 0)).toBe(42_000);
    expect((await p2.agent.get(api('/partner/commissions')).expect(200)).body).toHaveLength(0);
  });

  it('15. validation puis versement manuel confirmé par une autre personne ; régularisation après remboursement', async () => {
    const accrued = await prisma.commission.findMany({
      where: { partnerId: p1.partnerId, status: 'ACCRUED' },
    });
    await support.agent
      .post(api('/platform/commissions/validate'))
      .send({ ids: accrued.map((c) => c.id) })
      .expect(403);
    const v = (
      await billing.agent
        .post(api('/platform/commissions/validate'))
        .send({ ids: accrued.map((c) => c.id) })
        .expect(200)
    ).body;
    expect(v.validated).toBe(accrued.length);
    const payout = (
      await billing.agent
        .post(api('/platform/commission-payouts'))
        .send({
          partnerId: p1.partnerId,
          commissionIds: accrued.map((c) => c.id),
          method: 'Virement',
          reference: `VER-${RUN}`,
          paidAt: today(),
        })
        .expect(201)
    ).body;
    expect(payout.total).toBe(42_000);
    expect(payout.number).toMatch(/^VER-\d{4}-\d{5}$/);
    await billing.agent.post(api(`/platform/commission-payouts/${payout.id}/confirm`)).expect(403);
    await billing2.agent.post(api(`/platform/commission-payouts/${payout.id}/confirm`)).expect(200);
    const paidRows = await prisma.commission.findMany({ where: { payoutId: payout.id } });
    expect(paidRows.every((c) => c.status === 'PAID')).toBe(true);
    // Aucun versement automatique : une commission ne devient versée que par cette action.
    const portalPayouts = (await p1.agent.get(api('/partner/payouts')).expect(200)).body;
    expect(portalPayouts).toHaveLength(1);

    // Remboursement d'un règlement dont la commission est versée : régularisation négative.
    const setupCommission = paidRows.find((c) => c.kind === 'SETUP')!;
    await billing.agent
      .post(api(`/platform/subscription-payments/${setupCommission.subscriptionPaymentId}/refund`))
      .send({ reason: 'Remboursement client' })
      .expect(200);
    const adjustment = await prisma.commission.findFirstOrThrow({
      where: { subscriptionPaymentId: setupCommission.subscriptionPaymentId, kind: 'ADJUSTMENT' },
    });
    expect(adjustment.amount).toBe(-39_000); // 37 500 + 1 500 déjà versés
  });

  it('remboursement d’une commission non versée : annulée', async () => {
    const inv = await invoice(clientA.organizationId, [{ kind: 'MONTHLY', months: 1 }]);
    const paymentId = await paid(clientA.organizationId, inv);
    expect((await commissionsOf(paymentId)).map((c) => c.status)).toEqual(['ACCRUED']);
    await billing.agent
      .post(api(`/platform/subscription-payments/${paymentId}/refund`))
      .send({ reason: 'Litige client' })
      .expect(200);
    expect((await commissionsOf(paymentId)).map((c) => c.status)).toEqual(['REVERSED']);
  });

  it('espèces : désactivé par défaut, client attribué, plafond, jamais confirmé par le partenaire', async () => {
    const invB = await invoice(clientB.organizationId, [{ kind: 'MONTHLY', months: 2 }]);
    const declare = (amount: number, receipt: string) =>
      p2.agent.post(api('/partner/cash/collections')).send({
        organizationId: clientB.organizationId,
        invoiceId: invB.id,
        amount,
        currency: 'XOF',
        method: 'CASH',
        receiptReference: receipt,
        paidAt: today(),
        periodStart: '2026-11-01',
        periodEnd: '2026-12-31',
      });
    expect((await declare(1000, `R-${RUN}-0`).expect(403)).body.code).toBe(
      'PARTNER_CASH_NOT_ALLOWED',
    );
    await owner.agent
      .patch(api(`/platform/partners/${p2.partnerId}`))
      .send({ cashCollectionEnabled: true, cashCollectionLimit: 20_000 })
      .expect(200);
    expect((await declare(1000, `R-${RUN}-0`).expect(403)).body.code).toBe('CLIENT_NOT_ATTRIBUTED');
    const att = (
      await owner.agent
        .post(api('/platform/attributions'))
        .send({ organizationId: clientB.organizationId, partnerId: p2.partnerId })
        .expect(201)
    ).body;
    await owner.agent.post(api(`/platform/attributions/${att.id}/confirm`)).expect(200);
    const collection = (await declare(15_000, `R-${RUN}-1`).expect(201)).body;
    expect(collection).toMatchObject({ status: 'DECLARED', amount: 15_000 });
    expect(collection.receiptNumber).toMatch(/^REC-/);
    expect((await declare(10_000, `R-${RUN}-2`).expect(409)).body.code).toBe(
      'PARTNER_CASH_LIMIT_EXCEEDED',
    );
    // Le partenaire ne confirme jamais : route plateforme refusée.
    await p2.agent
      .post(api(`/platform/subscription-payments/${collection.id}/confirm`))
      .expect(403);
    const confirmed = (
      await billing.agent
        .post(api(`/platform/subscription-payments/${collection.id}/confirm`))
        .expect(200)
    ).body;
    expect(confirmed.payment.status).toBe('CONFIRMED');
    const commissions = await commissionsOf(collection.id);
    expect(commissions.map((c) => [c.kind, c.amount])).toEqual([['MONTHLY', 1_500]]);
    const rows = (
      await billing.agent.get(api('/platform/cash-remittances/reconciliation')).expect(200)
    ).body;
    const line = rows.find(
      (r: { collectorId: string }) => r.collectorId === `partner:${p2.partnerId}`,
    );
    expect(line).toMatchObject({ confirmed: 15_000, remittedConfirmed: 15_000, toRemit: 0 });
    const mine = (await p2.agent.get(api('/partner/cash/collections')).expect(200)).body;
    expect(mine).toHaveLength(1);
  });

  it('parrainage : une demande publique avec le code est rattachée au partenaire', async () => {
    await clientA.agent
      .post(api('/public/suite/demo-requests'))
      .send({
        name: 'Prospect parrainé',
        company: `Hôtel ${RUN}`,
        country: 'Mali',
        phone: '+223 65 00 00 00',
        email: email('s12bref'),
        message: 'Je viens de la part de mon partenaire Ocall.',
        consent: true,
        ref: p2.code,
        startedAt: Date.now() - 10_000,
      })
      .expect(201);
    const demo = await prisma.demoRequest.findFirstOrThrow({ where: { email: email('s12bref') } });
    expect(demo.partnerId).toBe(p2.partnerId);
  });

  it('11. suspension : sessions fermées, connexion refusée, plus de nouvelle commission', async () => {
    await owner.agent
      .post(api(`/platform/partners/${p1.partnerId}/suspend`))
      .send({ reason: 'Contrat suspendu' })
      .expect(200);
    await p1.agent.get(api('/partner/dashboard')).expect(401);
    const relog = await login(app, p1.email, PASSWORD);
    expect(relog.status).toBe(403);
    expect(relog.body.code).toBe('PARTNER_SUSPENDED');
    const inv = await invoice(clientA.organizationId, [{ kind: 'MONTHLY', months: 1 }]);
    expect(await commissionsOf(await paid(clientA.organizationId, inv))).toHaveLength(0);
    const report = (await owner.agent.get(api('/platform/partner-reports')).expect(200)).body;
    const r1 = report.find((r: { id: string }) => r.id === p1.partnerId);
    expect(r1).toMatchObject({ status: 'SUSPENDED', clients: 1 });
    expect(r1.commissions.paid).toBe(39_000 + 3_000);
    expect(ruleId).toBeTruthy();
  });
});
