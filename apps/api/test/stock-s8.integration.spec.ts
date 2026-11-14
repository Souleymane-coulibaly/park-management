import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/common/storage/storage-provider';
import { OcallStockShowcaseService } from '../src/modules/ocall-stock/ocall-stock-showcase.service';
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
 * Ocall Stock — S8 (IA sur Ocall AI Core, fournisseur simulé) : IA désactivée par défaut, réglages,
 * droits et quotas ; réapprovisionnement (quantités du serveur, déjà commandé déduit, brouillon de
 * commande seulement, rien d'autre ne bouge) ; ruptures (fourchette prudente, jamais « certaine ») ;
 * analyse commerciale (chiffres du tableau de bord seulement) ; fiche depuis une photo (code-barres
 * contrôlé) ; illustration générée (articles sans photo, mention IA, vitrine sur décision) ; réponses
 * malveillantes du modèle refusées ; consommation tracée ; isolation. Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');

(enabled ? describe : describe.skip)('Ocall Stock S8 — IA (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let a: Agent;
  let cashier: Agent;
  let storage: StorageProvider;
  let mag: { id: string; general: string };
  let dep: { id: string; general: string };
  let supplierId: string;
  let paint: { productId: string; variantId: string };
  let cement: { productId: string; variantId: string };
  let bare: { productId: string; variantId: string };
  let category: string;
  let restockProposal: string;

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
        .send({ name, salePrice: 11_800, vatRate: 18, unit: 'pot', ...extra })
        .expect(201)
    ).body;
    return { productId: p.id as string, variantId: p.variants[0].id as string };
  }

  async function move(kind: 'IN' | 'OUT', variantId: string, locationId: string, quantity: number) {
    await a
      .post(api('/ocall-stock/movements'))
      .send({
        kind,
        variantId,
        locationId,
        quantity,
        idempotencyKey: key(),
        ...(kind === 'OUT' ? { reason: 'Vente au comptoir' } : {}),
      })
      .expect(201);
  }

  async function onHand(variantId: string) {
    const rows = await db.stockLevel.findMany({ where: { variantId } });
    return rows.reduce((n, r) => n + r.onHand.toNumber(), 0);
  }

  let lastMemberId = '';
  async function member(
    role: string,
    overrides: { permission: string; granted: boolean }[] = [],
    siteIds: string[] = [],
  ) {
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName: 'Membre', lastName: role, role })
        .expect(201)
    ).body;
    if (overrides.length > 0) {
      await a
        .put(api(`/ocall-stock/members/${created.member.id}/permissions`))
        .send({ overrides })
        .expect(200);
    }
    if (siteIds.length > 0) {
      await a
        .put(api(`/ocall-stock/members/${created.member.id}/sites`))
        .send({ siteIds })
        .expect(200);
    }
    lastMemberId = created.member.id;
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  const settings = (agent: Agent, over: Record<string, unknown> = {}) =>
    agent.put(api('/ocall-stock/ai/settings')).send({
      enabled: true,
      restockEnabled: true,
      stockoutEnabled: true,
      analysisEnabled: true,
      photoEnabled: true,
      illustrationEnabled: true,
      restockMonthlyLimit: 50,
      stockoutMonthlyLimit: 50,
      analysisMonthlyLimit: 30,
      photoMonthlyLimit: 100,
      illustrationMonthlyLimit: 20,
      ...over,
    });

  const usage = (feature: string) =>
    db.stockAiUsage.count({ where: { organizationId: orgA.organizationId, feature } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);
    const p = await prisma.saasProduct.findUniqueOrThrow({ where: { code: STOCK_PRODUCT_CODE } });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: p.id,
          name: `Stock S8 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockS8A', 'PARK');
    orgB = await signup(app, 'stockS8B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    a = orgA.agent;
    const site = async (code: string, name: string) => {
      const s = (
        await a.post(api('/ocall-stock/sites')).send({ code, name, kind: 'STORE' }).expect(201)
      ).body;
      return { id: s.id as string, general: s.locations[0].id as string };
    };
    mag = await site('MAG1', 'Magasin Bamako');
    dep = await site('DEP2', 'Dépôt Kati');
    supplierId = (
      await a
        .post(api('/ocall-stock/suppliers'))
        .send({ name: 'Grossiste Sahel', leadTimeDays: 7 })
        .expect(201)
    ).body.id;
    category = (
      await a.post(api('/ocall-stock/categories')).send({ name: 'Peintures' }).expect(201)
    ).body.id;
    paint = await product('Peinture blanche 5 L', { purchasePrice: 5500, categoryId: category });
    cement = await product('Ciment 50 kg', { unit: 'sac' });
    bare = await product('Vernis incolore', { unit: 'pot' });
    // Peinture : 60 entrées + 10 reçues du fournisseur (prix 5 000), 63 sorties → 7 disponibles ;
    // 2 encore commandées (non reçues).
    await move('IN', paint.variantId, mag.general, 60);
    const order = (
      await a
        .post(api('/ocall-stock/purchase-orders'))
        .send({
          supplierId,
          siteId: mag.id,
          lines: [{ variantId: paint.variantId, quantity: 10, unitCost: 5000, vatRate: 18 }],
        })
        .expect(201)
    ).body;
    await a.post(api(`/ocall-stock/purchase-orders/${order.id}/order`)).expect(200);
    await a
      .post(api(`/ocall-stock/purchase-orders/${order.id}/receive`))
      .send({
        idempotencyKey: key(),
        lines: [{ orderLineId: order.lines[0].id, quantity: 10, locationId: mag.general }],
      })
      .expect(200);
    const pending = (
      await a
        .post(api('/ocall-stock/purchase-orders'))
        .send({
          supplierId,
          siteId: mag.id,
          lines: [{ variantId: paint.variantId, quantity: 2, unitCost: 5000, vatRate: 18 }],
        })
        .expect(201)
    ).body;
    await a.post(api(`/ocall-stock/purchase-orders/${pending.id}/order`)).expect(200);
    await move('OUT', paint.variantId, mag.general, 63);
    // Ciment : 10 entrés, 8 sortis (rythme récent) → 2 disponibles.
    await move('IN', cement.variantId, mag.general, 10);
    await move('OUT', cement.variantId, mag.general, 8);

    cashier = await member('CASHIER');
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

  it('désactivée par défaut ; réglages réservés à l’administrateur ; droits des assistants', async () => {
    const initial = (await a.get(api('/ocall-stock/ai/settings')).expect(200)).body;
    expect(initial).toMatchObject({
      enabled: false,
      configured: true,
      ceilings: { monthlyCeiling: 150, imageMonthlyCeiling: 20 },
    });
    const off = await a
      .post(api('/ocall-stock/ai/restock'))
      .send({ siteId: mag.id, supplierId })
      .expect(403);
    expect(off.body.code).toBe('AI_STOCK_DISABLED');
    await settings(cashier).expect(403);
    await settings(a).expect(200);
    await cashier
      .post(api('/ocall-stock/ai/restock'))
      .send({ siteId: mag.id, supplierId })
      .expect(403);
    await cashier.post(api('/ocall-stock/ai/product-photo')).expect(403);
    // Fonctionnalité désactivée : refusée sans appel.
    await settings(a, { restockEnabled: false }).expect(200);
    expect(
      (
        await a
          .post(api('/ocall-stock/ai/restock'))
          .send({ siteId: mag.id, supplierId })
          .expect(403)
      ).body.code,
    ).toBe('AI_FEATURE_DISABLED');
    await settings(a).expect(200);
    expect(await usage('STOCK_RESTOCK')).toBe(0);
  });

  it('réapprovisionnement : quantités du serveur, déjà commandé déduit, brouillon de commande seulement', async () => {
    const before = await onHand(paint.variantId);
    const res = (
      await a
        .post(api('/ocall-stock/ai/restock'))
        .send({ siteId: mag.id, supplierId, coverDays: 14 })
        .expect(200)
    ).body;
    // 63 sorties / 90 j = 0,7 par jour × (7 + 14) = 14,7 − 7 disponibles − 2 commandés = 5,7 → 6.
    expect(res).toMatchObject({ scope: 'SUPPLIER', leadTimeDays: 7, leadAssumed: false });
    expect(res.lines).toEqual([
      expect.objectContaining({
        variantId: paint.variantId,
        quantity: 6,
        available: 7,
        incoming: 2,
        unitCost: 5000,
        priority: 'HIGH',
      }),
    ]);
    expect(res.proposal).toMatchObject({ feature: 'STOCK_RESTOCK', status: 'PROPOSED' });
    restockProposal = res.proposal.id;
    const usageRow = await db.stockAiUsage.findFirstOrThrow({
      where: { organizationId: orgA.organizationId, feature: 'STOCK_RESTOCK' },
    });
    expect(usageRow).toMatchObject({
      status: 'SUCCEEDED',
      promptId: 'stock.restock',
      promptVersion: 1,
    });
    // Rien n'a bougé : ni stock ni commande.
    expect(await onHand(paint.variantId)).toBe(before);
    const drafts = await db.stockPurchaseOrder.count({
      where: { organizationId: orgA.organizationId, status: 'DRAFT' },
    });
    expect(drafts).toBe(0);

    // Seuls les articles de la suggestion ; puis brouillon avec la quantité corrigée.
    await a
      .post(api(`/ocall-stock/ai/proposals/${restockProposal}/apply`))
      .send({ lines: [{ variantId: cement.variantId, quantity: 3 }] })
      .expect(400);
    // Utiliser l'assistant ne suffit pas : créer la commande exige le droit de gérer les achats.
    const noPurchases = await member('STORE_MANAGER', [
      { permission: 'stock.purchases.manage', granted: false },
    ]);
    await noPurchases
      .post(api(`/ocall-stock/ai/proposals/${restockProposal}/apply`))
      .send({ lines: [{ variantId: paint.variantId, quantity: 8 }] })
      .expect(403);
    const applied = (
      await a
        .post(api(`/ocall-stock/ai/proposals/${restockProposal}/apply`))
        .send({ lines: [{ variantId: paint.variantId, quantity: 8 }] })
        .expect(200)
    ).body;
    expect(applied).toMatchObject({ status: 'APPLIED', edited: true });
    const order = await db.stockPurchaseOrder.findFirstOrThrow({
      where: { organizationId: orgA.organizationId, id: applied.resultId },
      include: { lines: true },
    });
    expect(order).toMatchObject({ status: 'DRAFT', supplierId, siteId: mag.id });
    expect(order.lines.map((l) => [l.variantId, l.quantity.toNumber(), l.unitCost])).toEqual([
      [paint.variantId, 8, 5000],
    ]);
    expect(await onHand(paint.variantId)).toBe(before);
    await a
      .post(api(`/ocall-stock/ai/proposals/${restockProposal}/apply`))
      .send({})
      .expect(409);
    // Une seule commande par suggestion, même appliquée deux fois.
    expect(
      await db.stockPurchaseOrder.count({
        where: { organizationId: orgA.organizationId, status: 'DRAFT' },
      }),
    ).toBe(1);

    // Aucun article à commander (dépôt sans sortie) : aucune consommation d'IA.
    const calls = await usage('STOCK_RESTOCK');
    const empty = (
      await a.post(api('/ocall-stock/ai/restock')).send({ siteId: dep.id, supplierId }).expect(200)
    ).body;
    expect(empty).toMatchObject({ proposal: null, lines: [] });
    expect(await usage('STOCK_RESTOCK')).toBe(calls);
  });

  it('réponse du modèle avec un chiffre inventé : refusée, consommation tracée en échec', async () => {
    const forged = await product(
      'OCALL-SIM:{"summary":"Commander","lines":[{"ref":"r1","priority":"HIGH","reason":"Commander 999 unités tout de suite"}]}:FIN',
    );
    await move('IN', forged.variantId, dep.general, 5);
    await move('OUT', forged.variantId, dep.general, 5);
    // Fournisseur sans historique : tous les articles qui sortent du dépôt sont considérés.
    const fresh = (
      await a.post(api('/ocall-stock/suppliers')).send({ name: 'Nouveau fournisseur' }).expect(201)
    ).body.id;
    const refused = await a
      .post(api('/ocall-stock/ai/restock'))
      .send({ siteId: dep.id, supplierId: fresh })
      .expect(502);
    expect(refused.body.code).toBe('AI_INVALID_OUTPUT');
    expect(
      await db.stockAiUsage.count({
        where: {
          organizationId: orgA.organizationId,
          status: 'FAILED',
          errorCode: 'AI_INVALID_OUTPUT',
        },
      }),
    ).toBe(1);
    await a
      .patch(api(`/ocall-stock/products/${forged.productId}`))
      .send({ isArchived: true })
      .expect(200);
  });

  it('ruptures : fourchette prudente, risque selon le délai, jamais annoncée comme certaine', async () => {
    // Article qui sort peu : aucun risque, absent de la prévision.
    const calm = await product('Pinceau plat 50 mm');
    await move('IN', calm.variantId, mag.general, 100);
    await move('OUT', calm.variantId, mag.general, 1);
    const res = (
      await a.post(api('/ocall-stock/ai/stockouts')).send({ siteId: mag.id }).expect(200)
    ).body;
    const byVariant = Object.fromEntries(
      res.items.map((i: { variantId: string }) => [i.variantId, i]),
    );
    // Ciment : 2 disponibles, 8 sortis sur 30 j → entre 7 et 22 jours ; délai supposé 7 j : élevé.
    expect(byVariant[cement.variantId]).toMatchObject({
      available: 2,
      daysMin: 7,
      daysMax: 22,
      risk: 'HIGH',
      leadAssumed: true,
    });
    // Peinture : 7 disponibles, 63 sorties récentes (2,1 par jour sur 30 j, 0,7 sur 90 j) → entre 3 et
    // 10 jours ; délai 7 j : élevé.
    expect(byVariant[paint.variantId]).toMatchObject({
      daysMin: 3,
      daysMax: 10,
      risk: 'HIGH',
      leadAssumed: false,
    });
    expect(byVariant[calm.variantId]).toBeUndefined();
    expect(byVariant[cement.variantId].explanation).toContain('Risque de rupture');
    expect(res.proposal).toMatchObject({ feature: 'STOCK_STOCKOUT' });
    // Rien à appliquer : une prévision se consulte.
    expect(
      (
        await a
          .post(api(`/ocall-stock/ai/proposals/${res.proposal.id}/apply`))
          .send({})
          .expect(409)
      ).body.code,
    ).toBe('STOCK_AI_NOT_APPLICABLE');

    const certain = await product(
      'OCALL-SIM:{"summary":"Alerte","items":[{"ref":"s1","explanation":"Rupture certaine la semaine prochaine"}]}:FIN',
    );
    await move('IN', certain.variantId, dep.general, 3);
    await move('OUT', certain.variantId, dep.general, 2);
    expect(
      (await a.post(api('/ocall-stock/ai/stockouts')).send({ siteId: dep.id }).expect(502)).body
        .code,
    ).toBe('AI_INVALID_OUTPUT');
    await a
      .patch(api(`/ocall-stock/products/${certain.productId}`))
      .send({ isArchived: true })
      .expect(200);
  });

  it('analyse commerciale : indicateurs du tableau de bord seulement ; sans vente, rien à analyser', async () => {
    const none = await a.post(api('/ocall-stock/ai/analysis')).send({}).expect(409);
    expect(none.body.code).toBe('STOCK_AI_ANALYSIS_EMPTY');
    const register = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: mag.general })
        .expect(201)
    ).body.id;
    await a
      .post(api(`/ocall-stock/registers/${register}/sessions`))
      .send({ openingFloat: 0 })
      .expect(201);
    await a
      .post(api('/ocall-stock/sales'))
      .send({
        idempotencyKey: key(),
        registerId: register,
        lines: [{ variantId: paint.variantId, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 11_800 }],
      })
      .expect(201);
    const res = (await a.post(api('/ocall-stock/ai/analysis')).send({}).expect(200)).body;
    expect(res.summary).toBeTruthy();
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect(res.facts.join('\n')).toContain('Chiffre d’affaires net : 11800 FCFA');
    expect(res.proposal).toMatchObject({ feature: 'STOCK_ANALYSIS' });
  });

  it('fiche depuis une photo : catégorie connue, code-barres contrôlé, rattachée à l’article créé', async () => {
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#e0e0e0' },
    })
      .png()
      .toBuffer();
    const res = (
      await a
        .post(api('/ocall-stock/ai/product-photo'))
        .attach('file', photo, { filename: 'emballage.png', contentType: 'image/png' })
        .expect(200)
    ).body;
    expect(res).toMatchObject({
      readable: true,
      name: 'Peinture glycéro brillante',
      brand: 'Seigneurie',
      size: '1 L',
      category: { id: category, name: 'Peintures' },
      barcode: '4006381333931',
      barcodeRejected: false,
      existingProduct: null,
    });
    await a
      .post(api('/ocall-stock/ai/product-photo'))
      .attach('file', Buffer.from('pas une image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    const created = await product('Peinture glycéro brillante 1 L', { categoryId: category });
    const applied = (
      await a
        .post(api(`/ocall-stock/ai/proposals/${res.proposal.id}/apply`))
        .send({ productId: created.productId })
        .expect(200)
    ).body;
    expect(applied).toMatchObject({ status: 'APPLIED', resultId: created.productId, edited: true });
    await a.post(api(`/ocall-stock/ai/proposals/${res.proposal.id}/reject`)).expect(409);

    // Code-barres dont la clé GTIN est fausse : jamais repris, signalé.
    const trap = (
      await a
        .post(api('/ocall-stock/categories'))
        .send({ name: 'OCALL-SIM:{"readable":true,"name":"Colle","barcode":"4006381333932"}:FIN' })
        .expect(201)
    ).body.id;
    const wrong = (
      await a
        .post(api('/ocall-stock/ai/product-photo'))
        .attach('file', photo, { filename: 'emballage.png', contentType: 'image/png' })
        .expect(200)
    ).body;
    expect(wrong).toMatchObject({
      readable: true,
      name: 'Colle',
      barcode: null,
      barcodeRejected: true,
    });
    await a
      .patch(api(`/ocall-stock/categories/${trap}`))
      .send({ isArchived: true })
      .expect(200);
  });

  it('illustration : article sans photo, aperçu, mention IA, vitrine sur décision, quota propre', async () => {
    const first = (
      await a.post(api(`/ocall-stock/ai/products/${bare.productId}/illustration`)).expect(200)
    ).body.proposal;
    expect(first).toMatchObject({ feature: 'STOCK_ILLUSTRATION', status: 'PROPOSED' });
    expect(first.output).not.toHaveProperty('storageKey');
    const preview = await a.get(api(`/ocall-stock/ai/proposals/${first.id}/image`)).expect(200);
    expect(preview.headers['content-type']).toBe('image/jpeg');
    const storageKey = async (id: string) =>
      (
        (await db.stockAiProposal.findUniqueOrThrow({ where: { id } })).output as {
          storageKey: string;
        }
      ).storageKey;
    const firstKey = await storageKey(first.id);
    expect(await storage.get(firstKey)).not.toBeNull();
    // Refusée : l'image est supprimée.
    await a.post(api(`/ocall-stock/ai/proposals/${first.id}/reject`)).expect(200);
    await a.get(api(`/ocall-stock/ai/proposals/${first.id}/image`)).expect(404);
    expect(await storage.get(firstKey)).toBeNull();
    // Refusée, même si le fichier subsiste : plus d'aperçu.
    const kept = (
      await a.post(api(`/ocall-stock/ai/products/${bare.productId}/illustration`)).expect(200)
    ).body.proposal;
    await db.stockAiProposal.update({
      where: { id: kept.id },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    const keptKey = await storageKey(kept.id);
    expect(await storage.get(keptKey)).not.toBeNull();
    await a.get(api(`/ocall-stock/ai/proposals/${kept.id}/image`)).expect(404);
    await storage.delete(keptKey);

    const second = (
      await a.post(api(`/ocall-stock/ai/products/${bare.productId}/illustration`)).expect(200)
    ).body.proposal;
    const applied = (
      await a
        .post(api(`/ocall-stock/ai/proposals/${second.id}/apply`))
        .send({ showcase: false })
        .expect(200)
    ).body;
    const image = await db.stockProductImage.findUniqueOrThrow({ where: { id: applied.resultId } });
    expect(image).toMatchObject({
      aiGenerated: true,
      showcaseApproved: false,
      productId: bare.productId,
    });
    const detail = (await a.get(api(`/ocall-stock/products/${bare.productId}`)).expect(200)).body;
    expect(detail.images).toEqual([
      expect.objectContaining({ id: image.id, aiGenerated: true, showcaseApproved: false }),
    ]);
    // Vitrine : l'illustration refusée à la vitrine n'est jamais servie, même article publié.
    const showcase = app.get(OcallStockShowcaseService);
    const online = jest
      .spyOn(showcase as unknown as { onlineOrg: () => Promise<unknown> }, 'onlineOrg')
      .mockResolvedValue({ showCatalog: true });
    try {
      await db.stockProduct.update({
        where: { id: bare.productId },
        data: { showcasePublished: true },
      });
      expect(await showcase.publicProductImage(image.id)).toBeNull();
      await db.stockProductImage.update({
        where: { id: image.id },
        data: { showcaseApproved: true },
      });
      expect(await showcase.publicProductImage(image.id)).toBeInstanceOf(Buffer);
    } finally {
      online.mockRestore();
      await db.stockProductImage.update({
        where: { id: image.id },
        data: { showcaseApproved: false },
      });
      await db.stockProduct.update({
        where: { id: bare.productId },
        data: { showcasePublished: false },
      });
    }
    // L'article a désormais une photo : plus d'illustration.
    expect(
      (await a.post(api(`/ocall-stock/ai/products/${bare.productId}/illustration`)).expect(409))
        .body.code,
    ).toBe('STOCK_AI_ILLUSTRATION_HAS_PHOTO');
    // Une photo réelle est toujours visible sur la vitrine (contrôlé par la base).
    await expect(
      db.stockProductImage.update({
        where: { id: image.id },
        data: { aiGenerated: false },
      }),
    ).rejects.toThrow('StockProductImage_showcase_check');

    // Quota propre des illustrations : plafond atteint → refus, aucune image générée.
    await settings(a, { illustrationMonthlyLimit: 2 }).expect(200);
    const other = await product('Diluant 1 L');
    const quota = await a
      .post(api(`/ocall-stock/ai/products/${other.productId}/illustration`))
      .expect(429);
    expect(quota.body.code).toBe('AI_QUOTA_EXCEEDED');
    // Plafond Ocall des images (20), plus bas que celui des textes : un réglage plus haut n'y change rien.
    await settings(a, { illustrationMonthlyLimit: 100 }).expect(200);
    const done = await usage('STOCK_ILLUSTRATION');
    await db.stockAiUsage.createMany({
      data: Array.from({ length: 20 - done }, () => ({
        organizationId: orgA.organizationId,
        actorUserId: randomUUID(),
        feature: 'STOCK_ILLUSTRATION',
        provider: 'simulated',
        model: 'simulated',
        status: 'SUCCEEDED',
      })),
    });
    expect(
      (await a.post(api(`/ocall-stock/ai/products/${other.productId}/illustration`)).expect(429))
        .body.code,
    ).toBe('AI_QUOTA_EXCEEDED');
  });

  it('propositions : sites du membre, droit des ventes et coûts d’achat respectés', async () => {
    const mine = (await a.get(api('/ocall-stock/ai/proposals')).expect(200)).body as {
      id: string;
      feature: string;
      output: { lines?: { unitCost?: number }[] };
    }[];
    const restock = mine.find((p) => p.id === restockProposal)!;
    expect(restock.output.lines![0]).toHaveProperty('unitCost', 5000);
    const analysis = mine.find((p) => p.feature === 'STOCK_ANALYSIS')!;
    // Responsable du seul dépôt : rien du magasin ni de toute l'organisation ; les images du catalogue, si.
    const depOnly = await member('STORE_MANAGER', [], [dep.id]);
    const seen = (await depOnly.get(api('/ocall-stock/ai/proposals')).expect(200)).body as {
      id: string;
      feature: string;
    }[];
    expect(seen.map((p) => p.id)).not.toContain(restockProposal);
    expect(seen.map((p) => p.id)).not.toContain(analysis.id);
    expect(seen.filter((p) => p.feature === 'STOCK_STOCKOUT')).toEqual([]);
    expect(seen.some((p) => p.feature === 'STOCK_ILLUSTRATION')).toBe(true);
    await depOnly.post(api(`/ocall-stock/ai/proposals/${restockProposal}/reject`)).expect(404);
    await depOnly.post(api(`/ocall-stock/ai/proposals/${analysis.id}/reject`)).expect(404);
    // Sans droit de voir les prix d'achat : suggestion visible, coûts retirés ; analyse avec marges cachée.
    const noCosts = await member('STORE_MANAGER', [
      { permission: 'stock.prices.purchase.read', granted: false },
    ]);
    const blind = (await noCosts.get(api('/ocall-stock/ai/proposals')).expect(200)).body as {
      id: string;
      output: { lines?: Record<string, unknown>[] };
    }[];
    const blindRestock = blind.find((p) => p.id === restockProposal)!;
    expect(blindRestock.output.lines![0]).toMatchObject({
      variantId: paint.variantId,
      quantity: 6,
    });
    expect(blindRestock.output.lines![0]).not.toHaveProperty('unitCost');
    expect(blind.map((p) => p.id)).not.toContain(analysis.id);
    // Sans droit de consulter les ventes (prix d'achat visibles) : analyse cachée, suggestion visible.
    const blindId = lastMemberId;
    await a
      .put(api(`/ocall-stock/members/${blindId}/permissions`))
      .send({ overrides: [{ permission: 'stock.sales.read', granted: false }] })
      .expect(200);
    const noSales = (await noCosts.get(api('/ocall-stock/ai/proposals')).expect(200)).body as {
      id: string;
    }[];
    expect(noSales.map((p) => p.id)).toContain(restockProposal);
    expect(noSales.map((p) => p.id)).not.toContain(analysis.id);
    await noCosts.post(api(`/ocall-stock/ai/proposals/${analysis.id}/reject`)).expect(404);
    await a
      .put(api(`/ocall-stock/members/${blindId}/permissions`))
      .send({ overrides: [{ permission: 'stock.prices.purchase.read', granted: false }] })
      .expect(200);
    const fresh = (
      await noCosts
        .post(api('/ocall-stock/ai/restock'))
        .send({ siteId: mag.id, supplierId, coverDays: 30 })
        .expect(200)
    ).body;
    expect(fresh.lines.length).toBeGreaterThan(0);
    expect(fresh.lines[0]).not.toHaveProperty('unitCost');
    expect(fresh.proposal.output.lines[0]).not.toHaveProperty('unitCost');
  });

  it('isolation : propositions, aperçus et décisions limités à l’organisation', async () => {
    await orgB.agent.post(api(`/ocall-stock/ai/proposals/${restockProposal}/reject`)).expect(404);
    expect((await orgB.agent.get(api('/ocall-stock/ai/proposals')).expect(200)).body).toEqual([]);
    const mine = (await a.get(api('/ocall-stock/ai/proposals')).expect(200)).body;
    expect(mine.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(mine)).not.toContain('storageKey');
    await settings(orgB.agent).expect(200);
    // Site et fournisseur d'une autre organisation : introuvables, aucun appel d'IA.
    await orgB.agent
      .post(api('/ocall-stock/ai/restock'))
      .send({ siteId: mag.id, supplierId })
      .expect(404);
    await orgB.agent.post(api('/ocall-stock/ai/stockouts')).send({ siteId: mag.id }).expect(404);
    await orgB.agent
      .post(api(`/ocall-stock/ai/products/${paint.productId}/illustration`))
      .expect(404);
    expect(await db.stockAiUsage.count({ where: { organizationId: orgB.organizationId } })).toBe(0);
  });
});
