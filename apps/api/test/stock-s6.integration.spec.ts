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
 * Ocall Stock — S6 (tableaux de bord) : chiffre d'affaires de la caisse (remboursements déduits),
 * meilleures ventes, marges estimée et brute (CMUP des réceptions, méthodes renvoyées), valeur du stock,
 * achats, écarts d'inventaire, performance par site ; blocs masqués selon les droits ; périmètre des
 * sites ; alertes (rupture, seuil, faible rotation réglable) et compteur ; recherche globale complète
 * (types, pagination, fautes, multi-sites) ; isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);
const key = () => randomUUID().replace(/-/g, '');

(enabled ? describe : describe.skip)('Ocall Stock S6 — tableaux de bord (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let a: Agent;
  let cashier: Agent;
  let manager: Agent;
  let paint: { productId: string; variantId: string; sku: string };
  let glass: { productId: string; variantId: string; sku: string };
  let dormant: { productId: string; variantId: string; sku: string };
  let mag: { id: string; general: string };
  let dep: { id: string; general: string };
  let register: string;
  let saleId: string;

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
        .send({ name, salePrice: 11_800, vatRate: 18, ...extra })
        .expect(201)
    ).body;
    return {
      productId: p.id as string,
      variantId: p.variants[0].id as string,
      sku: p.variants[0].sku as string,
    };
  }

  async function site(code: string, name: string) {
    const s = (
      await a.post(api('/ocall-stock/sites')).send({ code, name, kind: 'STORE' }).expect(201)
    ).body;
    return { id: s.id as string, general: s.locations[0].id as string };
  }

  async function stockIn(variantId: string, locationId: string, quantity: number) {
    await a
      .post(api('/ocall-stock/movements'))
      .send({ kind: 'IN', variantId, locationId, quantity, idempotencyKey: key() })
      .expect(201);
  }

  async function member(role: string, firstName: string, siteIds?: string[]) {
    const created = (
      await a
        .post(api('/ocall-stock/members'))
        .send({ firstName, lastName: 'Rapports', role })
        .expect(201)
    ).body;
    if (siteIds) {
      await a
        .put(api(`/ocall-stock/members/${created.member.id}/sites`))
        .send({ siteIds })
        .expect(200);
    }
    const session = await login(app, created.member.loginId, created.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  /** Commande passée puis reçue en entier (coût unitaire réel). */
  async function purchase(variantId: string, quantity: number, unitCost: number) {
    const supplierId = (
      await a
        .post(api('/ocall-stock/suppliers'))
        .send({ name: `Grossiste ${key().slice(0, 6)}` })
        .expect(201)
    ).body.id;
    const order = (
      await a
        .post(api('/ocall-stock/purchase-orders'))
        .send({
          supplierId,
          siteId: mag.id,
          lines: [{ variantId, quantity, unitCost, vatRate: 18 }],
        })
        .expect(201)
    ).body;
    await a.post(api(`/ocall-stock/purchase-orders/${order.id}/order`)).expect(200);
    return (
      await a
        .post(api(`/ocall-stock/purchase-orders/${order.id}/receive`))
        .send({
          idempotencyKey: key(),
          lines: [{ orderLineId: order.lines[0].id, quantity, locationId: mag.general }],
        })
        .expect(200)
    ).body.receiptId as string;
  }

  const dashboard = (agent: Agent = a, query: Record<string, string> = {}) =>
    agent.get(api('/ocall-stock/reports/dashboard')).query(query);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(OcallStockPrismaService);
    const p = await prisma.saasProduct.findUniqueOrThrow({ where: { code: STOCK_PRODUCT_CODE } });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: p.id,
          name: `Stock S6 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'stockS6A', 'PARK');
    orgB = await signup(app, 'stockS6B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    a = orgA.agent;
    mag = await site('MAG1', 'Magasin Bamako');
    dep = await site('DEP2', 'Dépôt Kati');
    // Peinture : prix d'achat de la fiche 5 500, réceptions 10 × 5 000 et 5 × 8 000 → CMUP 6 000.
    paint = await product('Peinture blanche 5 L', { purchasePrice: 5500, minStock: 20 });
    glass = await product('Vitre claire 4 mm', { salePrice: 5900 });
    dormant = await product('Carrelage gris 60 x 60', { purchasePrice: 3000 });
    await purchase(paint.variantId, 10, 5000);
    await purchase(paint.variantId, 5, 8000);
    // Réception annulée (5 × 20 000) : exclue du CMUP et des réceptions ; commande brouillon : non comptée.
    const wrong = await purchase(paint.variantId, 5, 20_000);
    await a
      .post(api(`/ocall-stock/receipts/${wrong}/cancel`))
      .send({ reason: 'Erreur de saisie du BL' })
      .expect(200);
    const draftSupplier = (
      await a
        .post(api('/ocall-stock/suppliers'))
        .send({ name: 'Fournisseur brouillon' })
        .expect(201)
    ).body.id;
    await a
      .post(api('/ocall-stock/purchase-orders'))
      .send({
        supplierId: draftSupplier,
        siteId: mag.id,
        lines: [{ variantId: paint.variantId, quantity: 1, unitCost: 1, vatRate: 18 }],
      })
      .expect(201);
    await stockIn(glass.variantId, mag.general, 3);
    await stockIn(dormant.variantId, dep.general, 4);
    register = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({ code: 'CAISSE1', name: 'Caisse 1', locationId: mag.general })
        .expect(201)
    ).body.id;
    await a
      .post(api(`/ocall-stock/registers/${register}/sessions`))
      .send({ openingFloat: 0 })
      .expect(201);
    const sale = (
      await a
        .post(api('/ocall-stock/sales'))
        .send({
          idempotencyKey: key(),
          registerId: register,
          lines: [
            { variantId: paint.variantId, quantity: 2 },
            { variantId: glass.variantId, quantity: 2 },
          ],
          payments: [{ method: 'CASH', amount: 2 * 11_800 + 2 * 5900 }],
        })
        .expect(201)
    ).body;
    saleId = sale.id;
    const paintLine = sale.lines.find(
      (l: { variantId: string }) => l.variantId === paint.variantId,
    );
    await a
      .post(api(`/ocall-stock/sales/${saleId}/returns`))
      .send({
        idempotencyKey: key(),
        registerId: register,
        reason: 'Erreur de teinte',
        restock: true,
        refundMethod: 'CASH',
        lines: [{ saleLineId: paintLine.id, quantity: 1 }],
      })
      .expect(201);
    // Le carrelage n'a plus bougé depuis 100 jours.
    await db.stockVariant.update({
      where: { id: dormant.variantId },
      data: { createdAt: new Date(Date.now() - 100 * DAY) },
    });
    cashier = await member('CASHIER', 'Caissier');
    manager = await member('STORE_MANAGER', 'Gerant', [mag.id]);
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

  it('ventes : CA net des remboursements, hors taxe, panier moyen, jours, meilleures ventes', async () => {
    const d = (await dashboard().expect(200)).body;
    const gross = 2 * 11_800 + 2 * 5900;
    expect(d.sales).toMatchObject({
      count: 1,
      revenue: gross,
      revenueHt: 2 * 10_000 + 2 * 5000,
      refunds: 11_800,
      netRevenue: gross - 11_800,
      averageBasket: gross,
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(d.sales.byDay).toEqual([{ day: today, count: 1, revenue: gross }]);
    expect(d.sales.top.map((t: { variantId: string }) => t.variantId)).toEqual([
      glass.variantId,
      paint.variantId,
    ]);
    expect(d.sales.top[1]).toMatchObject({ quantity: 1, revenue: 11_800 });
    // Période sans vente.
    const empty = (await dashboard(a, { from: '2026-01-01', to: '2026-01-31' }).expect(200)).body;
    expect(empty.sales).toMatchObject({ count: 0, revenue: 0, netRevenue: 0, top: [] });
    const bad = await dashboard(a, { from: '2026-02-01', to: '2026-01-01' }).expect(400);
    expect(bad.body.code).toBe('STOCK_REPORT_PERIOD');
    await dashboard(a, { from: '2024-01-01', to: '2026-01-01' }).expect(400);
  });

  it('marges : estimée (prix de la fiche) et brute (CMUP des réceptions), exclusions, méthodes', async () => {
    const d = (await dashboard().expect(200)).body;
    // Lignes nettes : 1 peinture (10 000 HT), 2 vitres (10 000 HT, sans aucun coût).
    expect(d.sales.margins).toMatchObject({
      revenueHt: 20_000,
      estimated: 10_000 - 5500,
      estimatedExcluded: 1,
      gross: 10_000 - 6000,
      grossExcluded: 1,
      grossRate: 20,
      netProfit: null,
    });
    expect(d.methods.grossMargin).toContain('CMUP');
    expect(d.methods.netProfit).toContain('non calculé');
  });

  it('stock, achats et écarts : valeur au CMUP (repli signalé), réceptions, inventaire', async () => {
    let d = (await dashboard().expect(200)).body;
    // Peinture : 15 reçues − 2 vendues + 1 rendue = 14 × 6 000 ; carrelage 4 × 3 000 (fiche) ;
    // vitre (1 restante) : aucun coût, non valorisée.
    expect(d.stock).toMatchObject({
      value: 14 * 6000 + 4 * 3000,
      valuedFromProduct: 1,
      unvalued: 1,
      variants: 3,
    });
    expect(d.purchases).toMatchObject({ orders: 3, receipts: 2, receivedValue: 50_000 + 40_000 });
    expect(d.variances).toMatchObject({ adjustments: 0, surplus: 0, shortage: 0, value: 0 });
    const count = (
      await a
        .post(api('/ocall-stock/counts'))
        .send({ siteId: mag.id, name: 'Contrôle', scope: 'FULL' })
        .expect(201)
    ).body;
    await a
      .put(api(`/ocall-stock/counts/${count.id}/lines`))
      .send({ variantId: paint.variantId, locationId: mag.general, quantity: 12, mode: 'SET' })
      .expect(200);
    await a
      .put(api(`/ocall-stock/counts/${count.id}/lines`))
      .send({ variantId: glass.variantId, locationId: mag.general, quantity: 0, mode: 'SET' })
      .expect(200);
    await a.post(api(`/ocall-stock/counts/${count.id}/validate`)).expect(200);
    d = (await dashboard().expect(200)).body;
    // Peinture 14 → 12 (−2 × 6 000) ; vitre 1 → 0 (sans coût, hors valeur).
    expect(d.variances).toMatchObject({ adjustments: 2, surplus: 0, shortage: 3, value: -12_000 });
    expect(d.stock).toMatchObject({ value: 12 * 6000 + 4 * 3000, unvalued: 0, variants: 2 });
    const bySite = Object.fromEntries(
      d.sites.map((s: { code: string; stockValue: number; revenue: number }) => [s.code, s]),
    );
    expect(bySite.MAG1).toMatchObject({ stockValue: 72_000, revenue: 2 * 11_800 + 2 * 5900 });
    expect(bySite.DEP2).toMatchObject({ stockValue: 12_000, revenue: 0, salesCount: 0 });
  });

  it('droits : un caissier voit ses ventes, jamais les coûts ni les marges ; périmètre des sites', async () => {
    const c = (await dashboard(cashier).expect(200)).body;
    expect(c.sales.count).toBe(1);
    expect(c.sales.margins).toBeNull();
    expect(c.stock.value).toBeNull();
    expect(c.purchases).toBeNull();
    expect(c.variances).toBeNull();
    expect(JSON.stringify(c)).not.toContain('6000');

    // Gérant du seul magasin : le dépôt n'existe pas pour lui.
    const m = (await dashboard(manager).expect(200)).body;
    expect(m.sites.map((s: { code: string }) => s.code)).toEqual(['MAG1']);
    expect(m.stock.value).toBe(72_000);
    await dashboard(manager, { siteId: dep.id }).expect(404);
    const depOnly = (await dashboard(a, { siteId: dep.id }).expect(200)).body;
    expect(depOnly.sales.count).toBe(0);
    expect(depOnly.stock.value).toBe(12_000);
    // Isolation : rien de l'organisation A.
    const b = (await dashboard(orgB.agent).expect(200)).body;
    expect(b.sales.count).toBe(0);
    expect(b.stock.value).toBe(0);
    await dashboard(orgB.agent, { siteId: mag.id }).expect(404);
  });

  it('alertes : rupture, sous le seuil, faible rotation réglable ; compteur du menu', async () => {
    let al = (await a.get(api('/ocall-stock/reports/alerts')).expect(200)).body;
    // Vitre à 0 après l'inventaire : rupture ; peinture 12 ≤ seuil 20 ; carrelage dormant 100 jours.
    expect(al.outOfStock.map((r: { variantId: string }) => r.variantId)).toEqual([glass.variantId]);
    expect(al.low).toEqual([
      expect.objectContaining({
        variantId: paint.variantId,
        available: 12,
        minStock: 20,
        siteName: 'Magasin Bamako',
      }),
    ]);
    expect(al.slowMoving.map((r: { variantId: string }) => r.variantId)).toEqual([
      dormant.variantId,
    ]);
    expect(al.slowMovingDays).toBe(90);
    expect((await a.get(api('/ocall-stock/reports/alerts/count')).expect(200)).body).toEqual({
      count: 2,
    });

    // Seuil de rotation relevé à 120 jours : le carrelage sort de la liste.
    const current = (await a.get(api('/ocall-stock/settings')).expect(200)).body;
    await a
      .put(api('/ocall-stock/settings'))
      .send({
        storeName: current.storeName,
        defaultVatRate: current.defaultVatRate,
        internalCodePrefix: current.internalCodePrefix,
        allowNegativeStock: false,
        slowMovingDays: 120,
      })
      .expect(200);
    await a
      .put(api('/ocall-stock/settings'))
      .send({
        storeName: current.storeName,
        defaultVatRate: current.defaultVatRate,
        internalCodePrefix: current.internalCodePrefix,
        slowMovingDays: 5,
      })
      .expect(400);
    al = (await a.get(api('/ocall-stock/reports/alerts')).expect(200)).body;
    expect(al.slowMoving).toEqual([]);
    // La base refuse aussi un réglage hors bornes.
    await expect(
      db.stockSettings.update({
        where: { organizationId: orgA.organizationId },
        data: { slowMovingDays: 5 },
      }),
    ).rejects.toThrow('StockSettings_slowMovingDays_check');

    // Périmètre : le gérant du magasin ne voit pas le dépôt ; un autre site refusé.
    const m = (await manager.get(api('/ocall-stock/reports/alerts')).expect(200)).body;
    expect(m.counts).toMatchObject({ outOfStock: 1, low: 1 });
    await manager.get(api('/ocall-stock/reports/alerts')).query({ siteId: dep.id }).expect(404);
    expect(
      (await orgB.agent.get(api('/ocall-stock/reports/alerts/count')).expect(200)).body,
    ).toEqual({ count: 0 });
  });

  it('recherche globale : tous les types, fautes tolérées, filtre paginé, multi-sites, droits', async () => {
    const search = (agent: Agent, query: Record<string, string>) =>
      agent.get(api('/ocall-stock/search')).query(query).expect(200);
    // Faute de frappe sur l'article ; disponible par site.
    let r = (await search(a, { q: 'peintre blanche' })).body;
    expect(r.groups.products[0]).toMatchObject({
      id: paint.productId,
      label: 'Peinture blanche 5 L',
    });
    expect(r.stock[paint.productId]).toEqual([{ site: 'MAG1', available: 12 }]);
    // Vente par numéro, commande par numéro, site par code, emplacement par code.
    r = (await search(a, { q: 'VTE-000001' })).body;
    expect(r.groups.sales[0]).toMatchObject({ id: saleId, label: 'VTE-000001' });
    r = (await search(a, { q: 'BC-2' })).body;
    expect(r.groups.orders[0].label).toBe('BC-000002');
    r = (await search(a, { q: 'dep2' })).body;
    expect(r.groups.sites[0]).toMatchObject({ id: dep.id, label: 'Dépôt Kati' });
    r = (await search(a, { q: 'Général' })).body;
    expect(r.groups.locations.map((l: { targetId: string }) => l.targetId).sort()).toEqual(
      [mag.id, dep.id].sort(),
    );
    // Client par nom ou téléphone.
    await a
      .post(api('/ocall-stock/customers'))
      .send({ name: 'Aminata Diarra', phone: '+223 76 12 34 56' })
      .expect(201);
    r = (await search(a, { q: 'aminta' })).body;
    expect(r.groups.customers[0].label).toBe('Aminata Diarra');
    r = (await search(a, { q: '761234' })).body;
    expect(r.groups.customers[0].label).toBe('Aminata Diarra');

    // Filtre par type, paginé (20 par page).
    for (let i = 0; i < 21; i++) {
      await a
        .post(api('/ocall-stock/customers'))
        .send({ name: `Client Pagination ${String(i).padStart(2, '0')}` })
        .expect(201);
    }
    const p0 = (await search(a, { q: 'pagination', type: 'customers' })).body;
    expect(Object.keys(p0.groups)).toEqual(['customers']);
    expect(p0.groups.customers).toHaveLength(20);
    expect(p0.more.customers).toBe(true);
    const p1 = (await search(a, { q: 'pagination', type: 'customers', page: '1' })).body;
    expect(p1.groups.customers).toHaveLength(1);
    expect(p1.more.customers).toBe(false);
    const all = (await search(a, { q: 'pagination', limit: '3' })).body;
    expect(all.groups.customers).toHaveLength(3);
    await a.get(api('/ocall-stock/search')).query({ q: 'x', type: 'invoices' }).expect(400);

    // Droits et périmètre : le gérant du magasin ne trouve pas le dépôt ; isolation.
    const m = (await search(manager, { q: 'dep2' })).body;
    expect(m.groups.sites).toEqual([]);
    const mStock = (await search(manager, { q: 'carrelage' })).body;
    expect(mStock.stock[dormant.productId]).toBeUndefined();
    const c = (await search(cashier, { q: 'BC-1' })).body;
    expect(c.groups.orders).toBeUndefined();
    const b = (await search(orgB.agent, { q: 'peinture' })).body;
    expect(b.groups.products).toEqual([]);
    expect(b.groups.sales).toEqual([]);
  });
});
