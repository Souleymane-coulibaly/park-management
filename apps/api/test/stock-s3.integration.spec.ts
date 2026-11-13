import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
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
 * Ocall Stock — S3 (achats) : commande brouillon puis figée (contrôlé par la base), réceptions partielles
 * et complètes (entrées en stock, rejeu sans effet, jamais au-delà du commandé), prix d'achat (historique,
 * report sur l'article), annulation d'une réception (sorties compensatoires, refusée si la marchandise est
 * partie), clôture, annulation, retours fournisseurs, coûts masqués au magasinier, documents joints, bon de
 * commande PDF, isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

(enabled ? describe : describe.skip)('Ocall Stock S3 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let a: Agent;
  let keeper: Agent;
  let supplierId: string;
  let paint: { productId: string; variantId: string };
  let glue: { productId: string; variantId: string };
  let site: { id: string; general: string };
  let otherSiteGeneral: string;
  let bin: string;
  let orderId: string;
  let lines: { paint: string; glue: string };
  let firstReceipt: string;
  let secondReceipt: string;

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
        .send({ name, salePrice: 1000, purchasePrice: 800, ...extra })
        .expect(201)
    ).body;
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  async function onHand(locationId: string, variantId: string): Promise<number> {
    const level = await db.stockLevel.findUnique({
      where: { locationId_variantId: { locationId, variantId } },
    });
    return level ? level.onHand.toNumber() : 0;
  }

  const receive = (body: Record<string, unknown>, agent: Agent = a, id = orderId) =>
    agent
      .post(api(`/ocall-stock/purchase-orders/${id}/receive`))
      .send({ idempotencyKey: key(), ...body });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    const p = await prisma.saasProduct.findUniqueOrThrow({ where: { code: STOCK_PRODUCT_CODE } });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: p.id,
          name: `Stock S3 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockS3A', 'PARK');
    orgB = await signup(app, 'stockS3B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    a = orgA.agent;
    supplierId = (
      await a
        .post(api('/ocall-stock/suppliers'))
        .send({ name: 'Grossiste Sahel Distribution', leadTimeDays: 7 })
        .expect(201)
    ).body.id;
    paint = await product('Peinture blanche 5 L', { purchasePrice: 9000 });
    glue = await product('Colle à bois');
    const s = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'ENT1', name: 'Entrepôt Bamako', kind: 'WAREHOUSE' })
        .expect(201)
    ).body;
    site = { id: s.id, general: s.locations[0].id };
    otherSiteGeneral = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG1', name: 'Magasin', kind: 'STORE' })
        .expect(201)
    ).body.locations[0].id;
    bin = (
      await a
        .post(api(`/ocall-stock/sites/${site.id}/locations`))
        .send({ kind: 'BIN', code: 'A-01', name: 'Rayon A-01' })
        .expect(201)
    ).body.id;
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Ibra', lastName: 'Magasin', role: 'STOREKEEPER' })
        .expect(201)
    ).body;
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    keeper = session.agent;
    await keeper
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
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

  it('commande : brouillon modifiable, totaux, puis commandée et figée (la base refuse toute modification)', async () => {
    const draft = (
      await a
        .post(api('/ocall-stock/purchase-orders'))
        .send({
          supplierId,
          siteId: site.id,
          expectedAt: '2026-12-01',
          lines: [
            { variantId: paint.variantId, quantity: 10, unitCost: 9000, vatRate: 18 },
            { variantId: glue.variantId, quantity: 5, unitCost: 1500, vatRate: 0 },
          ],
        })
        .expect(201)
    ).body;
    orderId = draft.id;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      label: 'BC-000001',
      totals: { ht: 97_500, vat: 16_200, ttc: 113_700 },
    });
    const edited = (
      await a
        .patch(api(`/ocall-stock/purchase-orders/${orderId}`))
        .send({
          lines: [
            { variantId: paint.variantId, quantity: 12, unitCost: 9000, vatRate: 18 },
            { variantId: glue.variantId, quantity: 5, unitCost: 1500, vatRate: 0 },
          ],
        })
        .expect(200)
    ).body;
    lines = {
      paint: edited.lines.find((l: { variant: { id: string } }) => l.variant.id === paint.variantId)
        .id,
      glue: edited.lines.find((l: { variant: { id: string } }) => l.variant.id === glue.variantId)
        .id,
    };
    const dup = await a
      .post(api('/ocall-stock/purchase-orders'))
      .send({
        supplierId,
        siteId: site.id,
        lines: [1, 2].map(() => ({
          variantId: paint.variantId,
          quantity: 1,
          unitCost: 1,
          vatRate: 0,
        })),
      })
      .expect(400);
    expect(dup.body.code).toBe('STOCK_PURCHASE_DUPLICATE_LINE');

    // Pas de réception avant la commande.
    await receive({ lines: [{ orderLineId: lines.paint, quantity: 1, locationId: bin }] }).expect(
      409,
    );
    const ordered = (await a.post(api(`/ocall-stock/purchase-orders/${orderId}/order`)).expect(200))
      .body;
    expect(ordered.status).toBe('ORDERED');
    await a
      .patch(api(`/ocall-stock/purchase-orders/${orderId}`))
      .send({ note: 'Trop tard' })
      .expect(409);
    await expect(
      db.stockPurchaseLine.update({ where: { id: lines.paint }, data: { unitCost: 1 } }),
    ).rejects.toThrow(/STOCK_PURCHASE_FROZEN/);

    const pdf = await a
      .get(api(`/ocall-stock/purchase-orders/${orderId}/pdf`))
      .buffer(true)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('réception partielle : entrée en stock, rejouée une seule fois, jamais au-delà du commandé ni hors du site', async () => {
    const k = key();
    const r1 = (
      await receive({
        idempotencyKey: k,
        deliveryRef: 'BL-001',
        lines: [{ orderLineId: lines.paint, quantity: 5, locationId: bin }],
      }).expect(200)
    ).body;
    firstReceipt = r1.receiptId;
    expect(r1).toMatchObject({ status: 'PARTIALLY_RECEIVED', replayed: false });
    expect(r1.receipts[0]).toMatchObject({ label: 'REC-000001', deliveryRef: 'BL-001' });
    expect(await onHand(bin, paint.variantId)).toBe(5);
    const replay = (
      await receive({
        idempotencyKey: k,
        lines: [{ orderLineId: lines.paint, quantity: 5, locationId: bin }],
      }).expect(200)
    ).body;
    expect(replay).toMatchObject({ replayed: true, receiptId: firstReceipt });
    expect(await onHand(bin, paint.variantId)).toBe(5);

    const over = await receive({
      lines: [{ orderLineId: lines.paint, quantity: 8, locationId: bin }],
    }).expect(409);
    expect(over.body.code).toBe('STOCK_RECEIPT_OVER_ORDER');
    const wrongSite = await receive({
      lines: [{ orderLineId: lines.paint, quantity: 1, locationId: otherSiteGeneral }],
    }).expect(400);
    expect(wrongSite.body.code).toBe('STOCK_RECEIPT_SITE');
  });

  it('magasinier : réceptionne sans voir les coûts ; ni bon de commande, ni coût saisi, ni commande', async () => {
    const view = (await keeper.get(api(`/ocall-stock/purchase-orders/${orderId}`)).expect(200))
      .body;
    expect(view.totals).toBeUndefined();
    expect(view.lines[0]).not.toHaveProperty('unitCost');
    await keeper.get(api(`/ocall-stock/purchase-orders/${orderId}/pdf`)).expect(403);
    await receive(
      { lines: [{ orderLineId: lines.paint, quantity: 1, locationId: bin, unitCost: 1 }] },
      keeper,
    ).expect(403);
    await keeper
      .post(api('/ocall-stock/purchase-orders'))
      .send({
        supplierId,
        siteId: site.id,
        lines: [{ variantId: glue.variantId, quantity: 1, unitCost: 1, vatRate: 0 }],
      })
      .expect(403);
  });

  it('réception du reste : commande reçue, coût réel reporté sur l’article, historique des prix', async () => {
    const r2 = (
      await receive({
        updatePurchasePrices: true,
        lines: [
          { orderLineId: lines.paint, quantity: 7, locationId: bin, unitCost: 9500 },
          { orderLineId: lines.glue, quantity: 5, locationId: site.general },
        ],
      }).expect(200)
    ).body;
    secondReceipt = r2.receiptId;
    expect(r2.status).toBe('RECEIVED');
    expect([
      await onHand(bin, paint.variantId),
      await onHand(site.general, glue.variantId),
    ]).toEqual([12, 5]);
    const product = (await a.get(api(`/ocall-stock/products/${paint.productId}`)).expect(200)).body;
    expect(product.purchasePrice).toBe(9500);
    const prices = (
      await a.get(api(`/ocall-stock/variants/${paint.variantId}/purchase-prices`)).expect(200)
    ).body;
    expect(prices.map((p: { unitCost: number }) => p.unitCost)).toEqual([9500, 9000]);
    expect(prices[0].supplier.name).toBe('Grossiste Sahel Distribution');
    // Historique des prix d'achat en ajout seul.
    await expect(
      db.$executeRaw`UPDATE "StockSupplierPrice" SET "unitCost" = 1 WHERE "organizationId" = ${orgA.organizationId}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
    await keeper.get(api(`/ocall-stock/variants/${paint.variantId}/purchase-prices`)).expect(403);
  });

  it('annulation d’une réception : sorties compensatoires, commande rouverte, une seule fois ; refusée si la marchandise est partie', async () => {
    const cancelled = (
      await a
        .post(api(`/ocall-stock/receipts/${secondReceipt}/cancel`))
        .send({ reason: 'Erreur de saisie du BL' })
        .expect(200)
    ).body;
    expect(cancelled.status).toBe('PARTIALLY_RECEIVED');
    expect(cancelled.receipts.find((r: { id: string }) => r.id === secondReceipt)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Erreur de saisie du BL',
    });
    expect([
      await onHand(bin, paint.variantId),
      await onHand(site.general, glue.variantId),
    ]).toEqual([5, 0]);
    expect(
      await db.stockMovement.count({
        where: { organizationId: orgA.organizationId, kind: 'RECEIPT_CANCEL' },
      }),
    ).toBe(2);
    await a
      .post(api(`/ocall-stock/receipts/${secondReceipt}/cancel`))
      .send({ reason: 'Encore' })
      .expect(409);
    // Réception et lignes figées par la base.
    await expect(
      db.$executeRaw`UPDATE "StockReceipt" SET "deliveryRef" = 'X' WHERE id = ${firstReceipt}::uuid`,
    ).rejects.toThrow(/STOCK_RECEIPT_FROZEN/);
    await expect(
      db.stockReceiptLine.deleteMany({ where: { receiptId: firstReceipt } }),
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);

    // Marchandise vendue entre-temps : l'annulation de la première réception (5) est refusée.
    await a
      .post(api('/ocall-stock/movements'))
      .send({
        kind: 'OUT',
        variantId: paint.variantId,
        locationId: bin,
        quantity: 3,
        reason: 'Vente',
        idempotencyKey: key(),
      })
      .expect(201);
    const sold = await a
      .post(api(`/ocall-stock/receipts/${firstReceipt}/cancel`))
      .send({ reason: 'Erreur' })
      .expect(409);
    expect(sold.body.code).toBe('STOCK_INSUFFICIENT');
    expect(await onHand(bin, paint.variantId)).toBe(2);
  });

  it('clôture et annulation : reste non attendu ; annulation impossible après réception', async () => {
    await a.post(api(`/ocall-stock/purchase-orders/${orderId}/cancel`)).expect(409);
    const closed = (await a.post(api(`/ocall-stock/purchase-orders/${orderId}/close`)).expect(200))
      .body;
    expect(closed.status).toBe('CLOSED');
    await receive({ lines: [{ orderLineId: lines.paint, quantity: 1, locationId: bin }] }).expect(
      409,
    );
    const draft = (
      await a
        .post(api('/ocall-stock/purchase-orders'))
        .send({
          supplierId,
          siteId: site.id,
          lines: [{ variantId: glue.variantId, quantity: 2, unitCost: 1500, vatRate: 0 }],
        })
        .expect(201)
    ).body;
    expect(
      (await a.post(api(`/ocall-stock/purchase-orders/${draft.id}/cancel`)).expect(200)).body
        .status,
    ).toBe('CANCELLED');
    const open = (
      await a.get(api('/ocall-stock/purchase-orders')).query({ open: true }).expect(200)
    ).body;
    expect(open).toEqual([]);
  });

  it('retour fournisseur : sortie tracée, rejouée une seule fois, stock insuffisant refusé, ajout seul', async () => {
    const k = key();
    const r = (
      await a
        .post(api('/ocall-stock/supplier-returns'))
        .send({
          supplierId,
          siteId: site.id,
          orderId,
          reason: 'Pots défectueux',
          idempotencyKey: k,
          lines: [{ variantId: paint.variantId, locationId: bin, quantity: 1 }],
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ label: 'RF-000001', replayed: false, reason: 'Pots défectueux' });
    expect(await onHand(bin, paint.variantId)).toBe(1);
    const again = (
      await a
        .post(api('/ocall-stock/supplier-returns'))
        .send({
          supplierId,
          siteId: site.id,
          reason: 'Pots défectueux',
          idempotencyKey: k,
          lines: [{ variantId: paint.variantId, locationId: bin, quantity: 1 }],
        })
        .expect(201)
    ).body;
    expect(again).toMatchObject({ id: r.id, replayed: true });
    expect(await onHand(bin, paint.variantId)).toBe(1);
    const tooMuch = await a
      .post(api('/ocall-stock/supplier-returns'))
      .send({
        supplierId,
        siteId: site.id,
        reason: 'Erreur',
        idempotencyKey: key(),
        lines: [{ variantId: paint.variantId, locationId: bin, quantity: 5 }],
      })
      .expect(409);
    expect(tooMuch.body.code).toBe('STOCK_INSUFFICIENT');
    await keeper
      .post(api('/ocall-stock/supplier-returns'))
      .send({
        supplierId,
        siteId: site.id,
        reason: 'Test',
        idempotencyKey: key(),
        lines: [{ variantId: paint.variantId, locationId: bin, quantity: 1 }],
      })
      .expect(403);
    await expect(
      db.$executeRaw`UPDATE "StockSupplierReturn" SET reason = 'X' WHERE id = ${r.id}::uuid`,
    ).rejects.toThrow(/STOCK_HISTORY_APPEND_ONLY/);
  });

  it('documents joints : PDF vérifié par sa signature, téléchargement, faux PDF refusé, isolation', async () => {
    const doc = (
      await a
        .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`))
        .attach('file', PDF, { filename: '../BL 001.pdf', contentType: 'application/pdf' })
        .expect(201)
    ).body;
    expect(doc).toMatchObject({ fileName: 'BL 001.pdf', mimeType: 'application/pdf' });
    const fake = await a
      .post(api(`/ocall-stock/documents/RECEIPT/${firstReceipt}`))
      .attach('file', Buffer.from('<html>pas un pdf</html>'), {
        filename: 'facture.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(fake.body.code).toBe('STOCK_DOCUMENT_REFUSED');
    // Le magasinier joint un bon de livraison à sa réception.
    await keeper
      .post(api(`/ocall-stock/documents/RECEIPT/${firstReceipt}`))
      .attach('file', PDF, { filename: 'bl.pdf', contentType: 'application/pdf' })
      .expect(201);
    const list = (await a.get(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`)).expect(200))
      .body;
    expect(list).toHaveLength(1);
    const file = await a
      .get(api(`/ocall-stock/documents/${doc.id}`))
      .buffer(true)
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect((file.body as Buffer).equals(PDF)).toBe(true);
    await orgB.agent.get(api(`/ocall-stock/documents/${doc.id}`)).expect(404);
    await orgB.agent
      .post(api(`/ocall-stock/documents/PURCHASE_ORDER/${orderId}`))
      .attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(404);
    await keeper.delete(api(`/ocall-stock/documents/${doc.id}`)).expect(403);
    await a.delete(api(`/ocall-stock/documents/${doc.id}`)).expect(204);
  });

  it('isolation : une autre organisation ne voit ni ne réceptionne rien', async () => {
    const b = orgB.agent;
    await b.get(api(`/ocall-stock/purchase-orders/${orderId}`)).expect(404);
    await receive(
      { lines: [{ orderLineId: lines.paint, quantity: 1, locationId: bin }] },
      b,
    ).expect(404);
    await b
      .post(api(`/ocall-stock/receipts/${firstReceipt}/cancel`))
      .send({ reason: 'Intrusion' })
      .expect(404);
    expect((await b.get(api('/ocall-stock/purchase-orders')).expect(200)).body).toEqual([]);
    expect((await b.get(api('/ocall-stock/supplier-returns')).expect(200)).body).toEqual([]);
  });
});
