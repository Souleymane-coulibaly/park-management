import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Sprint 2 — caisse POS : catalogue, sessions de caisse, ventes, paiements en espèces,
 * permissions, isolation multi-tenant et indépendance paiement / préparation.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 2 — caisse POS (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoA: SignedUpOwner;
  let restoC: SignedUpOwner;
  let parkB: SignedUpOwner;
  let estA: string;
  let estC: string;
  let categoryA: string;
  let petit: string; // 500 FCFA
  let grand: string; // 1000 FCFA
  let variantC: string;
  let ownerSessionId: string;

  async function employee(
    owner: SignedUpOwner,
    role: string,
    establishmentIds: string[],
  ): Promise<Agent> {
    const created = await owner.agent
      .post('/api/v1/employees')
      .send({ firstName: 'Moussa', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function createProduct(
    owner: SignedUpOwner,
    categoryId: string,
    name: string,
    variants: { name: string; price: number }[],
    establishmentId: string,
  ) {
    const res = await owner.agent
      .post('/api/v1/catalog/products')
      .send({
        name,
        categoryId,
        variants: variants.map((v) => ({
          name: v.name,
          prices: [{ establishmentId, price: v.price }],
        })),
      })
      .expect(201);
    return res.body as { id: string; variants: { id: string; name: string }[] };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    restoA = await signup(app, 'posa', 'RESTAURANT');
    restoC = await signup(app, 'posc', 'RESTAURANT');
    parkB = await signup(app, 'posb', 'PARK');
    estA = (await restoA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    estC = (await restoC.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    categoryA = (
      await restoA.agent.post('/api/v1/catalog/categories').send({ name: 'Boissons' }).expect(201)
    ).body.id;
    const juice = await createProduct(
      restoA,
      categoryA,
      'Jus de bissap',
      [
        { name: 'Petit', price: 500 },
        { name: 'Grand', price: 1000 },
      ],
      estA,
    );
    petit = juice.variants.find((v) => v.name === 'Petit')!.id;
    grand = juice.variants.find((v) => v.name === 'Grand')!.id;
    const categoryC = (
      await restoC.agent.post('/api/v1/catalog/categories').send({ name: 'Plats' }).expect(201)
    ).body.id;
    variantC = (
      await createProduct(
        restoC,
        categoryC,
        'Tô sauce gombo',
        [{ name: 'Standard', price: 1500 }],
        estC,
      )
    ).variants[0]!.id;
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe('catalogue', () => {
    it('liste les produits avec variantes et tarifs par établissement', async () => {
      const products = (await restoA.agent.get('/api/v1/catalog/products').expect(200)).body;
      const juice = products.find((p: { name: string }) => p.name === 'Jus de bissap');
      expect(juice.variants).toHaveLength(2);
      expect(juice.variants[0].prices[0]).toMatchObject({
        establishmentId: estA,
        price: 500,
        isAvailable: true,
      });
    });

    it("refuse un tarif dans un établissement d'une autre organisation", async () => {
      const res = await restoA.agent.post('/api/v1/catalog/products').send({
        name: 'Intrus',
        categoryId: categoryA,
        variants: [{ name: 'Standard', prices: [{ establishmentId: estC, price: 100 }] }],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ESTABLISHMENT');
    });

    it("refuse une catégorie d'une autre organisation", async () => {
      const categoryC = (await restoC.agent.get('/api/v1/catalog/categories').expect(200)).body[0]
        .id;
      const res = await restoA.agent.post('/api/v1/catalog/products').send({
        name: 'Intrus 2',
        categoryId: categoryC,
        variants: [{ name: 'Standard', prices: [] }],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('une organisation PARK n’a pas accès au catalogue restaurant ni à la caisse d’une autre organisation', async () => {
      const catalog = await parkB.agent.get('/api/v1/catalog/categories');
      expect(catalog.status).toBe(403);
      expect(catalog.body.code).toBe('MODULE_NOT_IN_PLAN');
      const restaurantSale = await parkB.agent
        .post('/api/v1/sales')
        .send({ establishmentId: estA, lines: [{ variantId: petit, quantity: 1 }] });
      expect(restaurantSale.status).toBe(403);
      // Sprint 4 : la billetterie utilise les sessions de caisse ; l'établissement d'une autre organisation reste introuvable.
      const session = await parkB.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estA, openingFloat: 0 });
      expect(session.status).toBe(404);
      expect(session.body.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });
  });

  describe('montants calculés par le serveur', () => {
    it('calcule le devis à partir des tarifs de l’établissement', async () => {
      const res = await restoA.agent
        .post('/api/v1/pos/quote')
        .send({
          establishmentId: estA,
          lines: [
            { variantId: grand, quantity: 2 },
            { variantId: petit, quantity: 1 },
          ],
        })
        .expect(200);
      expect(res.body.total).toBe(2500);
      expect(res.body.lines.map((l: { lineTotal: number }) => l.lineTotal)).toEqual([2000, 500]);
    });

    it('refuse un prix envoyé par le client', async () => {
      const res = await restoA.agent
        .post('/api/v1/pos/quote')
        .send({ establishmentId: estA, lines: [{ variantId: grand, quantity: 1, unitPrice: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('refuse une ligne en double et un article d’une autre organisation', async () => {
      const dup = await restoA.agent.post('/api/v1/pos/quote').send({
        establishmentId: estA,
        lines: [
          { variantId: grand, quantity: 1 },
          { variantId: grand, quantity: 1 },
        ],
      });
      expect(dup.body.code).toBe('DUPLICATE_LINE');
      const foreign = await restoA.agent
        .post('/api/v1/pos/quote')
        .send({ establishmentId: estA, lines: [{ variantId: variantC, quantity: 1 }] });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('le catalogue de caisse ne propose que les articles vendables de l’établissement', async () => {
      const catalog = (
        await restoA.agent.get(`/api/v1/pos/catalog?establishmentId=${estA}`).expect(200)
      ).body;
      const variants = catalog.flatMap(
        (c: { products: { variants: { id: string; price: number }[] }[] }) =>
          c.products.flatMap((p) => p.variants),
      );
      expect(variants).toEqual(expect.arrayContaining([{ id: grand, name: 'Grand', price: 1000 }]));
      expect(variants.some((v: { id: string }) => v.id === variantC)).toBe(false);
    });
  });

  describe('session de caisse, vente et paiement en espèces', () => {
    let saleId: string;
    const saleKey = randomUUID();

    it('refuse une vente sans session de caisse ouverte', async () => {
      const res = await restoA.agent
        .post('/api/v1/sales')
        .send({ establishmentId: estA, lines: [{ variantId: grand, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CASH_SESSION_REQUIRED');
    });

    it('ouvre une session avec fond de caisse, et une seule à la fois', async () => {
      const res = await restoA.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estA, openingFloat: 10_000 })
        .expect(201);
      ownerSessionId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'OPEN',
        openingFloat: 10_000,
        expectedCash: 10_000,
      });
      const again = await restoA.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estA, openingFloat: 0 });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CASH_SESSION_ALREADY_OPEN');
    });

    it('crée une vente non payée, non envoyée en cuisine, et rejouable sans doublon', async () => {
      const body = {
        establishmentId: estA,
        clientRequestId: saleKey,
        lines: [
          { variantId: grand, quantity: 2 },
          { variantId: petit, quantity: 1 },
        ],
      };
      const res = await restoA.agent.post('/api/v1/sales').send(body).expect(201);
      saleId = res.body.id;
      expect(res.body).toMatchObject({
        number: 1,
        total: 2500,
        paymentStatus: 'UNPAID',
        preparationStatus: 'NOT_SENT',
        status: 'OPEN',
      });
      const replay = await restoA.agent.post('/api/v1/sales').send(body).expect(201);
      expect(replay.body.id).toBe(saleId);
      expect(await prisma.sale.count({ where: { clientRequestId: saleKey } })).toBe(1);
    });

    it('refuse Wave : moyen annoncé comme non activé, sans simulation', async () => {
      const methods = (await restoA.agent.get('/api/v1/payments/methods').expect(200)).body;
      expect(methods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'CASH', available: true }),
          expect.objectContaining({ method: 'WAVE', available: false }),
        ]),
      );
      const res = await restoA.agent
        .post(`/api/v1/sales/${saleId}/payments`)
        .send({ method: 'WAVE' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    });

    it('refuse un montant remis insuffisant', async () => {
      const res = await restoA.agent
        .post(`/api/v1/sales/${saleId}/payments`)
        .send({ method: 'CASH', amountTendered: 2000 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INSUFFICIENT_CASH');
    });

    it('encaisse en espèces : monnaie calculée par le serveur, et la préparation n’est PAS déclenchée', async () => {
      const key = randomUUID();
      const res = await restoA.agent
        .post(`/api/v1/sales/${saleId}/payments`)
        .send({ method: 'CASH', amountTendered: 5000, clientRequestId: key })
        .expect(200);
      expect(res.body.payment).toMatchObject({
        method: 'CASH',
        status: 'SUCCEEDED',
        amount: 2500,
        amountTendered: 5000,
        changeGiven: 2500,
      });
      expect(res.body.sale.paymentStatus).toBe('PAID');
      // Règle métier : un paiement ne déclenche jamais la préparation en cuisine.
      expect(res.body.sale.preparationStatus).toBe('NOT_SENT');
      const stored = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
      expect(stored.preparationStatus).toBe('NOT_SENT');

      const replay = await restoA.agent
        .post(`/api/v1/sales/${saleId}/payments`)
        .send({ method: 'CASH', amountTendered: 5000, clientRequestId: key })
        .expect(200);
      expect(replay.body.payment.id).toBe(res.body.payment.id);
      const again = await restoA.agent
        .post(`/api/v1/sales/${saleId}/payments`)
        .send({ method: 'CASH', amountTendered: 5000 });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('SALE_ALREADY_PAID');
      expect(await prisma.payment.count({ where: { saleId } })).toBe(1);
    });

    it('deux encaissements simultanés : un seul paiement est enregistré', async () => {
      const sale = (
        await restoA.agent
          .post('/api/v1/sales')
          .send({ establishmentId: estA, lines: [{ variantId: grand, quantity: 1 }] })
          .expect(201)
      ).body;
      const [a, b] = await Promise.all([
        restoA.agent
          .post(`/api/v1/sales/${sale.id}/payments`)
          .send({ method: 'CASH', amountTendered: 1000 }),
        restoA.agent
          .post(`/api/v1/sales/${sale.id}/payments`)
          .send({ method: 'CASH', amountTendered: 1000 }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await prisma.payment.count({ where: { saleId: sale.id } })).toBe(1);
    });

    it('le prix figé sur la vente ne change pas si le tarif évolue', async () => {
      const product = (await restoA.agent.get('/api/v1/catalog/products').expect(200)).body.find(
        (p: { name: string }) => p.name === 'Jus de bissap',
      );
      await restoA.agent
        .patch(`/api/v1/catalog/products/${product.id}`)
        .send({
          variants: product.variants.map((v: { id: string; name: string }) => ({
            id: v.id,
            name: v.name,
            prices: [{ establishmentId: estA, price: v.name === 'Grand' ? 1200 : 500 }],
          })),
        })
        .expect(200);
      const sale = (await restoA.agent.get(`/api/v1/sales/${saleId}`).expect(200)).body;
      expect(
        sale.lines.find((l: { variantName: string }) => l.variantName === 'Grand').unitPrice,
      ).toBe(1000);
      expect(sale.total).toBe(2500);
      const quote = await restoA.agent
        .post('/api/v1/pos/quote')
        .send({ establishmentId: estA, lines: [{ variantId: grand, quantity: 1 }] })
        .expect(200);
      expect(quote.body.total).toBe(1200);
    });
  });

  describe('annulation et permissions', () => {
    let cashier: Agent;

    beforeAll(async () => {
      cashier = await employee(restoA, 'CASHIER', [estA]);
    });

    it('un caissier ouvre sa caisse, vend, mais ne voit que ses propres ventes', async () => {
      await cashier
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estA, openingFloat: 5000 })
        .expect(201);
      const own = (
        await cashier
          .post('/api/v1/sales')
          .send({ establishmentId: estA, lines: [{ variantId: petit, quantity: 3 }] })
          .expect(201)
      ).body;
      expect(own.total).toBe(1500);
      const visible = (await cashier.get('/api/v1/sales').expect(200)).body;
      expect(visible.map((s: { id: string }) => s.id)).toEqual([own.id]);
      const ownerSales = (await restoA.agent.get('/api/v1/sales').expect(200)).body;
      expect(ownerSales.length).toBeGreaterThan(1);
      const ownerSale = ownerSales.find(
        (s: { cashier: { id: string } }) => s.cashier.id !== own.cashier.id,
      );
      await cashier.get(`/api/v1/sales/${ownerSale.id}`).expect(404);
    });

    it('un caissier ne gère pas le catalogue et ne peut pas annuler une vente', async () => {
      await cashier.get('/api/v1/catalog/products').expect(200);
      await cashier.post('/api/v1/catalog/categories').send({ name: 'Pirate' }).expect(403);
      const sale = (await cashier.get('/api/v1/sales').expect(200)).body[0];
      await cashier.post(`/api/v1/sales/${sale.id}/cancel`).send({}).expect(403);
    });

    it('un caissier ne peut pas encaisser dans un établissement auquel il n’est pas affecté', async () => {
      const other = await restoA.agent
        .post('/api/v1/establishments')
        .send({ name: `Annexe ${Date.now()}`, businessType: 'RESTAURANT' })
        .expect(201);
      const res = await cashier
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: other.body.id, openingFloat: 0 });
      expect(res.status).toBe(404);
    });

    it('le personnel de cuisine ne peut pas encaisser', async () => {
      const kitchen = await employee(restoA, 'KITCHEN', [estA]);
      await kitchen.get('/api/v1/catalog/products').expect(200);
      await kitchen
        .post('/api/v1/sales')
        .send({ establishmentId: estA, lines: [{ variantId: petit, quantity: 1 }] })
        .expect(403);
    });

    it('le propriétaire annule une vente non payée, jamais une vente payée', async () => {
      const unpaid = (await cashier.get('/api/v1/sales?paymentStatus=UNPAID').expect(200)).body[0];
      const res = await restoA.agent
        .post(`/api/v1/sales/${unpaid.id}/cancel`)
        .send({ reason: 'Erreur de saisie' })
        .expect(200);
      expect(res.body.status).toBe('CANCELLED');
      await restoA.agent
        .post(`/api/v1/sales/${unpaid.id}/payments`)
        .send({ method: 'CASH', amountTendered: 5000 })
        .expect(409);
      const paid = (await restoA.agent.get('/api/v1/sales?paymentStatus=PAID').expect(200)).body[0];
      const refused = await restoA.agent.post(`/api/v1/sales/${paid.id}/cancel`).send({});
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('SALE_NOT_CANCELLABLE');
    });

    it('un caissier ne ferme pas la caisse d’un autre ; le propriétaire (superviseur) le peut', async () => {
      await cashier
        .post(`/api/v1/cash-sessions/${ownerSessionId}/close`)
        .send({ countedCash: 0 })
        .expect(404);
      const cashierSession = (
        await restoA.agent.get('/api/v1/cash-sessions?status=OPEN').expect(200)
      ).body.find((s: { id: string }) => s.id !== ownerSessionId);
      const closed = await restoA.agent
        .post(`/api/v1/cash-sessions/${cashierSession.id}/close`)
        .send({ countedCash: 5000 })
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', expectedCash: 5000, variance: 0 });
    });
  });

  describe('isolation multi-tenant', () => {
    it('une autre organisation ne voit, ne paie, ni ne ferme rien de A', async () => {
      const saleA = (await restoA.agent.get('/api/v1/sales').expect(200)).body[0];
      await restoC.agent.get(`/api/v1/sales/${saleA.id}`).expect(404);
      await restoC.agent
        .post(`/api/v1/sales/${saleA.id}/payments`)
        .send({ method: 'CASH', amountTendered: 99_999 })
        .expect(404);
      await restoC.agent.post(`/api/v1/sales/${saleA.id}/cancel`).send({}).expect(404);
      await restoC.agent
        .post(`/api/v1/cash-sessions/${ownerSessionId}/close`)
        .send({ countedCash: 0 })
        .expect(404);
      await restoC.agent
        .get(
          `/api/v1/catalog/products/${(await restoA.agent.get('/api/v1/catalog/products')).body[0].id}`,
        )
        .expect(404);
      expect((await restoC.agent.get('/api/v1/sales').expect(200)).body).toEqual([]);
    });

    it("C ne peut pas ouvrir de caisse ni vendre dans l'établissement de A", async () => {
      await restoC.agent
        .post('/api/v1/cash-sessions')
        .send({ establishmentId: estA, openingFloat: 0 })
        .expect(404);
      await restoC.agent
        .post('/api/v1/pos/quote')
        .send({ establishmentId: estA, lines: [{ variantId: grand, quantity: 1 }] })
        .expect(404);
    });
  });

  describe('fermeture de caisse et écart', () => {
    it('calcule les espèces attendues et l’écart, puis bloque les ventes', async () => {
      const current = (
        await restoA.agent.get(`/api/v1/cash-sessions/current?establishmentId=${estA}`).expect(200)
      ).body;
      // Fond 10 000 + vente 2 500 + vente 1 000 (une seule fois malgré la concurrence).
      expect(current).toMatchObject({
        id: ownerSessionId,
        expectedCash: 13_500,
        cashSalesTotal: 3500,
      });

      const closed = await restoA.agent
        .post(`/api/v1/cash-sessions/${ownerSessionId}/close`)
        .send({ countedCash: 13_000, note: 'Billet de 500 manquant' })
        .expect(200);
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        expectedCash: 13_500,
        countedCash: 13_000,
        variance: -500,
      });

      const again = await restoA.agent
        .post(`/api/v1/cash-sessions/${ownerSessionId}/close`)
        .send({ countedCash: 13_000 });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CASH_SESSION_CLOSED');
      const sale = await restoA.agent
        .post('/api/v1/sales')
        .send({ establishmentId: estA, lines: [{ variantId: petit, quantity: 1 }] });
      expect(sale.body.code).toBe('CASH_SESSION_REQUIRED');

      const audit = await prisma.auditLog.findFirst({
        where: { targetId: ownerSessionId, action: 'cash_session.closed' },
      });
      expect(audit?.metadata).toMatchObject({
        expectedCash: 13_500,
        countedCash: 13_000,
        variance: -500,
      });
    });

    it('le tableau de bord affiche le chiffre d’affaires encaissé réel (ventes annulées ou impayées exclues)', async () => {
      const dashboard = (await restoA.agent.get('/api/v1/dashboard').expect(200)).body;
      expect(dashboard.revenue.RESTAURANT).toEqual({
        today: 3500,
        last30Days: 3500,
        paidSalesLast30Days: 2,
      });
      expect(dashboard.revenue.PARK).toBeNull();
    });
  });
});
