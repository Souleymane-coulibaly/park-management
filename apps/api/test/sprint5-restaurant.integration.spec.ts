import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
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
import { type SseStream, openSse } from './sse-client';

/**
 * Sprint 5 — restaurant : commandes (sur place, à emporter, comptoir, QR), envoi explicite en cuisine,
 * écran cuisine temps réel (SSE), tables et QR codes, stocks et recettes, réservations, ticket cuisine,
 * tableau de bord, permissions et isolation. Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 5 — restaurant (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;
  let restoA: SignedUpOwner;
  let restoB: SignedUpOwner;
  let park: SignedUpOwner;
  let duo: SignedUpOwner;
  let estA1: string;
  let estA2: string;
  let estB: string;
  let estDuoPark: string;
  let cashier: Agent;
  let cashier2: Agent;
  let supervisor: Agent;
  let kitchen: Agent;
  let kitchenCookie: string;
  let kitchen2Cookie: string;
  let ownerCookie: string;
  let restoBCookie: string;
  let parkCookie: string;
  let poulet: string; // variante « Grand » à 4 000 FCFA
  let jus: string; // 1 000 FCFA
  let pouletProduct: string;
  let variantB: string;
  let terrace: string;
  let table4: string;
  let table4Token: string;
  let poolZoneToken: string;
  let tableA2: string;
  let kitchenPrinter: string;
  let chicken: string; // stock : poulet entier, en pièces
  let rice: string; // stock : riz, en kg

  const api = (path: string) => `/api/v1${path}`;

  async function employee(
    owner: SignedUpOwner,
    role: string,
    establishmentIds: string[],
  ): Promise<{ agent: Agent; loginId: string }> {
    const created = await owner.agent
      .post(api('/employees'))
      .send({ firstName: 'Kadiatou', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { agent: session.agent, loginId: created.body.employee.loginId };
  }

  /** Nouvelle session (cookie brut) pour ouvrir un flux SSE comme le ferait le navigateur. */
  async function sessionCookie(identifier: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(api('/auth/login'))
      .send({ identifier, password: PASSWORD })
      .expect(200);
    const raw = res.headers['set-cookie'] as unknown as string[];
    return raw.find((c) => c.startsWith('ocp_session='))!.split(';')[0]!;
  }

  async function product(
    owner: SignedUpOwner,
    categoryId: string,
    name: string,
    variants: { name: string; price: number }[],
    establishmentIds: string[],
  ) {
    const res = await owner.agent
      .post(api('/catalog/products'))
      .send({
        name,
        categoryId,
        variants: variants.map((v) => ({
          name: v.name,
          prices: establishmentIds.map((establishmentId) => ({ establishmentId, price: v.price })),
        })),
      })
      .expect(201);
    return res.body as { id: string; variants: { id: string; name: string }[] };
  }

  type Line = { variantId: string; quantity: number; notes?: string };

  const createOrder = (
    a: Agent,
    body: { channel: string; lines: Line[]; tableId?: string; zoneId?: string; notes?: string },
    establishmentId = estA1,
  ) => a.post(api('/orders')).send({ establishmentId, ...body });

  const pay = (a: Agent, saleId: string, amountTendered: number, clientRequestId?: string) =>
    a
      .post(api(`/sales/${saleId}/payments`))
      .send({ method: 'CASH', amountTendered, clientRequestId });

  const send = (a: Agent, id: string) => a.post(api(`/orders/${id}/send-to-kitchen`));

  const stream = (cookie: string, path: string) => openSse(port, api(path), cookie);

  const stockOf = async (id: string) =>
    (await restoA.agent.get(api(`/stock/items?establishmentId=${estA1}`)).expect(200)).body.find(
      (i: { id: string }) => i.id === id,
    ) as { quantity: number; low: boolean; alertThreshold: number | null };

  const inDays = (days: number, hourUtc: number, minute = 0) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hourUtc, minute, 0, 0);
    return d.toISOString();
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    restoA = await signup(app, 'rsa', 'RESTAURANT');
    restoB = await signup(app, 'rsb', 'RESTAURANT');
    park = await signup(app, 'rsp', 'PARK');
    duo = await signup(app, 'rsd', 'PARK_RESTAURANT');
    estA1 = (await restoA.agent.get(api('/establishments')).expect(200)).body[0].id;
    estA2 = (
      await restoA.agent
        .post(api('/establishments'))
        .send({ name: 'Annexe du port', businessType: 'RESTAURANT', city: 'Mopti' })
        .expect(201)
    ).body.id;
    estB = (await restoB.agent.get(api('/establishments')).expect(200)).body[0].id;
    estDuoPark = (
      await duo.agent
        .post(api('/establishments'))
        .send({ name: 'Parc seul', businessType: 'PARK', city: 'Kati' })
        .expect(201)
    ).body.id;

    const plats = (
      await restoA.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    const chickenProduct = await product(
      restoA,
      plats,
      'Poulet braisé',
      [
        { name: 'Demi', price: 2500 },
        { name: 'Grand', price: 4000 },
      ],
      [estA1, estA2],
    );
    pouletProduct = chickenProduct.id;
    poulet = chickenProduct.variants.find((v) => v.name === 'Grand')!.id;
    jus = (
      await product(restoA, plats, 'Jus de bissap', [{ name: 'Standard', price: 1000 }], [estA1])
    ).variants[0]!.id;
    const platsB = (
      await restoB.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    variantB = (await product(restoB, platsB, 'Tô', [{ name: 'Standard', price: 1500 }], [estB]))
      .variants[0]!.id;

    // Zones et tables : une terrasse avec la table 4, et une zone « bord de piscine » sans table.
    terrace = (
      await restoA.agent
        .post(api('/restaurant/zones'))
        .send({ establishmentId: estA1, name: 'Terrasse', kind: 'TERRACE' })
        .expect(201)
    ).body.id;
    await restoA.agent
      .post(api('/restaurant/zones'))
      .send({ establishmentId: estA1, name: 'Bord de piscine', kind: 'POOLSIDE' })
      .expect(201);
    table4 = (
      await restoA.agent
        .post(api('/restaurant/tables'))
        .send({ establishmentId: estA1, zoneId: terrace, name: 'Table 4', seats: 4 })
        .expect(201)
    ).body.id;
    tableA2 = (
      await restoA.agent
        .post(api('/restaurant/tables'))
        .send({ establishmentId: estA2, name: 'Table 1' })
        .expect(201)
    ).body.id;
    const dining = (
      await restoA.agent.get(api(`/restaurant/dining?establishmentId=${estA1}`)).expect(200)
    ).body;
    table4Token = dining.tables
      .find((t: { id: string }) => t.id === table4)
      .qrPath.split('/')
      .pop();
    poolZoneToken = dining.zones
      .find((z: { name: string }) => z.name === 'Bord de piscine')
      .qrPath.split('/')
      .pop();

    cashier = (await employee(restoA, 'CASHIER', [estA1])).agent;
    cashier2 = (await employee(restoA, 'CASHIER', [estA1])).agent;
    supervisor = (await employee(restoA, 'SUPERVISOR', [estA1])).agent;
    const kitchenEmployee = await employee(restoA, 'KITCHEN', [estA1]);
    kitchen = kitchenEmployee.agent;
    kitchenCookie = await sessionCookie(kitchenEmployee.loginId);
    kitchen2Cookie = await sessionCookie((await employee(restoA, 'KITCHEN', [estA2])).loginId);
    ownerCookie = await sessionCookie(restoA.loginId);
    restoBCookie = await sessionCookie(restoB.loginId);
    parkCookie = await sessionCookie(park.loginId);

    for (const a of [cashier, cashier2, supervisor, restoA.agent]) {
      await a
        .post(api('/cash-sessions'))
        .send({ establishmentId: estA1, openingFloat: 0 })
        .expect(201);
    }

    kitchenPrinter = (
      await restoA.agent
        .post(api('/pos-terminals'))
        .send({
          establishmentId: estA1,
          name: 'Cuisine',
          printerConnection: 'SIMULATED',
          paperWidth: 80,
          kitchenPrinter: true,
        })
        .expect(201)
    ).body.id;

    // Stocks et recette : un « Poulet braisé Grand » consomme 1 poulet et 0,25 kg de riz.
    chicken = (
      await restoA.agent
        .post(api('/stock/items'))
        .send({ establishmentId: estA1, name: 'Poulet entier', unit: 'UNIT', alertThreshold: 3 })
        .expect(201)
    ).body.id;
    rice = (
      await restoA.agent
        .post(api('/stock/items'))
        .send({ establishmentId: estA1, name: 'Riz', unit: 'KG', unitCost: 600 })
        .expect(201)
    ).body.id;
    await restoA.agent
      .post(api('/stock/movements'))
      .send({ stockItemId: chicken, kind: 'IN', quantity: 10, clientRequestId: randomUUID() })
      .expect(201);
    await restoA.agent
      .post(api('/stock/movements'))
      .send({ stockItemId: rice, kind: 'IN', quantity: 5, clientRequestId: randomUUID() })
      .expect(201);
    await restoA.agent
      .put(api(`/stock/recipes/${poulet}`))
      .send({
        establishmentId: estA1,
        components: [
          { stockItemId: chicken, quantity: 1 },
          { stockItemId: rice, quantity: 0.25 },
        ],
      })
      .expect(200);
  }, 300_000);

  afterAll(async () => {
    // L'application est toujours fermée, même si le nettoyage échoue (base injoignable) : sinon le
    // processus Jest resterait ouvert indéfiniment.
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('commandes', () => {
    it('1. commande sur place à une table : non payée, non envoyée, numérotée, historisée', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          tableId: table4,
          notes: 'Anniversaire',
          lines: [
            { variantId: poulet, quantity: 2, notes: 'Bien cuit' },
            { variantId: jus, quantity: 1 },
          ],
        }).expect(201)
      ).body;
      expect(order).toMatchObject({
        channel: 'DINE_IN',
        paymentStatus: 'UNPAID',
        preparationStatus: 'NOT_SENT',
        table: { id: table4, name: 'Table 4' },
        zone: { id: terrace, name: 'Terrasse' },
        notes: 'Anniversaire',
        total: 9000,
        activity: 'RESTAURANT',
      });
      expect(order.number).toBeGreaterThan(0);
      // Les lignes restent dans l'ordre de saisie (tickets de caisse, cuisine, billets).
      expect(order.lines.map((l: { productName: string }) => l.productName)).toEqual([
        'Poulet braisé',
        'Jus de bissap',
      ]);
      expect(
        order.lines.find((l: { notes: string | null }) => l.notes === 'Bien cuit'),
      ).toMatchObject({
        productName: 'Poulet braisé',
        variantName: 'Grand',
        quantity: 2,
        unitPrice: 4000,
      });
      const detail = (await cashier.get(api(`/orders/${order.id}`)).expect(200)).body;
      expect(detail.events.map((e: { type: string }) => e.type)).toEqual(['created']);
    });

    it('2. commande à emporter et 3. commande au comptoir', async () => {
      const takeaway = (
        await createOrder(cashier, {
          channel: 'TAKEAWAY',
          lines: [{ variantId: jus, quantity: 3 }],
        }).expect(201)
      ).body;
      expect(takeaway).toMatchObject({ channel: 'TAKEAWAY', table: null, total: 3000 });
      const counter = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      expect(counter).toMatchObject({ channel: 'COUNTER', preparationStatus: 'NOT_SENT' });
      expect(counter.number).toBeGreaterThan(takeaway.number);
      // Le canal QR est réservé aux demandes clients validées.
      await createOrder(cashier, {
        channel: 'QR',
        lines: [{ variantId: jus, quantity: 1 }],
      }).expect(400);
    });

    it('5. prix calculés par le serveur ; prix figés à la commande ; aucun prix client accepté', async () => {
      const forged = await cashier.post(api('/orders')).send({
        establishmentId: estA1,
        channel: 'COUNTER',
        lines: [{ variantId: poulet, quantity: 1, unitPrice: 1 }],
      });
      expect(forged.status).toBe(400);
      const totalField = await cashier.post(api('/orders')).send({
        establishmentId: estA1,
        channel: 'COUNTER',
        total: 1,
        lines: [{ variantId: jus, quantity: 1 }],
      });
      expect(totalField.status).toBe(400);

      const before = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: poulet, quantity: 1 }],
        }).expect(201)
      ).body;
      expect(before.total).toBe(4000);
      // Hausse de prix : la commande déjà enregistrée garde son prix.
      const productNow = (
        await restoA.agent.get(api(`/catalog/products/${pouletProduct}`)).expect(200)
      ).body;
      const variants = productNow.variants.map((v: { id: string; name: string }) => ({
        id: v.id,
        name: v.name,
        prices: [estA1, estA2].map((establishmentId) => ({
          establishmentId,
          price: v.name === 'Grand' ? 4500 : 2500,
        })),
      }));
      await restoA.agent
        .patch(api(`/catalog/products/${pouletProduct}`))
        .send({ variants })
        .expect(200);
      expect((await cashier.get(api(`/orders/${before.id}`)).expect(200)).body.total).toBe(4000);
      const after = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: poulet, quantity: 1 }],
        }).expect(201)
      ).body;
      expect(after.total).toBe(4500);
      await restoA.agent
        .patch(api(`/catalog/products/${pouletProduct}`))
        .send({
          variants: variants.map((v: { name: string; prices: { establishmentId: string }[] }) => ({
            ...v,
            prices: v.prices.map((p) => ({ ...p, price: v.name === 'Grand' ? 4000 : 2500 })),
          })),
        })
        .expect(200);
      // Même article sur deux lignes : autorisé seulement avec des instructions différentes.
      await createOrder(cashier, {
        channel: 'COUNTER',
        lines: [
          { variantId: jus, quantity: 1 },
          { variantId: jus, quantity: 1 },
        ],
      }).expect(400);
      await createOrder(cashier, {
        channel: 'COUNTER',
        lines: [
          { variantId: jus, quantity: 1 },
          { variantId: jus, quantity: 1, notes: 'Sans glaçons' },
        ],
      }).expect(201);
    });

    it('modification : recalculée avant envoi ; articles figés après envoi ; tout figé après paiement', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      const updated = (
        await cashier
          .patch(api(`/orders/${order.id}`))
          .send({ lines: [{ variantId: jus, quantity: 4 }], tableId: table4, notes: 'Vite' })
          .expect(200)
      ).body;
      expect(updated).toMatchObject({ total: 4000, notes: 'Vite', table: { id: table4 } });
      await send(cashier, order.id).expect(200);
      const locked = await cashier
        .patch(api(`/orders/${order.id}`))
        .send({ lines: [{ variantId: jus, quantity: 1 }] });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('ORDER_LOCKED_SENT');
      // La table peut encore changer (client déplacé) tant que la commande n'est pas payée.
      await cashier
        .patch(api(`/orders/${order.id}`))
        .send({ tableId: null })
        .expect(200);
      await pay(cashier, order.id, 4000).expect(200);
      const paid = await cashier.patch(api(`/orders/${order.id}`)).send({ tableId: table4 });
      expect(paid.status).toBe(409);
      expect(paid.body.code).toBe('ORDER_LOCKED_PAID');
      const history = (await cashier.get(api(`/orders/${order.id}`)).expect(200)).body.events.map(
        (e: { type: string }) => e.type,
      );
      expect(history).toEqual(['created', 'updated', 'sent_to_kitchen', 'updated', 'paid']);
    });
  });

  describe('paiement et cuisine', () => {
    let kds: SseStream;

    beforeAll(async () => {
      kds = await stream(kitchenCookie, `/kitchen/stream?establishmentId=${estA1}`);
      await kds.waitFor((m) => m.type === 'ready');
    });

    afterAll(() => kds?.close());

    it('6. le paiement n’envoie jamais une commande en cuisine', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 2 }],
        }).expect(201)
      ).body;
      const result = (await pay(cashier, order.id, 2000).expect(200)).body;
      expect(result.sale).toMatchObject({ paymentStatus: 'PAID', preparationStatus: 'NOT_SENT' });
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      expect(queue.map((o: { id: string }) => o.id)).not.toContain(order.id);
      // Aucun évènement cuisine pour cette commande.
      await new Promise((r) => setTimeout(r, 500));
      expect(kds.messages.some((m) => m.data.saleId === order.id)).toBe(false);
    });

    it('7. envoi explicite en cuisine : autorisé, idempotent, audité ; refusé à la cuisine', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          tableId: table4,
          lines: [{ variantId: jus, quantity: 1, notes: 'Sans sucre' }],
        }).expect(201)
      ).body;
      await kitchen.post(api(`/orders/${order.id}/send-to-kitchen`)).expect(403);
      // Deux envois simultanés (double appui, réseau qui rejoue) : une seule transition.
      const [a, b] = await Promise.all([send(cashier, order.id), send(cashier, order.id)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect([a.body.changed, b.body.changed].sort()).toEqual([false, true]);
      expect(a.body.order.preparationStatus).toBe('SENT');
      expect(a.body.order.paymentStatus).toBe('UNPAID');
      const again = (await send(cashier, order.id).expect(200)).body;
      expect(again.changed).toBe(false);
      const events = (await cashier.get(api(`/orders/${order.id}`)).expect(200)).body.events;
      expect(events.filter((e: { type: string }) => e.type === 'sent_to_kitchen')).toHaveLength(1);
      const audit = await prisma.auditLog.count({
        where: { action: 'order.sent_to_kitchen', targetId: order.id },
      });
      expect(audit).toBe(1);
    });

    it('8. réception sur l’écran cuisine : évènement temps réel puis données sans prix', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          tableId: table4,
          notes: 'Allergie arachide',
          lines: [{ variantId: poulet, quantity: 1, notes: 'Piment à part' }],
        }).expect(201)
      ).body;
      await send(cashier, order.id).expect(200);
      const event = await kds.waitFor((m) => m.type === 'order.sent' && m.data.saleId === order.id);
      expect(Object.keys(event.data).sort()).toEqual(['at', 'requestId', 'saleId', 'type']);
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      const received = queue.find((o: { id: string }) => o.id === order.id);
      expect(received).toMatchObject({
        number: order.number,
        preparationStatus: 'SENT',
        notes: 'Allergie arachide',
        table: { name: 'Table 4' },
        zone: { name: 'Terrasse' },
      });
      expect(received.sentToKitchenAt).toBeTruthy();
      expect(received.lines[0]).toEqual({
        id: expect.any(String),
        productName: 'Poulet braisé',
        variantName: 'Grand',
        quantity: 1,
        notes: 'Piment à part',
      });
      expect(JSON.stringify(received)).not.toMatch(/unitPrice|lineTotal|total/);
    });

    it('9. transitions cuisine : en préparation → prête → servie, contrôlées et idempotentes', async () => {
      const notSent = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      const refused = await kitchen.post(api(`/kitchen/orders/${notSent.id}/start`));
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('ORDER_NOT_SENT');

      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await send(cashier, order.id).expect(200);
      await cashier.post(api(`/kitchen/orders/${order.id}/start`)).expect(403);
      const early = await cashier.post(api(`/orders/${order.id}/serve`));
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('ORDER_NOT_READY');

      const started = (await kitchen.post(api(`/kitchen/orders/${order.id}/start`)).expect(200))
        .body;
      expect(started).toMatchObject({
        changed: true,
        order: { preparationStatus: 'IN_PREPARATION' },
      });
      await kds.waitFor((m) => m.type === 'order.started' && m.data.saleId === order.id);
      expect(
        (await kitchen.post(api(`/kitchen/orders/${order.id}/start`)).expect(200)).body.changed,
      ).toBe(false);
      const ready = (await kitchen.post(api(`/kitchen/orders/${order.id}/ready`)).expect(200)).body;
      expect(ready.order.preparationStatus).toBe('READY');
      await kitchen.post(api(`/orders/${order.id}/serve`)).expect(403);
      const served = (await cashier.post(api(`/orders/${order.id}/serve`)).expect(200)).body;
      expect(served.order).toMatchObject({ preparationStatus: 'SERVED', paymentStatus: 'UNPAID' });
      // Une action « en retard » (prête après servie) ne fait pas revenir en arrière.
      expect(
        (await kitchen.post(api(`/kitchen/orders/${order.id}/ready`)).expect(200)).body.changed,
      ).toBe(false);
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      expect(queue.map((o: { id: string }) => o.id)).not.toContain(order.id);
      const detail = (await cashier.get(api(`/orders/${order.id}`)).expect(200)).body;
      expect(detail.events.map((e: { type: string }) => e.type)).toEqual([
        'created',
        'sent_to_kitchen',
        'preparation_started',
        'ready',
        'served',
      ]);
      expect(detail.readyAt).toBeTruthy();
      expect(detail.servedAt).toBeTruthy();
    });

    it('une commande envoyée puis annulée (non payée) disparaît de l’écran cuisine', async () => {
      const order = (
        await createOrder(supervisor, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await send(supervisor, order.id).expect(200);
      await supervisor
        .post(api(`/sales/${order.id}/cancel`))
        .send({ reason: 'Client parti' })
        .expect(200);
      await kds.waitFor((m) => m.type === 'order.cancelled' && m.data.saleId === order.id);
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      expect(queue.map((o: { id: string }) => o.id)).not.toContain(order.id);
      const refused = await kitchen.post(api(`/kitchen/orders/${order.id}/start`));
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('ORDER_CANCELLED');
    });
  });

  describe('temps réel : reconnexion, sécurité et isolation', () => {
    it('10. reconnexion : rien n’est perdu pendant la coupure (resynchronisation à « ready »)', async () => {
      const first = await stream(kitchenCookie, `/kitchen/stream?establishmentId=${estA1}`);
      await first.waitFor((m) => m.type === 'ready');
      first.close();
      // Pendant la coupure, une commande est envoyée en cuisine.
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await send(cashier, order.id).expect(200);
      const second = await stream(kitchenCookie, `/kitchen/stream?establishmentId=${estA1}`);
      const ready = await second.waitFor((m) => m.type === 'ready');
      expect(ready.data).toMatchObject({ establishmentId: estA1, topic: 'kitchen' });
      // À la reconnexion, l'écran recharge la file : la commande envoyée pendant la coupure y est.
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      expect(queue.map((o: { id: string }) => o.id)).toContain(order.id);
      // Les évènements suivants arrivent sur la nouvelle connexion, et le battement est actif.
      await kitchen.post(api(`/kitchen/orders/${order.id}/start`)).expect(200);
      await second.waitFor((m) => m.type === 'order.started' && m.data.saleId === order.id);
      await second.waitFor((m) => m.type === 'ping', 5000);
      second.close();
    });

    it('sécurité : connexion authentifiée ; une session révoquée ferme le flux', async () => {
      await expect(
        stream('ocp_session=invalide', `/kitchen/stream?establishmentId=${estA1}`),
      ).rejects.toMatchObject({
        status: 401,
      });
      // Le caissier n'a pas accès au flux cuisine.
      const cashierCookie = await sessionCookie(
        (await employee(restoA, 'CASHIER', [estA1])).loginId,
      );
      await expect(
        stream(cashierCookie, `/kitchen/stream?establishmentId=${estA1}`),
      ).rejects.toMatchObject({
        status: 403,
      });
      const kitchenSession = await sessionCookie(
        (await employee(restoA, 'KITCHEN', [estA1])).loginId,
      );
      const live = await stream(kitchenSession, `/kitchen/stream?establishmentId=${estA1}`);
      await live.waitFor((m) => m.type === 'ready');
      await request(app.getHttpServer())
        .post(api('/auth/logout'))
        .set('Cookie', kitchenSession)
        .expect(204);
      await live.waitClosed(8000);
    });

    it('11. isolation des évènements : par établissement et par organisation', async () => {
      // Un cuisinier de l'annexe ne peut pas ouvrir le flux de l'établissement principal, et inversement.
      await expect(
        stream(kitchen2Cookie, `/kitchen/stream?establishmentId=${estA1}`),
      ).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        stream(kitchenCookie, `/kitchen/stream?establishmentId=${estA2}`),
      ).rejects.toMatchObject({
        status: 404,
      });
      // Une autre organisation : établissement introuvable ; un parc : module absent.
      await expect(
        stream(restoBCookie, `/kitchen/stream?establishmentId=${estA1}`),
      ).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        stream(parkCookie, `/kitchen/stream?establishmentId=${estA1}`),
      ).rejects.toMatchObject({
        status: 403,
      });

      const main = await stream(kitchenCookie, `/kitchen/stream?establishmentId=${estA1}`);
      const annex = await stream(kitchen2Cookie, `/kitchen/stream?establishmentId=${estA2}`);
      const other = await stream(restoBCookie, `/kitchen/stream?establishmentId=${estB}`);
      await Promise.all([main, annex, other].map((s) => s.waitFor((m) => m.type === 'ready')));

      // Une seule session de caisse ouverte par membre : l'annexe a son propre caissier.
      const annexCashier = (await employee(restoA, 'CASHIER', [estA2])).agent;
      await annexCashier
        .post(api('/cash-sessions'))
        .send({ establishmentId: estA2, openingFloat: 0 })
        .expect(201);
      const annexOrder = (
        await createOrder(
          annexCashier,
          { channel: 'DINE_IN', tableId: tableA2, lines: [{ variantId: poulet, quantity: 1 }] },
          estA2,
        ).expect(201)
      ).body;
      await send(annexCashier, annexOrder.id).expect(200);
      const mainOrder = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await send(cashier, mainOrder.id).expect(200);

      await annex.waitFor((m) => m.data.saleId === annexOrder.id);
      await main.waitFor((m) => m.data.saleId === mainOrder.id);
      await new Promise((r) => setTimeout(r, 500));
      expect(main.messages.some((m) => m.data.saleId === annexOrder.id)).toBe(false);
      expect(annex.messages.some((m) => m.data.saleId === mainOrder.id)).toBe(false);
      expect(
        other.messages.some(
          (m) => m.data.saleId === mainOrder.id || m.data.saleId === annexOrder.id,
        ),
      ).toBe(false);
      // Les commandes non envoyées ne sont jamais publiées sur le flux cuisine.
      expect(main.messages.some((m) => m.type === 'order.created')).toBe(false);
      [main, annex, other].forEach((s) => s.close());
    });

    it('le flux salle (commandes) reçoit les créations, paiements et demandes QR', async () => {
      const orders = await stream(ownerCookie, `/orders/stream?establishmentId=${estA1}`);
      await orders.waitFor((m) => m.type === 'ready');
      const order = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await orders.waitFor((m) => m.type === 'order.created' && m.data.saleId === order.id);
      await pay(cashier, order.id, 1000).expect(200);
      await orders.waitFor((m) => m.type === 'order.paid' && m.data.saleId === order.id);
      await request(app.getHttpServer())
        .post(api(`/public/menu/${poolZoneToken}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
        .expect(201);
      await orders.waitFor((m) => m.type === 'qr.requested');
      orders.close();
    });
  });

  describe('4. commandes par QR code', () => {
    const publicApi = () => request(app.getHttpServer());

    it('menu public : établissement, table et carte, sans compte ; jeton invalide refusé', async () => {
      const menu = (
        await publicApi()
          .get(api(`/public/menu/${table4Token}`))
          .expect(200)
      ).body;
      expect(menu.establishmentName).toBeTruthy();
      expect(menu.location).toBe('Terrasse · Table 4');
      const items = menu.categories.flatMap((c: { products: { name: string }[] }) => c.products);
      expect(items.map((p: { name: string }) => p.name)).toEqual(
        expect.arrayContaining(['Poulet braisé', 'Jus de bissap']),
      );
      expect(JSON.stringify(menu)).not.toMatch(/organizationId|establishmentId/);
      await publicApi().get(api('/public/menu/AAAAAAAAAAAAAAAAAAAAAA')).expect(404);
      await publicApi().get(api('/public/menu/court')).expect(400);
      const pool = (
        await publicApi()
          .get(api(`/public/menu/${poolZoneToken}`))
          .expect(200)
      ).body;
      expect(pool.location).toBe('Bord de piscine');
    });

    it('demande client : ni payée ni envoyée ; validée par un employé ; suivie par le client', async () => {
      const key = randomUUID();
      const body = {
        clientRequestId: key,
        customerName: 'Awa',
        notes: 'Table au soleil',
        lines: [
          { variantId: poulet, quantity: 1, notes: 'Sans piment' },
          { variantId: jus, quantity: 2 },
        ],
      };
      const submitted = (
        await publicApi()
          .post(api(`/public/menu/${table4Token}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(submitted).toMatchObject({ status: 'PENDING_VALIDATION', estimatedTotal: 6000 });
      // Double envoi (réseau mobile) : même demande.
      const replay = (
        await publicApi()
          .post(api(`/public/menu/${table4Token}/orders`))
          .send(body)
          .expect(201)
      ).body;
      expect(replay.publicToken).toBe(submitted.publicToken);
      expect(await prisma.qrOrderRequest.count({ where: { clientRequestId: key } })).toBe(1);

      const status = (
        await publicApi()
          .get(api(`/public/order-requests/${submitted.publicToken}`))
          .expect(200)
      ).body;
      expect(status).toMatchObject({
        status: 'PENDING_VALIDATION',
        order: null,
        location: 'Terrasse · Table 4',
      });
      // Rien n'arrive en cuisine.
      const queue = (await kitchen.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(200))
        .body;
      expect(queue.every((o: { channel: string }) => o.channel !== 'QR')).toBe(true);

      const pending = (
        await cashier.get(api(`/orders/qr-requests?establishmentId=${estA1}`)).expect(200)
      ).body;
      const request_ = pending.find(
        (r: { estimatedTotal: number; customerName: string }) => r.customerName === 'Awa',
      );
      expect(request_).toMatchObject({
        status: 'PENDING_VALIDATION',
        location: 'Terrasse · Table 4',
      });

      const sale = (
        await cashier.post(api(`/orders/qr-requests/${request_.id}/accept`)).expect(200)
      ).body;
      expect(sale).toMatchObject({
        channel: 'QR',
        paymentStatus: 'UNPAID',
        preparationStatus: 'NOT_SENT',
        table: { id: table4 },
        total: 6000,
      });
      expect(sale.notes).toContain('Client : Awa');
      // Double clic du même employé : même commande ; un autre employé : déjà traitée.
      const again = (
        await cashier.post(api(`/orders/qr-requests/${request_.id}/accept`)).expect(200)
      ).body;
      expect(again.id).toBe(sale.id);
      const other = await cashier2.post(api(`/orders/qr-requests/${request_.id}/accept`));
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('QR_ORDER_ALREADY_DECIDED');

      const followed = (
        await publicApi()
          .get(api(`/public/order-requests/${submitted.publicToken}`))
          .expect(200)
      ).body;
      expect(followed).toMatchObject({
        status: 'ACCEPTED',
        order: { number: sale.number, paymentStatus: 'UNPAID', preparationStatus: 'NOT_SENT' },
      });
      // Envoi explicite en cuisine, puis visible par le client.
      await send(cashier, sale.id).expect(200);
      const sent = (
        await publicApi()
          .get(api(`/public/order-requests/${submitted.publicToken}`))
          .expect(200)
      ).body;
      expect(sent.order.preparationStatus).toBe('SENT');
      expect(JSON.stringify(sent)).not.toMatch(/cashier|Kadiatou|organizationId/);
    });

    it('refus motivé ; demande d’une autre organisation inaccessible', async () => {
      const submitted = (
        await publicApi()
          .post(api(`/public/menu/${table4Token}/orders`))
          .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
          .expect(201)
      ).body;
      const pending = (
        await cashier.get(api(`/orders/qr-requests?establishmentId=${estA1}`)).expect(200)
      ).body;
      const id = pending[pending.length - 1].id;
      await restoB.agent.post(api(`/orders/qr-requests/${id}/accept`)).expect(404);
      await restoB.agent
        .post(api(`/orders/qr-requests/${id}/reject`))
        .send({ reason: 'Intrus' })
        .expect(404);
      await cashier
        .post(api(`/orders/qr-requests/${id}/reject`))
        .send({ reason: 'Article épuisé' })
        .expect(200);
      const status = (
        await publicApi()
          .get(api(`/public/order-requests/${submitted.publicToken}`))
          .expect(200)
      ).body;
      expect(status).toMatchObject({
        status: 'REJECTED',
        rejectedReason: 'Article épuisé',
        order: null,
      });
      await cashier.post(api(`/orders/qr-requests/${id}/accept`)).expect(409);
    });

    it('protection : prix refusés, articles d’un autre restaurant refusés, plafond par table, QR révoqué', async () => {
      const forged = await publicApi()
        .post(api(`/public/menu/${table4Token}/orders`))
        .send({
          clientRequestId: randomUUID(),
          lines: [{ variantId: jus, quantity: 1, unitPrice: 1 }],
        });
      expect(forged.status).toBe(400);
      const foreign = await publicApi()
        .post(api(`/public/menu/${table4Token}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: variantB, quantity: 1 }] });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('PRODUCT_UNAVAILABLE');
      await publicApi()
        .post(api(`/public/menu/${table4Token}/orders`))
        .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 21 }] })
        .expect(400);

      // Une table neuve : 5 demandes en attente au plus.
      const table = (
        await restoA.agent
          .post(api('/restaurant/tables'))
          .send({ establishmentId: estA1, name: 'Table 9' })
          .expect(201)
      ).body.id;
      const dining = (
        await restoA.agent.get(api(`/restaurant/dining?establishmentId=${estA1}`)).expect(200)
      ).body;
      const token = dining.tables
        .find((t: { id: string }) => t.id === table)
        .qrPath.split('/')
        .pop();
      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(
          (
            await publicApi()
              .post(api(`/public/menu/${token}/orders`))
              .send({ clientRequestId: randomUUID(), lines: [{ variantId: jus, quantity: 1 }] })
          ).status,
        );
      }
      expect(results).toEqual([201, 201, 201, 201, 201, 429]);

      // QR régénéré : l'ancien cesse de fonctionner ; table hors service : menu indisponible.
      const regenerated = (
        await restoA.agent.post(api(`/restaurant/tables/${table}/regenerate-qr`)).expect(200)
      ).body;
      await publicApi()
        .get(api(`/public/menu/${token}`))
        .expect(404);
      const newToken = regenerated.qrPath.split('/').pop();
      await publicApi()
        .get(api(`/public/menu/${newToken}`))
        .expect(200);
      await restoA.agent
        .patch(api(`/restaurant/tables/${table}`))
        .send({ isActive: false })
        .expect(200);
      await publicApi()
        .get(api(`/public/menu/${newToken}`))
        .expect(404);
    });
  });

  describe('12. ticket cuisine', () => {
    const print = (a: Agent, saleId: string) =>
      a.post(api('/print-jobs')).send({
        terminalId: kitchenPrinter,
        kind: 'KITCHEN',
        saleId,
        clientRequestId: randomUUID(),
      });

    it('après l’envoi seulement ; sans prix ; un échec d’impression ne touche pas au paiement', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          tableId: table4,
          notes: 'Allergie arachide',
          lines: [{ variantId: poulet, quantity: 2, notes: 'Bien cuit' }],
        }).expect(201)
      ).body;
      const early = await print(cashier, order.id);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('ORDER_NOT_SENT');
      await send(cashier, order.id).expect(200);
      // La cuisine n'imprime pas (pas de droit de vente) ; le caissier qui envoie, oui.
      await print(kitchen, order.id).expect(403);
      const job = (await print(cashier, order.id).expect(201)).body;
      const preview = job.preview.join('\n');
      expect(preview).toContain('CUISINE');
      expect(preview).toContain('2 x Poulet braisé');
      expect(preview).toContain('Grand');
      expect(preview).toContain('>> Bien cuit');
      expect(preview).toContain('Allergie arachide');
      expect(preview).toContain('Terrasse · Table 4');
      expect(preview).not.toMatch(/FCFA|8 000|8000/);
      expect(job.data).toEqual(expect.any(String));

      await cashier
        .post(api(`/print-jobs/${job.job.id}/result`))
        .send({ status: 'FAILED', errorCode: 'PRINTER_UNREACHABLE' })
        .expect(200);
      const after = (await cashier.get(api(`/orders/${order.id}`)).expect(200)).body;
      expect(after).toMatchObject({ paymentStatus: 'UNPAID', preparationStatus: 'SENT' });

      // Nouvel essai réussi, puis une réimpression porte la mention.
      const retry = (await print(cashier, order.id).expect(201)).body;
      expect(retry.preview.join('\n')).not.toContain('RÉIMPRESSION');
      await cashier
        .post(api(`/print-jobs/${retry.job.id}/result`))
        .send({ status: 'SUCCEEDED' })
        .expect(200);
      const duplicate = (await print(cashier, order.id).expect(201)).body;
      expect(duplicate.preview.join('\n')).toContain('RÉIMPRESSION');
    });
  });

  describe('stocks', () => {
    it('13. déduction : au paiement pour une vente au comptoir, à l’envoi pour une commande en salle', async () => {
      const startChicken = (await stockOf(chicken)).quantity;
      const startRice = (await stockOf(rice)).quantity;
      const counter = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: poulet, quantity: 2 }],
        }).expect(201)
      ).body;
      expect((await stockOf(chicken)).quantity).toBe(startChicken);
      await pay(cashier, counter.id, 8000).expect(200);
      expect((await stockOf(chicken)).quantity).toBe(startChicken - 2);
      expect((await stockOf(rice)).quantity).toBe(startRice - 0.5);

      const dineIn = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: poulet, quantity: 1 }],
        }).expect(201)
      ).body;
      await send(cashier, dineIn.id).expect(200);
      expect((await stockOf(chicken)).quantity).toBe(startChicken - 3);
      // Le paiement ultérieur ne déduit pas une seconde fois.
      await pay(cashier, dineIn.id, 4000).expect(200);
      expect((await stockOf(chicken)).quantity).toBe(startChicken - 3);
      const movements = await prisma.stockMovement.findMany({ where: { saleId: dineIn.id } });
      expect(movements.map((m) => m.kind)).toEqual(['SALE', 'SALE']);
    });

    it('14. idempotence : envoi et paiement simultanés, mouvement manuel rejoué', async () => {
      const start = (await stockOf(chicken)).quantity;
      const order = (
        await createOrder(cashier, {
          channel: 'DINE_IN',
          lines: [{ variantId: poulet, quantity: 1 }],
        }).expect(201)
      ).body;
      const [sent, paid] = await Promise.all([
        send(cashier, order.id),
        pay(cashier, order.id, 4000),
      ]);
      expect([sent.status, paid.status]).toEqual([200, 200]);
      expect((await stockOf(chicken)).quantity).toBe(start - 1);
      expect(
        await prisma.stockMovement.count({ where: { saleId: order.id, stockItemId: chicken } }),
      ).toBe(1);

      const key = randomUUID();
      const entry = {
        stockItemId: chicken,
        kind: 'IN',
        quantity: 2,
        reason: 'Marché',
        clientRequestId: key,
      };
      const [m1, m2] = await Promise.all([
        restoA.agent.post(api('/stock/movements')).send(entry),
        restoA.agent.post(api('/stock/movements')).send(entry),
      ]);
      expect([m1.status, m2.status]).toEqual([201, 201]);
      expect(m1.body.id).toBe(m2.body.id);
      expect((await stockOf(chicken)).quantity).toBe(start + 1);
    });

    it('15. alertes de seuil ; sorties et inventaires contrôlés ; coûts jamais inventés', async () => {
      const current = (await stockOf(chicken)).quantity;
      // Inventaire : 3 poulets comptés → au seuil (3) : alerte.
      await supervisor
        .post(api('/stock/movements'))
        .send({
          stockItemId: chicken,
          kind: 'ADJUSTMENT',
          quantity: 3,
          clientRequestId: randomUUID(),
        })
        .expect(403);
      const adjusted = (
        await restoA.agent
          .post(api('/stock/movements'))
          .send({
            stockItemId: chicken,
            kind: 'ADJUSTMENT',
            quantity: 3,
            reason: 'Inventaire',
            clientRequestId: randomUUID(),
          })
          .expect(201)
      ).body;
      expect(adjusted).toMatchObject({
        kind: 'ADJUSTMENT',
        quantity: 3 - current,
        quantityAfter: 3,
      });
      expect(await stockOf(chicken)).toMatchObject({ quantity: 3, low: true, alertThreshold: 3 });
      const tooMuch = await supervisor
        .post(api('/stock/movements'))
        .send({ stockItemId: chicken, kind: 'OUT', quantity: 4, clientRequestId: randomUUID() });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.code).toBe('INSUFFICIENT_STOCK');
      await supervisor
        .post(api('/stock/movements'))
        .send({
          stockItemId: chicken,
          kind: 'OUT',
          quantity: 1,
          reason: 'Perte',
          clientRequestId: randomUUID(),
        })
        .expect(201);
      const dashboard = (
        await restoA.agent.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(200)
      ).body;
      expect(dashboard.stockAlerts).toEqual([
        expect.objectContaining({ id: chicken, quantity: 2, alertThreshold: 3 }),
      ]);
      // Le poulet n'a pas de coût d'achat : il reste inconnu ; le riz garde le sien.
      const items = (
        await restoA.agent.get(api(`/stock/items?establishmentId=${estA1}`)).expect(200)
      ).body;
      expect(items.find((i: { id: string }) => i.id === chicken).unitCost).toBeNull();
      expect(items.find((i: { id: string }) => i.id === rice).unitCost).toBe(600);
      await cashier.get(api(`/stock/items?establishmentId=${estA1}`)).expect(403);
      expect(
        (await kitchen.get(api(`/stock/items?establishmentId=${estA1}`)).expect(200)).body.length,
      ).toBe(2);
    });
  });

  describe('16. réservations', () => {
    it('aucun chevauchement sur une même table ; créneaux bout à bout et annulation libèrent la table', async () => {
      const book = (startsAt: string, extra: Record<string, unknown> = {}) =>
        cashier.post(api('/reservations')).send({
          establishmentId: estA1,
          customerName: 'Mariam Diallo',
          customerPhone: '+223 70 00 00 00',
          partySize: 4,
          startsAt,
          durationMinutes: 90,
          tableId: table4,
          status: 'CONFIRMED',
          ...extra,
        });
      const first = (await book(inDays(3, 19)).expect(201)).body;
      expect(first).toMatchObject({ status: 'CONFIRMED', table: { id: table4 }, partySize: 4 });
      const overlap = await book(inDays(3, 20));
      expect(overlap.status).toBe(409);
      expect(overlap.body.code).toBe('RESERVATION_CONFLICT');
      await book(inDays(3, 20, 30)).expect(201);
      await book(inDays(3, 17, 30)).expect(201);
      // Annulation : le créneau redevient libre.
      await cashier
        .patch(api(`/reservations/${first.id}`))
        .send({ status: 'CANCELLED' })
        .expect(200);
      const rebooked = (await book(inDays(3, 19, 15), { durationMinutes: 60 }).expect(201)).body;
      // Remettre la réservation annulée en « confirmée » est refusé (créneau repris).
      const revive = await cashier
        .patch(api(`/reservations/${first.id}`))
        .send({ status: 'CONFIRMED' });
      expect(revive.status).toBe(409);
      // Sans table (zone ou salle), pas de contrôle de table.
      await book(inDays(3, 19), { tableId: undefined, zoneId: terrace }).expect(201);
      // Deux saisies simultanées sur le même créneau : une seule réussit.
      const [a, b] = await Promise.all([book(inDays(4, 12)), book(inDays(4, 12))]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const list = (
        await cashier
          .get(
            api(`/reservations?establishmentId=${estA1}&from=${inDays(3, 0)}&to=${inDays(5, 0)}`),
          )
          .expect(200)
      ).body;
      expect(list.map((r: { id: string }) => r.id)).toContain(rebooked.id);
      await cashier
        .patch(api(`/reservations/${rebooked.id}`))
        .send({ status: 'NO_SHOW' })
        .expect(200);
    });

    it('table d’un autre établissement ou d’une autre organisation refusée ; cuisine sans accès', async () => {
      const base = { customerName: 'Test', partySize: 2, startsAt: inDays(6, 12) };
      await cashier
        .post(api('/reservations'))
        .send({ establishmentId: estA1, tableId: tableA2, ...base })
        .expect(404);
      await restoB.agent
        .post(api('/reservations'))
        .send({ establishmentId: estB, tableId: table4, ...base })
        .expect(404);
      await kitchen.get(api(`/reservations?establishmentId=${estA1}`)).expect(403);
    });
  });

  describe('17. permissions et 18. isolation', () => {
    it('RBAC : caissier, cuisine, superviseur, administrateur', async () => {
      await cashier
        .post(api('/restaurant/tables'))
        .send({ establishmentId: estA1, name: 'X' })
        .expect(403);
      await cashier.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(403);
      await cashier
        .put(api(`/stock/recipes/${jus}`))
        .send({ establishmentId: estA1, components: [] })
        .expect(403);
      await kitchen.get(api(`/orders?establishmentId=${estA1}`)).expect(403);
      await kitchen
        .post(api('/orders'))
        .send({
          establishmentId: estA1,
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        })
        .expect(403);
      await kitchen.get(api(`/restaurant/dining?establishmentId=${estA1}`)).expect(403);
      await supervisor.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(200);
      await supervisor
        .post(api('/restaurant/zones'))
        .send({ establishmentId: estA1, name: 'Y', kind: 'ROOM' })
        .expect(403);
      await restoA.agent
        .post(api('/restaurant/zones'))
        .send({ establishmentId: estA1, name: 'Salle', kind: 'ROOM' })
        .expect(201);
      // Un caissier ne voit que ses propres commandes.
      const mine = (
        await createOrder(cashier2, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await cashier.get(api(`/orders/${mine.id}`)).expect(404);
      await send(cashier, mine.id).expect(404);
      const listed = (await cashier.get(api(`/orders?establishmentId=${estA1}`)).expect(200)).body;
      expect(listed.map((o: { id: string }) => o.id)).not.toContain(mine.id);
    });

    it('multi-tenant : aucune commande, table, stock ou flux d’une autre organisation', async () => {
      const order = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 1 }],
        }).expect(201)
      ).body;
      await restoB.agent.get(api(`/orders/${order.id}`)).expect(404);
      await restoB.agent
        .patch(api(`/orders/${order.id}`))
        .send({ notes: 'x' })
        .expect(404);
      await restoB.agent.post(api(`/orders/${order.id}/send-to-kitchen`)).expect(404);
      await restoB.agent.post(api(`/kitchen/orders/${order.id}/start`)).expect(404);
      await restoB.agent.get(api(`/orders?establishmentId=${estA1}`)).expect(404);
      await restoB.agent.get(api(`/kitchen/orders?establishmentId=${estA1}`)).expect(404);
      await restoB.agent.get(api(`/restaurant/dining?establishmentId=${estA1}`)).expect(404);
      await restoB.agent
        .patch(api(`/restaurant/tables/${table4}`))
        .send({ name: 'Volée' })
        .expect(404);
      await restoB.agent.get(api(`/stock/items?establishmentId=${estA1}`)).expect(404);
      await restoB.agent
        .post(api('/stock/movements'))
        .send({ stockItemId: chicken, kind: 'IN', quantity: 1, clientRequestId: randomUUID() })
        .expect(404);
      await restoB.agent.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(404);
      // Table et articles d'une autre organisation dans une commande : refusés.
      await restoB.agent
        .post(api('/cash-sessions'))
        .send({ establishmentId: estB, openingFloat: 0 })
        .expect(201);
      const stolenTable = await createOrder(
        restoB.agent,
        { channel: 'DINE_IN', tableId: table4, lines: [{ variantId: variantB, quantity: 1 }] },
        estB,
      );
      expect(stolenTable.status).toBe(404);
      expect(stolenTable.body.code).toBe('TABLE_NOT_FOUND');
      const stolenItem = await createOrder(
        restoB.agent,
        { channel: 'COUNTER', lines: [{ variantId: jus, quantity: 1 }] },
        estB,
      );
      expect(stolenItem.status).toBe(400);
      expect(stolenItem.body.code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('un parc n’accède à aucune fonction restaurant ; un établissement parc seul est refusé', async () => {
      for (const path of [
        `/orders?establishmentId=${estA1}`,
        `/kitchen/orders?establishmentId=${estA1}`,
        `/stock/items?establishmentId=${estA1}`,
        `/reservations?establishmentId=${estA1}`,
        `/restaurant/dining?establishmentId=${estA1}`,
      ]) {
        const res = await park.agent.get(api(path));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MODULE_NOT_IN_PLAN');
      }
      // Organisation parc + restaurant : son établissement « parc seul » n'a pas de restaurant.
      const res = await duo.agent.get(api(`/restaurant/dining?establishmentId=${estDuoPark}`));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ESTABLISHMENT_NOT_RESTAURANT');
      const order = await createOrder(
        duo.agent,
        { channel: 'COUNTER', lines: [{ variantId: jus, quantity: 1 }] },
        estDuoPark,
      );
      expect(order.status).toBe(400);
      expect(order.body.code).toBe('ESTABLISHMENT_NOT_RESTAURANT');
    });
  });

  describe('19. tableau de bord', () => {
    it('CA encaissé sans double comptage ni vente impayée ; files et temps de préparation', async () => {
      const before = (
        await restoA.agent.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(200)
      ).body;
      const unpaid = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 5 }],
        }).expect(201)
      ).body;
      const paid = (
        await createOrder(cashier, {
          channel: 'COUNTER',
          lines: [{ variantId: jus, quantity: 2 }],
        }).expect(201)
      ).body;
      const key = randomUUID();
      // Paiement rejoué deux fois en même temps avec la même clé : un seul encaissement.
      const [p1, p2] = await Promise.all([
        pay(cashier, paid.id, 2000, key),
        pay(cashier, paid.id, 2000, key),
      ]);
      expect([p1.status, p2.status]).toEqual([200, 200]);
      const after = (
        await restoA.agent.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(200)
      ).body;
      expect(after.revenueCollected - before.revenueCollected).toBe(2000);
      expect(after.paidSales - before.paidSales).toBe(1);
      expect(after.orders - before.orders).toBe(2);
      expect(unpaid.paymentStatus).toBe('UNPAID');

      // Cohérence avec la base : somme des paiements réussis du jour sur les ventes restaurant.
      const payments = await prisma.payment.aggregate({
        where: {
          status: 'SUCCEEDED',
          sale: { establishmentId: estA1, activity: 'RESTAURANT', status: 'OPEN' },
          createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
        },
        _sum: { amount: true },
      });
      expect(after.revenueCollected).toBe(payments._sum.amount);
      expect(after.averageBasket).toBe(Math.round(after.revenueCollected / after.paidSales));
      expect(after.topProducts[0]).toMatchObject({
        productName: expect.any(String),
        quantity: expect.any(Number),
      });
      expect(after.averagePreparationMinutes).not.toBeNull();
      expect(typeof after.waiting).toBe('number');
      expect(typeof after.inPreparation).toBe('number');
      // Les ventes du parc d'une autre organisation n'y figurent évidemment pas ; un caissier n'y a pas accès.
      await cashier.get(api(`/restaurant/dashboard?establishmentId=${estA1}`)).expect(403);
    });
  });
});
