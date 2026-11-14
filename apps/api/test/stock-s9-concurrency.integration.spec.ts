import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/common/storage/storage-provider';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { type Agent, type SignedUpOwner, cleanup, createTestApp, signup } from './helpers';

/**
 * Ocall Stock — S9, concurrence : chaque opération sensible est lancée deux fois en même temps (double clic,
 * deux postes, réseau qui rejoue). Attendu : une seule réussit, l'autre est refusée proprement (jamais une
 * erreur serveur), et le stock, les montants et les documents ne comptent l'opération qu'une fois.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');

type Res = Awaited<ReturnType<Agent['get']>>;

/** Deux requêtes simultanées : exactement une réussite, l'autre refusée sans erreur serveur. */
function oneWins(results: Res[]) {
  const statuses = results.map((r) => r.status);
  const wins = results.filter((r) => r.status >= 200 && r.status < 300);
  expect({ statuses, wins: wins.length }).toEqual({ statuses, wins: 1 });
  expect(statuses.every((s) => s < 500)).toBe(true);
  return wins[0]!;
}

(enabled ? describe : describe.skip)('Ocall Stock S9 — concurrence (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let storage: StorageProvider;
  let org: SignedUpOwner;
  let a: Agent;
  let site: { id: string; general: string };
  let site2: { id: string; general: string };
  let supplierId: string;
  let paint: { productId: string; variantId: string };

  async function ok<T = Record<string, any>>(req: ReturnType<Agent['get']>, status = 201) {
    const res = await req;
    if (res.status !== status) {
      throw new Error(`${status} attendu, ${res.status} : ${res.text.slice(0, 300)}`);
    }
    return res.body as T & Record<string, any>;
  }

  async function onHand(variantId: string, locationId: string) {
    const level = await db.stockLevel.findFirst({ where: { variantId, locationId } });
    return level ? level.onHand.toNumber() : 0;
  }

  async function product(name: string) {
    const p = await ok(
      a.post(api('/ocall-stock/products')).send({
        name,
        salePrice: 10_000,
        purchasePrice: 4000,
        vatRate: 18,
        unit: 'pot',
      }),
    );
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  async function stockIn(variantId: string, locationId: string, quantity: number) {
    await ok(
      a.post(api('/ocall-stock/movements')).send({
        kind: 'IN',
        variantId,
        locationId,
        quantity,
        idempotencyKey: key(),
      }),
    );
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
    org = await signup(app, 'stockS9C', 'PARK');
    a = org.agent;
    const saas = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    const plan = await prisma.subscriptionPlan.findUniqueOrThrow({
      where: { productId_name: { productId: saas.id, name: 'Ocall Stock — Avec vitrine' } },
    });
    await prisma.productTrial.create({
      data: {
        organizationId: org.organizationId,
        productId: saas.id,
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 14 * DAY),
        startedByOcall: true,
      },
    });
    await prisma.subscription.create({
      data: {
        organizationId: org.organizationId,
        productId: saas.id,
        planId: plan.id,
        status: 'TRIALING',
      },
    });
    const s1 = await ok(
      a.post(api('/ocall-stock/sites')).send({ code: 'MAG1', name: 'Magasin', kind: 'STORE' }),
    );
    const s2 = await ok(
      a.post(api('/ocall-stock/sites')).send({ code: 'DEP1', name: 'Dépôt', kind: 'WAREHOUSE' }),
    );
    site = { id: s1.id, general: s1.locations[0].id };
    site2 = { id: s2.id, general: s2.locations[0].id };
    supplierId = (await ok(a.post(api('/ocall-stock/suppliers')).send({ name: 'Grossiste' }))).id;
    paint = await product('Peinture concurrence');
    await stockIn(paint.variantId, site.general, 100);
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && org) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(db, [org.organizationId]);
      }
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  it('réception fournisseur rejouée en même temps : une seule entrée en stock', async () => {
    const order = await ok(
      a.post(api('/ocall-stock/purchase-orders')).send({
        supplierId,
        siteId: site.id,
        lines: [{ variantId: paint.variantId, quantity: 10, unitCost: 4000, vatRate: 18 }],
      }),
    );
    await ok(a.post(api(`/ocall-stock/purchase-orders/${order.id}/order`)), 200);
    const before = await onHand(paint.variantId, site.general);
    const body = {
      idempotencyKey: key(),
      lines: [{ orderLineId: order.lines[0].id, quantity: 10, locationId: site.general }],
    };
    const results = await Promise.all(
      [0, 1].map(() => a.post(api(`/ocall-stock/purchase-orders/${order.id}/receive`)).send(body)),
    );
    // Même clé : la seconde est un rejeu (succès sans effet) ou un refus, jamais une seconde entrée.
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(await onHand(paint.variantId, site.general)).toBe(before + 10);
    expect(await db.stockReceipt.count({ where: { orderId: order.id } })).toBe(1);

    // Deux annulations simultanées de la réception : une seule sortie compensatoire.
    const receipt = await db.stockReceipt.findFirstOrThrow({ where: { orderId: order.id } });
    oneWins(
      await Promise.all(
        [0, 1].map(() =>
          a.post(api(`/ocall-stock/receipts/${receipt.id}/cancel`)).send({ reason: 'Erreur' }),
        ),
      ),
    );
    expect(await onHand(paint.variantId, site.general)).toBe(before);
  });

  it('transfert expédié deux fois en même temps : une seule expédition', async () => {
    const t = await ok(
      a.post(api('/ocall-stock/transfers')).send({
        fromSiteId: site.id,
        toSiteId: site2.id,
        lines: [{ variantId: paint.variantId, quantity: 4 }],
      }),
    );
    await ok(
      a
        .post(api(`/ocall-stock/transfers/${t.id}/prepare`))
        .send({ lines: [{ lineId: t.lines[0].id, fromLocationId: site.general }] }),
      200,
    );
    const before = await onHand(paint.variantId, site.general);
    // Expédition idempotente : la seconde répond sans effet ; le stock ne sort qu'une fois.
    const shipped = await Promise.all(
      [0, 1].map(() => a.post(api(`/ocall-stock/transfers/${t.id}/ship`))),
    );
    expect(shipped.map((r) => r.status)).toEqual([200, 200]);
    expect(await onHand(paint.variantId, site.general)).toBe(before - 4);
    // Deux réceptions simultanées avec des clés différentes : jamais plus que l'expédié.
    const results = await Promise.all(
      [0, 1].map(() =>
        a.post(api(`/ocall-stock/transfers/${t.id}/receive`)).send({
          idempotencyKey: key(),
          lines: [{ lineId: t.lines[0].id, quantity: 4, toLocationId: site2.general }],
        }),
      ),
    );
    oneWins(results);
    expect(await onHand(paint.variantId, site2.general)).toBe(4);
  });

  it('inventaire validé deux fois en même temps : un seul ajustement', async () => {
    const glue = await product('Colle concurrence');
    await stockIn(glue.variantId, site2.general, 10);
    const count = await ok(
      a
        .post(api('/ocall-stock/counts'))
        .send({ siteId: site2.id, name: 'Inventaire', scope: 'FULL' }),
    );
    await ok(
      a.put(api(`/ocall-stock/counts/${count.id}/lines`)).send({
        variantId: glue.variantId,
        locationId: site2.general,
        quantity: 7,
        mode: 'SET',
      }),
      200,
    );
    await ok(
      a.put(api(`/ocall-stock/counts/${count.id}/lines`)).send({
        variantId: paint.variantId,
        locationId: site2.general,
        quantity: 4,
        mode: 'SET',
      }),
      200,
    );
    const glueMoves = () =>
      db.stockMovement.count({
        where: { organizationId: org.organizationId, variantId: glue.variantId },
      });
    const movements = await glueMoves();
    oneWins(
      await Promise.all([0, 1].map(() => a.post(api(`/ocall-stock/counts/${count.id}/validate`)))),
    );
    expect(await onHand(glue.variantId, site2.general)).toBe(7);
    // Un seul ajustement par article compté (−3 sur la colle), jamais deux.
    expect(await glueMoves()).toBe(movements + 1);
    expect(await onHand(paint.variantId, site2.general)).toBe(4);
  });

  it('caisse : même vente rejouée, retours simultanés, panier repris deux fois, clôture double', async () => {
    const register = (
      await ok(
        a
          .post(api('/ocall-stock/registers'))
          .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: site.general }),
      )
    ).id;
    const session = (
      await ok(a.post(api(`/ocall-stock/registers/${register}/sessions`)).send({ openingFloat: 0 }))
    ).id;
    const before = await onHand(paint.variantId, site.general);
    const sale = {
      idempotencyKey: key(),
      registerId: register,
      lines: [{ variantId: paint.variantId, quantity: 3 }],
      payments: [{ method: 'CASH', amount: 30_000 }],
    };
    const sold = await Promise.all([0, 1].map(() => a.post(api('/ocall-stock/sales')).send(sale)));
    expect(sold.every((r) => r.status < 500)).toBe(true);
    expect(sold.some((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(await db.stockSale.count({ where: { organizationId: org.organizationId } })).toBe(1);
    expect(await onHand(paint.variantId, site.general)).toBe(before - 3);

    const saleRow = await db.stockSale.findFirstOrThrow({
      where: { organizationId: org.organizationId },
      include: { lines: true },
    });
    // Deux retours de la totalité, clés différentes : jamais plus que vendu.
    oneWins(
      await Promise.all(
        [0, 1].map(() =>
          a.post(api(`/ocall-stock/sales/${saleRow.id}/returns`)).send({
            idempotencyKey: key(),
            registerId: register,
            reason: 'Erreur de teinte',
            restock: true,
            refundMethod: 'CASH',
            lines: [{ saleLineId: saleRow.lines[0]!.id, quantity: 3 }],
          }),
        ),
      ),
    );
    expect(await onHand(paint.variantId, site.general)).toBe(before);

    const cart = await ok(
      a
        .post(api(`/ocall-stock/registers/${register}/held-carts`))
        .send({ label: 'Client', lines: [{ variantId: paint.variantId, quantity: 1 }] }),
    );
    oneWins(
      await Promise.all([0, 1].map(() => a.delete(api(`/ocall-stock/held-carts/${cart.id}`)))),
    );

    oneWins(
      await Promise.all(
        [0, 1].map(() =>
          a
            .post(api(`/ocall-stock/cash-sessions/${session}/close`))
            .send({ countedCash: 0, differenceReason: 'Remboursement' }),
        ),
      ),
    );
  });

  it('IA : brouillon validé deux fois en même temps, ou validé et refusé, une seule décision', async () => {
    const proposal = (feature: string, data: Record<string, unknown>) =>
      db.stockAiProposal.create({
        data: {
          organizationId: org.organizationId,
          feature,
          model: 'simulated',
          createdByUserId: randomUUID(),
          ...data,
        } as Parameters<typeof db.stockAiProposal.create>[0]['data'],
      });
    const restock = await proposal('STOCK_RESTOCK', {
      targetType: 'SITE',
      targetId: site.id,
      input: { supplierId, siteId: site.id, sites: [site.id] },
      output: {
        lines: [{ variantId: paint.variantId, quantity: 5, unitCost: 4000, vatRate: 18 }],
      },
    });
    const drafts = () =>
      db.stockPurchaseOrder.count({
        where: { organizationId: org.organizationId, status: 'DRAFT' },
      });
    const draftsBefore = await drafts();
    const applied = oneWins(
      await Promise.all(
        [0, 1].map(() => a.post(api(`/ocall-stock/ai/proposals/${restock.id}/apply`)).send({})),
      ),
    );
    expect(await drafts()).toBe(draftsBefore + 1);
    expect(applied.body).toMatchObject({ status: 'APPLIED', resultId: expect.any(String) });

    // Illustration : validation et refus simultanés → soit la photo existe avec son fichier, soit rien.
    const bare = await product('Vernis concurrence');
    const storageKey = `org/${org.organizationId}/_/${randomUUID()}.jpg`;
    await storage.put(
      storageKey,
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#999999' } })
        .jpeg()
        .toBuffer(),
      'image/jpeg',
    );
    const ill = await proposal('STOCK_ILLUSTRATION', {
      targetType: 'PRODUCT',
      targetId: bare.productId,
      input: {},
      output: { storageKey, bytes: 100 },
    });
    const [apply, reject] = await Promise.all([
      a.post(api(`/ocall-stock/ai/proposals/${ill.id}/apply`)).send({ showcase: false }),
      a.post(api(`/ocall-stock/ai/proposals/${ill.id}/reject`)),
    ]);
    oneWins([apply, reject]);
    const images = await db.stockProductImage.findMany({ where: { productId: bare.productId } });
    const final = await db.stockAiProposal.findUniqueOrThrow({ where: { id: ill.id } });
    if (apply.status === 200) {
      expect(final.status).toBe('APPLIED');
      expect(images).toHaveLength(1);
      expect(await storage.get(storageKey)).not.toBeNull();
    } else {
      expect(final.status).toBe('REJECTED');
      expect(images).toHaveLength(0);
      expect(await storage.get(storageKey)).toBeNull();
    }
  });
});
