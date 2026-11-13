import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STOCK_PRODUCT_CODE, fromBase64 } from '@ocall/shared';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  login,
  signup,
} from './helpers';

/**
 * Ocall Stock — S4 (caisse) : caisses et sessions (fond, une seule session ouverte, clôture avec écart
 * motivé), ventes (prix lus dans le catalogue, paiements mixtes, monnaie, rejeu sans effet, sorties de
 * stock), remises selon les droits et le plafond, deux caisses qui vendent le dernier article, ticket
 * (aperçu, ESC/POS, PDF, duplicata), retours et remboursements, paniers en attente, clients, sites,
 * isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');

(enabled ? describe : describe.skip)('Ocall Stock S4 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let a: Agent;
  let cashier: Agent;
  let seller: Agent;
  let paint: { productId: string; variantId: string };
  let service: { productId: string; variantId: string };
  let site: { id: string; general: string };
  let otherSite: { id: string; general: string };
  let register1: string;
  let register2: string;
  let session1: string;
  let saleId: string;
  let saleLines: { paint: string; service: string };

  async function startTrial(organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    await prisma.productTrial.create({
      data: {
        organizationId,
        productId: product.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * DAY),
        startedByOcall: true,
      },
    });
    await prisma.subscription.create({
      data: { organizationId, productId: product.id, planId, status: 'TRIALING' },
    });
  }

  async function product(name: string, extra: Record<string, unknown> = {}) {
    const p = (
      await a
        .post(api('/ocall-stock/products'))
        .send({ name, salePrice: 6000, purchasePrice: 4000, ...extra })
        .expect(201)
    ).body;
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  async function stockIn(variantId: string, locationId: string, quantity: number) {
    await a
      .post(api('/ocall-stock/movements'))
      .send({ kind: 'IN', variantId, locationId, quantity, idempotencyKey: key() })
      .expect(201);
  }

  async function onHand(locationId: string, variantId: string): Promise<number> {
    const level = await db.stockLevel.findUnique({
      where: { locationId_variantId: { locationId, variantId } },
    });
    return level ? level.onHand.toNumber() : 0;
  }

  async function member(role: string, firstName: string) {
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName, lastName: 'Caisse', role })
        .expect(201)
    ).body;
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { agent: session.agent, memberId: created.member.id as string };
  }

  const sell = (body: Record<string, unknown>, agent: Agent = cashier) =>
    agent.post(api('/ocall-stock/sales')).send({ idempotencyKey: key(), ...body });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    const p = await prisma.saasProduct.findUniqueOrThrow({ where: { code: STOCK_PRODUCT_CODE } });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: p.id,
          name: `Stock S4 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockS4A', 'PARK');
    orgB = await signup(app, 'stockS4B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    a = orgA.agent;
    paint = await product('Peinture blanche 5 L');
    service = await product('Découpe de verre', { salePrice: 2500, isStockable: false });
    const s = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG1', name: 'Magasin Bamako', kind: 'STORE' })
        .expect(201)
    ).body;
    site = { id: s.id, general: s.locations[0].id };
    const o = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG2', name: 'Magasin Ségou', kind: 'STORE' })
        .expect(201)
    ).body;
    otherSite = { id: o.id, general: o.locations[0].id };
    await stockIn(paint.variantId, site.general, 10);
    cashier = (await member('CASHIER', 'Awa')).agent;
    seller = (await member('SALES', 'Moussa')).agent;
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(db, [orgA.organizationId, orgB.organizationId]);
      }
      if (prisma) {
        await cleanup(prisma);
        if (planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('caisses et sessions : création réservée, code unique, vente refusée sans session, une seule session ouverte', async () => {
    await cashier
      .post(api('/ocall-stock/registers'))
      .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: site.general })
      .expect(403);
    register1 = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({
          code: 'caisse1',
          name: 'Caisse 1',
          locationId: site.general,
          paperWidth: 58,
          printerConnection: 'SIMULATED',
        })
        .expect(201)
    ).body.id;
    const dup = await a
      .post(api('/ocall-stock/registers'))
      .send({ code: 'CAISSE1', name: 'Doublon', locationId: site.general })
      .expect(409);
    expect(dup.body.code).toBe('STOCK_REGISTER_CODE_TAKEN');
    register2 = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({ code: 'CAISSE2', name: 'Caisse 2', locationId: site.general })
        .expect(201)
    ).body.id;

    const closed = await sell({
      registerId: register1,
      lines: [{ variantId: paint.variantId, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 6000 }],
    }).expect(409);
    expect(closed.body.code).toBe('STOCK_CASH_SESSION_REQUIRED');

    const opened = (
      await cashier
        .post(api(`/ocall-stock/registers/${register1}/sessions`))
        .send({ openingFloat: 10_000 })
        .expect(201)
    ).body;
    session1 = opened.id;
    expect(opened).toMatchObject({ status: 'OPEN', openingFloat: 10_000, label: 'SES-000001' });
    const twice = await seller
      .post(api(`/ocall-stock/registers/${register1}/sessions`))
      .send({ openingFloat: 0 })
      .expect(409);
    expect(twice.body.code).toBe('STOCK_CASH_SESSION_ALREADY_OPEN');
    // Une caisse dont la session est ouverte ne change pas d'emplacement.
    const moved = await a
      .patch(api(`/ocall-stock/registers/${register1}`))
      .send({ locationId: otherSite.general })
      .expect(409);
    expect(moved.body.code).toBe('STOCK_REGISTER_SESSION_OPEN');
    const list = (await cashier.get(api('/ocall-stock/registers')).expect(200)).body;
    expect(list.find((r: { id: string }) => r.id === register1).openSession.label).toBe(
      'SES-000001',
    );
  });

  it('vente : prix du catalogue, paiements mixtes et monnaie, sortie de stock, rejeu sans effet', async () => {
    const idempotencyKey = key();
    const body = {
      idempotencyKey,
      registerId: register1,
      lines: [
        { variantId: paint.variantId, quantity: 2 },
        { variantId: service.variantId, quantity: 1 },
      ],
      payments: [
        { method: 'MOBILE_MONEY', amount: 5000, reference: 'OM-20261113-001' },
        { method: 'CASH', amount: 9500, tendered: 10_000 },
      ],
    };
    const sale = (await cashier.post(api('/ocall-stock/sales')).send(body).expect(201)).body;
    saleId = sale.id;
    expect(sale).toMatchObject({
      label: 'VTE-000001',
      grossTotal: 14_500,
      discountTotal: 0,
      total: 14_500,
      vatTotal: 2212,
      changeGiven: 500,
      cashierName: 'Awa Caisse',
      replayed: false,
    });
    saleLines = {
      paint: sale.lines.find((l: { variantId: string }) => l.variantId === paint.variantId).id,
      service: sale.lines.find((l: { variantId: string }) => l.variantId === service.variantId).id,
    };
    expect(sale.lines.find((l: { id: string }) => l.id === saleLines.paint)).toMatchObject({
      quantity: 2,
      unitPrice: 6000,
      total: 12_000,
      vatAmount: 1831,
      isStockable: true,
    });
    expect(await onHand(site.general, paint.variantId)).toBe(8);
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { organizationId: orgA.organizationId, sourceType: 'SALE', sourceId: saleId },
    });
    expect(movement).toMatchObject({ kind: 'SALE', reason: 'VTE-000001' });
    expect(movement.quantity.toNumber()).toBe(-2);
    expect(movement.idempotencyKey).toBe(`stock-sale:${saleId}:${saleLines.paint}`);
    // L'article non stocké n'a aucun mouvement.
    expect(
      await db.stockMovement.count({
        where: { organizationId: orgA.organizationId, variantId: service.variantId },
      }),
    ).toBe(0);

    // Rejeu (coupure réseau, double clic) : même vente, rien de plus.
    const replay = (await cashier.post(api('/ocall-stock/sales')).send(body).expect(201)).body;
    expect(replay).toMatchObject({ id: saleId, replayed: true });
    expect(await onHand(site.general, paint.variantId)).toBe(8);
    expect(await db.stockSale.count({ where: { organizationId: orgA.organizationId } })).toBe(1);
  });

  it('articles en caisse : recherche tolérante, lecture d’un code, prix et quantité disponible', async () => {
    const found = (
      await cashier.get(api(`/ocall-stock/registers/${register1}/items?q=peintur`)).expect(200)
    ).body;
    expect(found[0]).toMatchObject({
      variantId: paint.variantId,
      unitPrice: 6000,
      vatRate: 18,
      isStockable: true,
      available: 8,
    });
    const sku = (await db.stockVariant.findUniqueOrThrow({ where: { id: paint.variantId } })).sku;
    const scanned = (
      await cashier
        .get(api(`/ocall-stock/registers/${register1}/scan?code=${encodeURIComponent(sku)}`))
        .expect(200)
    ).body;
    expect(scanned).toMatchObject({ found: true, item: { variantId: paint.variantId } });
    const service2 = (
      await cashier.get(api(`/ocall-stock/registers/${register1}/items?q=decoupe`)).expect(200)
    ).body;
    expect(service2[0]).toMatchObject({ variantId: service.variantId, available: null });
    expect(
      (
        await cashier
          .get(api(`/ocall-stock/registers/${register1}/scan?code=INCONNU42`))
          .expect(200)
      ).body.found,
    ).toBe(false);
  });

  it('paiements refusés : somme différente du total, monnaie hors espèces ; article archivé refusé', async () => {
    const line = [{ variantId: paint.variantId, quantity: 1 }];
    const short = await sell({
      registerId: register1,
      lines: line,
      payments: [{ method: 'CARD', amount: 5000 }],
    }).expect(400);
    expect(short.body.code).toBe('STOCK_PAYMENT_INVALID');
    await sell({
      registerId: register1,
      lines: line,
      payments: [{ method: 'CARD', amount: 6000, tendered: 10_000 }],
    }).expect(400);
    const archived = await product('Ancien modèle');
    await stockIn(archived.variantId, site.general, 1);
    await a
      .patch(api(`/ocall-stock/products/${archived.productId}`))
      .send({ isArchived: true })
      .expect(200);
    const refused = await sell({
      registerId: register1,
      lines: [{ variantId: archived.variantId, quantity: 1 }],
      payments: [{ method: 'CARD', amount: 6000 }],
    }).expect(409);
    expect(refused.body.code).toBe('STOCK_VARIANT_ARCHIVED');
    expect(await onHand(site.general, paint.variantId)).toBe(8);
  });

  it('remises : caissier sans droit, commercial plafonné (réglable), responsable sans plafond', async () => {
    const withDiscount = (discount: number, agent: Agent) =>
      sell(
        {
          registerId: register1,
          lines: [{ variantId: paint.variantId, quantity: 1, discount }],
          payments: [{ method: 'CARD', amount: 6000 - discount }],
        },
        agent,
      );
    const forbidden = await withDiscount(600, cashier).expect(403);
    expect(forbidden.body.code).toBe('STOCK_DISCOUNT_FORBIDDEN');
    const capped = await withDiscount(601, seller).expect(400);
    expect(capped.body.code).toBe('STOCK_DISCOUNT_REFUSED');
    expect((await withDiscount(600, seller).expect(201)).body.discountTotal).toBe(600);
    // Plafond relevé à 20 % dans les réglages.
    await a
      .put(api('/ocall-stock/settings'))
      .send({
        storeName: 'Quincaillerie du Fleuve',
        defaultVatRate: 18,
        internalCodePrefix: 'QF',
        maxDiscountPercent: 20,
        receiptPhone: '+223 70 00 00 00',
        receiptAddress: 'Rue 12, Bamako',
      })
      .expect(200);
    await withDiscount(1200, seller).expect(201);
    await withDiscount(1201, seller).expect(400);
    // Le responsable (propriétaire) dépasse le plafond.
    expect((await withDiscount(3000, a).expect(201)).body.total).toBe(3000);
    expect(await onHand(site.general, paint.variantId)).toBe(5);
  });

  it('dernier article vendu par deux caisses en même temps : une vente passe, l’autre est refusée', async () => {
    const last = await product('Perceuse 750 W', { salePrice: 45_000 });
    await stockIn(last.variantId, site.general, 1);
    await seller
      .post(api(`/ocall-stock/registers/${register2}/sessions`))
      .send({ openingFloat: 0 })
      .expect(201);
    const sale = (registerId: string, agent: Agent) =>
      sell(
        {
          registerId,
          lines: [{ variantId: last.variantId, quantity: 1 }],
          payments: [{ method: 'CARD', amount: 45_000 }],
        },
        agent,
      );
    const results = await Promise.all([sale(register1, cashier), sale(register2, seller)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('STOCK_INSUFFICIENT');
    expect(await onHand(site.general, last.variantId)).toBe(0);
  });

  it('ticket : aperçu 58 mm, flux ESC/POS, PDF, duplicata compté ; la vente encaissée est figée par la base', async () => {
    const receipt = (await cashier.get(api(`/ocall-stock/sales/${saleId}/receipt`)).expect(200))
      .body;
    expect(receipt.paperWidth).toBe(58);
    expect(receipt.printer).toEqual({ connection: 'SIMULATED', address: null });
    const text = receipt.preview.join('\n');
    expect(text).toContain('VTE-000001');
    expect(text).toContain('Caissier : Awa Caisse');
    expect(text).toContain('Rue 12, Bamako');
    expect(text).toMatch(/Monnaie rendue\s+500 FCFA/);
    expect(text).toContain('Réf. OM-20261113-001');
    expect(text).not.toContain('DUPLICATA');
    expect(fromBase64(receipt.data).length).toBeGreaterThan(200);
    const pdf = await cashier.get(api(`/ocall-stock/sales/${saleId}/receipt.pdf`)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    // Réimpression : DUPLICATA, comptée.
    const dup = (
      await cashier.post(api(`/ocall-stock/sales/${saleId}/reprint?width=80`)).expect(201)
    ).body;
    expect(dup.preview[0]).toContain('DUPLICATA');
    expect(dup.paperWidth).toBe(80);
    expect((await db.stockSale.findUniqueOrThrow({ where: { id: saleId } })).reprintCount).toBe(1);

    await expect(
      db.$executeRaw`UPDATE "StockSale" SET "total" = 1 WHERE "id" = ${saleId}::uuid`,
    ).rejects.toThrow(/STOCK_SALE_FROZEN/);
    await expect(
      db.$executeRaw`UPDATE "StockSaleLine" SET "unitPrice" = 1 WHERE "saleId" = ${saleId}::uuid`,
    ).rejects.toThrow(/STOCK_SALE_FROZEN/);
    await expect(
      db.$executeRaw`DELETE FROM "StockSale" WHERE "id" = ${saleId}::uuid`,
    ).rejects.toThrow(/STOCK_SALE_FROZEN/);
    await expect(
      db.$executeRaw`UPDATE "StockPayment" SET "amount" = 1 WHERE "saleId" = ${saleId}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
  });

  it('retours : droit requis, remboursement au prorata, remise en stock ou non, jamais plus que vendu, rejeu', async () => {
    const refund = (body: Record<string, unknown>, agent: Agent = a) =>
      agent
        .post(api(`/ocall-stock/sales/${saleId}/returns`))
        .send({ idempotencyKey: key(), registerId: register1, ...body });
    await refund(
      {
        reason: 'Erreur de teinte',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: saleLines.paint, quantity: 1 }],
      },
      cashier,
    ).expect(403);

    const idempotencyKey = key();
    const first = (
      await refund({
        idempotencyKey,
        reason: 'Erreur de teinte',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: saleLines.paint, quantity: 1 }],
      }).expect(201)
    ).body;
    expect(first.returns[0]).toMatchObject({ label: 'RET-000001', refundAmount: 6000 });
    expect(await onHand(site.general, paint.variantId)).toBe(6);
    // Rejeu : rien de plus.
    const again = (
      await refund({
        idempotencyKey,
        reason: 'Erreur de teinte',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: saleLines.paint, quantity: 1 }],
      }).expect(201)
    ).body;
    expect(again.replayed).toBe(true);
    expect(await onHand(site.general, paint.variantId)).toBe(6);

    const over = await refund({
      reason: 'Trop',
      restock: true,
      refundMethod: 'CASH',
      lines: [{ saleLineId: saleLines.paint, quantity: 2 }],
    }).expect(409);
    expect(over.body.code).toBe('STOCK_RETURN_OVER_SALE');

    // Caisse d'un autre magasin : refusée.
    const elsewhere = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({ code: 'SEG1', name: 'Caisse Ségou', locationId: otherSite.general })
        .expect(201)
    ).body.id;
    const site2 = await refund({
      registerId: elsewhere,
      reason: 'Ailleurs',
      restock: true,
      refundMethod: 'CASH',
      lines: [{ saleLineId: saleLines.paint, quantity: 1 }],
    }).expect(400);
    expect(site2.body.code).toBe('STOCK_RETURN_SITE');

    // Pot abîmé : remboursé en mobile money, non remis en stock.
    const defective = (
      await refund({
        reason: 'Pot percé',
        restock: false,
        refundMethod: 'MOBILE_MONEY',
        lines: [{ saleLineId: saleLines.paint, quantity: 1 }],
      }).expect(201)
    ).body;
    expect(defective.returns[1]).toMatchObject({ refundAmount: 6000, restock: false });
    expect(await onHand(site.general, paint.variantId)).toBe(6);
    expect(defective.lines.find((l: { id: string }) => l.id === saleLines.paint)).toMatchObject({
      returnedQuantity: 2,
      refundedAmount: 12_000,
    });
    await expect(
      db.$executeRaw`UPDATE "StockSaleReturn" SET "reason" = 'X' WHERE "saleId" = ${saleId}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
  });

  it('clôture : espèces attendues, écart avec motif obligatoire, session figée ensuite', async () => {
    const report = (await cashier.get(api(`/ocall-stock/cash-sessions/${session1}`)).expect(200))
      .body;
    // Fond 10 000 + espèces 9 500 − remboursement espèces 6 000.
    expect(report.summary).toMatchObject({
      expectedCash: 13_500,
      received: { CASH: 9500, MOBILE_MONEY: 5000 },
      refunded: { CASH: 6000, MOBILE_MONEY: 6000 },
      returnsCount: 2,
    });
    const noReason = await cashier
      .post(api(`/ocall-stock/cash-sessions/${session1}/close`))
      .send({ countedCash: 13_000 })
      .expect(400);
    expect(noReason.body.code).toBe('STOCK_CASH_DIFFERENCE_REASON');
    const closed = (
      await cashier
        .post(api(`/ocall-stock/cash-sessions/${session1}/close`))
        .send({ countedCash: 13_000, differenceReason: 'Monnaie rendue en trop' })
        .expect(201)
    ).body;
    expect(closed).toMatchObject({
      status: 'CLOSED',
      expectedCash: 13_500,
      countedCash: 13_000,
      difference: -500,
      differenceReason: 'Monnaie rendue en trop',
    });
    const twice = await cashier
      .post(api(`/ocall-stock/cash-sessions/${session1}/close`))
      .send({ countedCash: 13_500 })
      .expect(409);
    expect(twice.body.code).toBe('STOCK_CASH_SESSION_CLOSED');
    await sell({
      registerId: register1,
      lines: [{ variantId: paint.variantId, quantity: 1 }],
      payments: [{ method: 'CASH', amount: 6000 }],
    }).expect(409);
    await expect(
      db.$executeRaw`UPDATE "StockCashSession" SET "countedCash" = 13500 WHERE "id" = ${session1}::uuid`,
    ).rejects.toThrow(/STOCK_CASH_SESSION_FROZEN/);
  });

  it('paniers en attente : mise de côté, reprise une seule fois', async () => {
    const cart = (
      await seller
        .post(api(`/ocall-stock/registers/${register2}/held-carts`))
        .send({
          label: 'Client parti chercher',
          lines: [{ variantId: paint.variantId, quantity: 3 }],
        })
        .expect(201)
    ).body;
    const held = (
      await seller.get(api(`/ocall-stock/registers/${register2}/held-carts`)).expect(200)
    ).body;
    expect(held).toHaveLength(1);
    const resumed = (await seller.delete(api(`/ocall-stock/held-carts/${cart.id}`)).expect(200))
      .body;
    expect(resumed.payload.lines).toEqual([
      { variantId: paint.variantId, quantity: 3, discount: 0 },
    ]);
    expect(resumed.items).toEqual([
      expect.objectContaining({ variantId: paint.variantId, unitPrice: 6000 }),
    ]);
    await seller.delete(api(`/ocall-stock/held-carts/${cart.id}`)).expect(404);
  });

  it('clients : créés à la caisse, recherchés, liés à la vente ; client archivé refusé', async () => {
    const customer = (
      await cashier
        .post(api('/ocall-stock/customers'))
        .send({ name: 'Mariam Coulibaly', phone: '+223 76 11 22 33' })
        .expect(201)
    ).body;
    const found = (await cashier.get(api('/ocall-stock/customers?q=76 11')).expect(200)).body;
    expect(found.map((c: { id: string }) => c.id)).toContain(customer.id);
    const sale = (
      await sell(
        {
          registerId: register2,
          customerId: customer.id,
          lines: [{ variantId: paint.variantId, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 6000, tendered: 6000 }],
        },
        seller,
      ).expect(201)
    ).body;
    expect(sale.customer).toMatchObject({ id: customer.id, name: 'Mariam Coulibaly' });
    const detail = (await cashier.get(api(`/ocall-stock/customers/${customer.id}`)).expect(200))
      .body;
    expect(detail.sales.map((s: { id: string }) => s.id)).toEqual([sale.id]);
    await a
      .patch(api(`/ocall-stock/customers/${customer.id}`))
      .send({ isArchived: true })
      .expect(200);
    const archived = await sell(
      {
        registerId: register2,
        customerId: customer.id,
        lines: [{ variantId: paint.variantId, quantity: 1 }],
        payments: [{ method: 'CARD', amount: 6000 }],
      },
      seller,
    ).expect(404);
    expect(archived.body.code).toBe('STOCK_CUSTOMER_NOT_FOUND');
  });

  it('sites : un membre rattaché à un autre magasin ne voit ni la caisse ni ses ventes', async () => {
    const m = await member('CASHIER', 'Fanta');
    await a
      .put(api(`/ocall-stock/members/${m.memberId}/sites`))
      .send({ siteIds: [otherSite.id] })
      .expect(200);
    const registers = (await m.agent.get(api('/ocall-stock/registers')).expect(200)).body;
    expect(registers.map((r: { code: string }) => r.code)).toEqual(['SEG1']);
    await m.agent.get(api(`/ocall-stock/sales/${saleId}`)).expect(404);
    expect((await m.agent.get(api('/ocall-stock/sales')).expect(200)).body).toEqual([]);
    await m.agent
      .post(api(`/ocall-stock/registers/${register2}/sessions`))
      .send({ openingFloat: 0 })
      .expect(404);
  });

  it('isolation : une autre organisation ne voit ni ne touche rien', async () => {
    const b = orgB.agent;
    await b.get(api(`/ocall-stock/sales/${saleId}`)).expect(404);
    await b.get(api(`/ocall-stock/sales/${saleId}/receipt`)).expect(404);
    await b.get(api(`/ocall-stock/cash-sessions/${session1}`)).expect(404);
    await b
      .post(api(`/ocall-stock/registers/${register2}/sessions`))
      .send({ openingFloat: 0 })
      .expect(404);
    await b
      .post(api(`/ocall-stock/sales/${saleId}/returns`))
      .send({
        idempotencyKey: key(),
        registerId: register2,
        reason: 'Intrusion',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: saleLines.service, quantity: 1 }],
      })
      .expect(404);
    expect((await b.get(api('/ocall-stock/sales')).expect(200)).body).toEqual([]);
    expect((await b.get(api('/ocall-stock/registers')).expect(200)).body).toEqual([]);
    expect((await b.get(api('/ocall-stock/customers')).expect(200)).body).toEqual([]);
  });
});
