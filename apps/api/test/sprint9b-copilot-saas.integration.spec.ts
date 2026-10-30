import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
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
 * Sprint 9B — copilote enrichi par les analyses du Sprint 9 (fournisseur IA SIMULÉ, aucun appel
 * réel) et statistiques SaaS du Super Admin avec registre des règlements validés manuellement.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 9B — copilote enrichi et statistiques SaaS (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let resto: SignedUpOwner;
  let other: SignedUpOwner;
  let estR: string;
  let supervisor: Agent;
  let superAdmin: Agent;

  const api = (path: string) => `/api/v1${path}`;
  const sim = (value: unknown) => `OCALL-SIM:${JSON.stringify(value)}:FIN`;
  const ask = (a: Agent, establishmentId: string, question: string) =>
    a.post(api('/ai/copilot/ask')).send({ establishmentId, question });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    resto = await signup(app, 's9br', 'RESTAURANT');
    other = await signup(app, 's9bo', 'RESTAURANT');
    estR = (await resto.agent.get(api('/establishments')).expect(200)).body[0].id;

    const created = await resto.agent
      .post(api('/employees'))
      .send({
        firstName: 'Awa',
        lastName: 'Superviseur',
        role: 'SUPERVISOR',
        establishmentIds: [estR],
      })
      .expect(201);
    const s = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await s.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    supervisor = s.agent;

    // Une vente encaissée de 2 poulets braisés, datée à 12 h 30 (Bamako) aujourd'hui.
    const category = (
      await resto.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    const product = (
      await resto.agent
        .post(api('/catalog/products'))
        .send({
          name: 'Poulet braisé',
          categoryId: category,
          variants: [{ name: 'Standard', prices: [{ establishmentId: estR, price: 4000 }] }],
        })
        .expect(201)
    ).body;
    await resto.agent
      .post(api('/cash-sessions'))
      .send({ establishmentId: estR, openingFloat: 0 })
      .expect(201);
    const sale = (
      await resto.agent
        .post(api('/sales'))
        .send({
          establishmentId: estR,
          lines: [{ variantId: product.variants[0].id, quantity: 2 }],
        })
        .expect(201)
    ).body;
    await resto.agent
      .post(api(`/sales/${sale.id}/payments`))
      .send({ method: 'CASH', amountTendered: 8000 })
      .expect(200);
    const noon = new Date();
    noon.setUTCHours(12, 30, 0, 0);
    await prisma.payment.updateMany({ where: { saleId: sale.id }, data: { createdAt: noon } });
    await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: noon } });

    const adminEmail = email('s9badmin');
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

  describe('24. copilote : analyses du Sprint 9, lecture seule', () => {
    it('« combien de poulets braisés entre 12 h et 14 h » : produit retrouvé, chiffres serveur', async () => {
      const res = await ask(
        resto.agent,
        estR,
        'Combien de poulets braisés ont été vendus entre 12 h et 14 h aujourd’hui ?',
      ).expect(200);
      expect(res.body.results[0]).toMatchObject({
        tool: 'product_hourly_sales',
        data: { product: 'Poulet braisé', quantity: 2, amountXof: 8000 },
      });
    });

    it('aucune écriture : fonction inconnue, établissement imposé, SQL refusés ; données inchangées', async () => {
      const before = await prisma.sale.count({ where: { organizationId: resto.organizationId } });
      const res = await ask(
        resto.agent,
        estR,
        sim({
          calls: [
            { name: 'update_price', arguments: { productId: 'x', price: 1 } },
            {
              name: 'product_hourly_sales',
              arguments: {
                period: 'today',
                product: '',
                hour_from: 0,
                hour_to: 24,
                establishmentId: 'autre',
              },
            },
            {
              name: 'top_products_revenue',
              arguments: { period: 'today', limit: 5, sql: 'DROP TABLE "Sale"' },
            },
          ],
          answer: 'Fait.',
        }),
      ).expect(200);
      expect(res.body.rejected.map((r: { reason: string }) => r.reason)).toEqual([
        'UNKNOWN_FUNCTION',
        'INVALID_ARGUMENTS',
        'INVALID_ARGUMENTS',
      ]);
      expect(res.body.results).toHaveLength(0);
      expect(await prisma.sale.count({ where: { organizationId: resto.organizationId } })).toBe(
        before,
      );
    });

    it('statistique inventée écartée : seuls les chiffres serveur font foi', async () => {
      const res = await ask(
        resto.agent,
        estR,
        sim({
          calls: [{ name: 'top_products_revenue', arguments: { period: 'today', limit: 3 } }],
          answer: 'Vous avez vendu 999 poulets.',
        }),
      ).expect(200);
      expect(res.body.grounded).toBe(false);
      expect(res.body.answer).not.toContain('999');
      expect(res.body.results[0].data.products[0]).toMatchObject({
        name: 'Poulet braisé',
        amountXof: 8000,
      });
    });

    it('marges : réservées au propriétaire / administrateur, présentées comme estimées', async () => {
      const owner = await ask(
        resto.agent,
        estR,
        'Quelle catégorie est la plus rentable aujourd’hui ?',
      ).expect(200);
      expect(owner.body.results[0].tool).toBe('category_margins');
      expect(owner.body.results[0].data.note).toContain('estimée');
      expect(owner.body.results[0].missing.join(' ')).toContain('incomplète'); // aucune recette
      const sup = await ask(
        supervisor,
        estR,
        sim({ calls: [{ name: 'category_margins', arguments: { period: 'today' } }] }),
      ).expect(200);
      expect(sup.body.rejected).toEqual([{ name: 'category_margins', reason: 'NOT_ALLOWED' }]);
    });

    it('autre organisation : établissement introuvable', async () => {
      await ask(other.agent, estR, 'Quel produit a généré le plus de revenus aujourd’hui ?').expect(
        404,
      );
    });
  });

  describe('25. statistiques SaaS : règlements hors plateforme validés manuellement', () => {
    it('saisie → validation sans / avec prolongation → rejet ; seuls les validés sont des encaissements', async () => {
      const before = (await superAdmin.get(api('/platform/saas-stats')).expect(200)).body;
      const record = (body: Record<string, unknown>) =>
        superAdmin.post(api('/platform/subscription-payments')).send({
          organizationId: resto.organizationId,
          method: 'BANK_TRANSFER',
          paidAt: new Date().toISOString().slice(0, 10),
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
          ...body,
        });

      const p1 = (await record({ amount: 25000, reference: 'VIR-S9B-1' }).expect(201)).body;
      expect(p1).toMatchObject({ status: 'PENDING', amount: 25000 });
      expect((await record({ amount: 25000, reference: 'vir-s9b-1' }).expect(409)).body.code).toBe(
        'PAYMENT_DUPLICATE',
      );
      await record({ amount: 0 }).expect(400);

      const mid = (await superAdmin.get(api('/platform/saas-stats')).expect(200)).body;
      expect(mid.payments.validatedTotal).toBe(before.payments.validatedTotal); // à vérifier ≠ encaissé
      expect(mid.payments.pending.count).toBe(before.payments.pending.count + 1);

      // Validation sans prolongation : abonnement inchangé.
      const subBefore = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: resto.organizationId },
      });
      const v1 = (
        await superAdmin
          .post(api(`/platform/subscription-payments/${p1.id}/validate`))
          .send({ extendSubscription: false })
          .expect(201)
      ).body;
      expect(v1.subscription).toBeNull();
      const subMid = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: resto.organizationId },
      });
      expect(subMid.status).toBe(subBefore.status);
      await superAdmin
        .post(api(`/platform/subscription-payments/${p1.id}/validate`))
        .send({ extendSubscription: true })
        .expect(409);

      // Validation avec prolongation explicite : actif jusqu'au 30/11 inclus.
      const p2 = (await record({ amount: 25000, reference: 'VIR-S9B-2' }).expect(201)).body;
      const v2 = (
        await superAdmin
          .post(api(`/platform/subscription-payments/${p2.id}/validate`))
          .send({ extendSubscription: true })
          .expect(201)
      ).body;
      expect(v2.subscription).toMatchObject({ status: 'ACTIVE', changed: true });
      const subAfter = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId: resto.organizationId },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      expect(subAfter.status).toBe('ACTIVE');
      expect(subAfter.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      expect(subAfter.events[0]).toMatchObject({ type: 'STATUS_CHANGED', toStatus: 'ACTIVE' });

      // Rejet motivé.
      const p3 = (
        await record({ amount: 10000, method: 'CHECK', reference: 'CHQ-S9B' }).expect(201)
      ).body;
      await superAdmin
        .post(api(`/platform/subscription-payments/${p3.id}/reject`))
        .send({ reason: 'Chèque refusé' })
        .expect(201);

      const after = (await superAdmin.get(api('/platform/saas-stats')).expect(200)).body;
      expect(after.payments.validatedTotal).toBe(before.payments.validatedTotal + 50000);
      expect(after.payments.rejectedCount).toBe(before.payments.rejectedCount + 1);
      const list = (
        await superAdmin
          .get(api('/platform/subscription-payments'))
          .query({ organizationId: resto.organizationId })
          .expect(200)
      ).body;
      expect(list.map((p: { status: string }) => p.status).sort()).toEqual([
        'REJECTED',
        'VALIDATED',
        'VALIDATED',
      ]);
      const audits = await prisma.auditLog.count({
        where: {
          action: { startsWith: 'platform.subscription_payment' },
          targetId: { in: [p1.id, p2.id, p3.id] },
        },
      });
      expect(audits).toBe(6);
    });

    it('réservé au Super Admin ; jamais mélangé aux recettes des établissements', async () => {
      await resto.agent.get(api('/platform/saas-stats')).expect(403);
      await resto.agent.post(api('/platform/subscription-payments')).send({}).expect(403);
      // Les règlements SaaS n'entrent pas dans le CA de l'établissement.
      const overview = (
        await resto.agent.get(api('/analytics/overview')).query({ period: 'today' }).expect(200)
      ).body;
      expect(overview.revenue.current).toBe(8000);
    });
  });
});
