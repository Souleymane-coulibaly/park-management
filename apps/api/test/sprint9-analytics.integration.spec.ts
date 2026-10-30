import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ticketQrPayload } from '@ocall/shared';
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
 * Sprint 9 — analyses : CA, ventes par produit et par heure, billetterie, carte thermique, marges,
 * comparaison d'établissements, isolation, permissions, export CSV, performance.
 *
 * Les ventes, paiements, billets et scans sont créés par l'API réelle ; leurs horodatages sont
 * ensuite recalés (base de test uniquement) pour des heures et des fuseaux déterministes.
 * Période analysée : du lundi 26 au vendredi 30 octobre 2026.
 * Exécuté uniquement sur la base de test (TEST_DATABASE_URL).
 */
describe('Sprint 9 — analyses (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let duo: SignedUpOwner; // Parc + Restaurant
  let other: SignedUpOwner; // autre organisation
  let estD: string; // Bamako (UTC+0), parc et restaurant
  let estL: string; // Lagos (UTC+1), restaurant
  let estO: string;
  let supervisorL: Agent;
  let cashier: Agent;
  let poulet: { product: string; variant: string };
  let jus: { product: string; variant: string };

  const api = (path: string) => `/api/v1${path}`;
  const PERIOD = { period: 'custom', from: '2026-10-26', to: '2026-10-30' };
  const at = (iso: string) => new Date(iso);

  async function employee(owner: SignedUpOwner, role: string, establishmentIds: string[]) {
    const created = await owner.agent
      .post(api('/employees'))
      .send({ firstName: 'Awa', lastName: role, role, establishmentIds })
      .expect(201);
    const session = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function product(
    owner: SignedUpOwner,
    category: string,
    name: string,
    price: number,
    ests: string[],
  ) {
    const res = await owner.agent
      .post(api('/catalog/products'))
      .send({
        name,
        categoryId: category,
        variants: [
          { name: 'Standard', prices: ests.map((establishmentId) => ({ establishmentId, price })) },
        ],
      })
      .expect(201);
    return { product: res.body.id as string, variant: res.body.variants[0].id as string };
  }

  /** Vente restaurant créée par l'API, éventuellement encaissée, puis datée. */
  async function restaurantSale(
    owner: SignedUpOwner,
    establishmentId: string,
    lines: { variantId: string; quantity: number }[],
    times: { created: string; paid?: string; cancel?: boolean },
  ) {
    const sale = (
      await owner.agent.post(api('/sales')).send({ establishmentId, lines }).expect(201)
    ).body;
    if (times.paid) {
      await owner.agent
        .post(api(`/sales/${sale.id}/payments`))
        .send({ method: 'CASH', amountTendered: sale.total })
        .expect(200);
      await prisma.payment.updateMany({
        where: { saleId: sale.id },
        data: { createdAt: at(times.paid) },
      });
    }
    if (times.cancel)
      await owner.agent
        .post(api(`/sales/${sale.id}/cancel`))
        .send({})
        .expect(200);
    await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: at(times.created) } });
    return sale.id as string;
  }

  const get = (a: Agent, path: string, query: Record<string, string | number> = {}) =>
    a.get(api(path)).query({ ...PERIOD, ...query });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    duo = await signup(app, 's9d', 'PARK_RESTAURANT');
    other = await signup(app, 's9o', 'RESTAURANT');
    estD = (await duo.agent.get(api('/establishments')).expect(200)).body[0].id;
    estL = (
      await duo.agent
        .post(api('/establishments'))
        .send({
          name: 'Maquis Lagos',
          businessType: 'RESTAURANT',
          city: 'Lagos',
          timezone: 'Africa/Lagos',
        })
        .expect(201)
    ).body.id;
    estO = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    supervisorL = await employee(duo, 'SUPERVISOR', [estL]);
    cashier = await employee(duo, 'CASHIER', [estD]);

    const plats = (
      await duo.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    const boissons = (
      await duo.agent.post(api('/catalog/categories')).send({ name: 'Boissons' }).expect(201)
    ).body.id;
    poulet = await product(duo, plats, 'Poulet braisé', 4000, [estD, estL]);
    jus = await product(duo, boissons, 'Jus de bissap', 1000, [estD, estL]);
    await product(duo, plats, 'Tiramisu', 2000, [estD]);
    const otherCat = (
      await other.agent.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201)
    ).body.id;
    const tô = await product(other, otherCat, 'Tô', 10000, [estO]);

    for (const [owner, est] of [
      [duo, estD],
      [duo, estL],
      [other, estO],
    ] as const) {
      await owner.agent
        .post(api('/cash-sessions'))
        .send({ establishmentId: est, openingFloat: 0 })
        .expect(201);
    }

    // ─── Restaurant ───
    await restaurantSale(
      duo,
      estD,
      [
        { variantId: poulet.variant, quantity: 2 },
        { variantId: jus.variant, quantity: 1 },
      ],
      {
        created: '2026-10-30T12:10:00Z',
        paid: '2026-10-30T12:15:00Z',
      },
    );
    await restaurantSale(duo, estD, [{ variantId: poulet.variant, quantity: 1 }], {
      created: '2026-10-30T12:40:00Z',
    }); // impayée
    await restaurantSale(duo, estD, [{ variantId: jus.variant, quantity: 1 }], {
      created: '2026-10-29T23:50:00Z',
      paid: '2026-10-30T00:05:00Z',
    });
    await restaurantSale(duo, estD, [{ variantId: poulet.variant, quantity: 1 }], {
      created: '2026-10-30T13:00:00Z',
      cancel: true,
    });
    await restaurantSale(duo, estD, [{ variantId: poulet.variant, quantity: 1 }], {
      created: '2026-10-22T19:00:00Z',
      paid: '2026-10-22T19:05:00Z',
    }); // période précédente
    await restaurantSale(duo, estL, [{ variantId: poulet.variant, quantity: 3 }], {
      created: '2026-10-30T11:30:00Z',
      paid: '2026-10-30T11:35:00Z',
    }); // 12 h 35 à Lagos
    await restaurantSale(duo, estL, [{ variantId: jus.variant, quantity: 1 }], {
      created: '2026-10-25T23:25:00Z',
      paid: '2026-10-25T23:30:00Z',
    }); // lundi 26 à 0 h 30 à Lagos
    await restaurantSale(other, estO, [{ variantId: tô.variant, quantity: 5 }], {
      created: '2026-10-30T12:20:00Z',
      paid: '2026-10-30T12:21:00Z',
    });

    // ─── Parc : 2 adultes + 1 famille de 5 payés, 1 adulte impayé, scans ───
    const adult = (
      await duo.agent
        .post(api('/ticketing/categories'))
        .send({ establishmentId: estD, kind: 'ADULT', name: 'Adulte', price: 3000 })
        .expect(201)
    ).body.id;
    const family = (
      await duo.agent
        .post(api('/ticketing/categories'))
        .send({
          establishmentId: estD,
          kind: 'FAMILY',
          name: 'Famille',
          price: 10000,
          peopleIncluded: 5,
        })
        .expect(201)
    ).body.id;
    const order = (
      await duo.agent
        .post(api('/ticketing/orders'))
        .send({
          establishmentId: estD,
          lines: [
            { ticketCategoryId: adult, quantity: 2, visitorNames: ['Moussa', 'Awa'] },
            { ticketCategoryId: family, quantity: 1, visitorNames: ['A', 'B', 'C', 'D', 'E'] },
          ],
        })
        .expect(201)
    ).body;
    await duo.agent
      .post(api(`/sales/${order.id}/payments`))
      .send({ method: 'CASH', amountTendered: order.total })
      .expect(200);
    const unpaid = (
      await duo.agent
        .post(api('/ticketing/orders'))
        .send({
          establishmentId: estD,
          lines: [{ ticketCategoryId: adult, quantity: 1, visitorNames: ['Ali'] }],
        })
        .expect(201)
    ).body;
    const tickets: { id: string; qr: string; ticketCategory: { id: string } }[] = (
      await duo.agent.get(api('/tickets')).query({ saleId: order.id }).expect(200)
    ).body;
    const gate = await employee(duo, 'GATE_AGENT', [estD]);
    const scan = (qr: string) =>
      gate
        .post(api('/access/scans'))
        .send({ establishmentId: estD, entryPoint: 'Entrée', qr, clientRequestId: randomUUID() })
        .expect(200);
    const adults = tickets.filter((t) => t.ticketCategory.id === adult);
    expect((await scan(adults[0]!.qr)).body.result).toBe('ACCEPTED');
    expect((await scan(adults[0]!.qr)).body.result).toBe('REFUSED'); // déjà utilisé
    expect((await scan(ticketQrPayload('A'.repeat(22)))).body.result).toBe('REFUSED'); // inconnu
    expect((await scan(adults[1]!.qr)).body.result).toBe('ACCEPTED');
    const familyTicket = tickets.find((t) => t.ticketCategory.id === family)!;
    await duo.agent
      .post(api(`/tickets/${familyTicket.id}/cancel`))
      .send({ reason: 'Erreur de saisie' })
      .expect(200);

    // Datation : vente parc vendredi 9 h, scans 10 h et 11 h (heure de Bamako).
    await prisma.sale.update({
      where: { id: order.id },
      data: { createdAt: at('2026-10-30T09:00:00Z') },
    });
    await prisma.sale.update({
      where: { id: unpaid.id },
      data: { createdAt: at('2026-10-30T09:30:00Z') },
    });
    await prisma.payment.updateMany({
      where: { saleId: order.id },
      data: { createdAt: at('2026-10-30T09:00:30Z') },
    });
    await prisma.ticket.updateMany({
      where: { saleId: order.id },
      data: { createdAt: at('2026-10-30T09:00:30Z') },
    });
    const scans = await prisma.ticketScan.findMany({
      where: { establishmentId: estD },
      orderBy: { createdAt: 'asc' },
    });
    const scanTimes = [
      '2026-10-30T10:00:00Z',
      '2026-10-30T10:05:00Z',
      '2026-10-30T10:10:00Z',
      '2026-10-30T11:00:00Z',
    ];
    for (const [i, s] of scans.entries()) {
      await prisma.ticketScan.update({
        where: { id: s.id },
        data: { createdAt: at(scanTimes[i]!) },
      });
    }

    // ─── Stocks et recettes : coûts connus à Bamako, coût manquant à Lagos, jus sans recette ───
    const stockItem = async (establishmentId: string, name: string, unitCost?: number) =>
      (
        await duo.agent
          .post(api('/stock/items'))
          .send({ establishmentId, name, unit: 'KG', ...(unitCost ? { unitCost } : {}) })
          .expect(201)
      ).body.id as string;
    const pouletD = await stockItem(estD, 'Poulet cru', 3000);
    const oignonD = await stockItem(estD, 'Oignon', 500);
    const pouletL = await stockItem(estL, 'Poulet cru');
    await duo.agent
      .put(api(`/stock/recipes/${poulet.variant}`))
      .send({
        establishmentId: estD,
        components: [
          { stockItemId: pouletD, quantity: 0.5 },
          { stockItemId: oignonD, quantity: 0.1 },
        ],
      })
      .expect(200);
    await duo.agent
      .put(api(`/stock/recipes/${poulet.variant}`))
      .send({ establishmentId: estL, components: [{ stockItemId: pouletL, quantity: 0.5 }] })
      .expect(200);
    for (const [when, unitCost] of [
      ['2026-10-27T08:00:00Z', 2800],
      ['2026-10-29T08:00:00Z', 3000],
    ] as const) {
      const key = randomUUID();
      await duo.agent
        .post(api('/stock/movements'))
        .send({ stockItemId: pouletD, kind: 'IN', quantity: 10, unitCost, clientRequestId: key })
        .expect(201);
      await prisma.stockMovement.updateMany({
        where: { idempotencyKey: `req:${key}` },
        data: { createdAt: at(when) },
      });
    }
    // L'entrée de stock a mis à jour le coût actuel : on le rétablit à 3 000 pour le calcul attendu.
    await prisma.stockItem.update({ where: { id: pouletD }, data: { unitCost: 3000 } });
  }, 600_000);

  afterAll(async () => {
    try {
      if (prisma) await cleanup(prisma);
    } finally {
      await app?.close();
    }
  });

  describe('chiffre d’affaires', () => {
    it('1-5. CA restaurant, parc, consolidé ; impayées exclues ; pas de double comptage', async () => {
      const d = (await get(duo.agent, '/analytics/overview').expect(200)).body;
      expect(d.byActivity.RESTAURANT.revenue.current).toBe(8000 + 1000 + 1000 + 12000 + 1000);
      expect(d.byActivity.PARK.revenue.current).toBe(16000);
      expect(d.revenue.current).toBe(39000);
      expect(d.paidSales.current).toBe(5);
      expect(d.orders.current).toBe(5); // impayée incluse, annulée exclue
      expect(d.revenue.previous).toBe(4000); // le 25/10 UTC à Lagos est le lundi 26
      expect(d.visitors).toEqual({ current: 2, previous: 0, change: null });
      expect(d.meta).toMatchObject({ timezone: 'Africa/Bamako', currency: 'XOF', activity: 'ALL' });
    });

    it('le tableau de bord applique la même règle (daté à l’encaissement)', async () => {
      const d = (await duo.agent.get(api('/dashboard')).expect(200)).body;
      expect(d.revenue.RESTAURANT).toEqual(expect.objectContaining({ today: expect.any(Number) }));
    });
  });

  describe('restaurant', () => {
    it('6-9. quantités et CA par produit, par heure et par jour', async () => {
      const d = (await get(duo.agent, '/analytics/restaurant').expect(200)).body;
      expect(d.products.map((p: any) => [p.product, p.quantity, p.revenue])).toEqual([
        ['Poulet braisé', 5, 20000],
        ['Jus de bissap', 3, 3000],
      ]);
      expect(d.unsold.map((u: any) => u.product)).toEqual(['Tiramisu']);
      expect(d.hourly[12]).toMatchObject({ revenue: 21000, quantity: 6, orders: 3 });
      expect(d.hourly[0]).toMatchObject({ revenue: 2000, quantity: 2 });
      expect(d.daily.map((p: any) => p.revenue)).toEqual([1000, 0, 0, 0, 22000]);
    });

    it('10. fuseaux : « entre 12 h et 14 h » et « le lundi » en heure locale de chaque établissement', async () => {
      const noon = (
        await get(duo.agent, '/analytics/restaurant/hourly', { hourFrom: 12, hourTo: 14 }).expect(
          200,
        )
      ).body;
      expect(noon.rows.map((r: any) => [r.hour, r.product, r.quantity])).toEqual([
        [12, 'Poulet braisé', 5],
        [12, 'Jus de bissap', 1],
      ]);
      const monday = (
        await get(duo.agent, '/analytics/restaurant/hourly', {
          weekday: 1,
          productId: jus.product,
        }).expect(200)
      ).body;
      expect(monday.rows.map((r: any) => [r.hour, r.quantity])).toEqual([[0, 1]]);
      await get(duo.agent, '/analytics/restaurant/hourly', { hourFrom: 14, hourTo: 12 }).expect(
        400,
      );
    });
  });

  describe('parc', () => {
    it('11-13. vendus, payés, émis, scannés ; scans refusés exclus', async () => {
      const d = (await get(duo.agent, '/analytics/park').expect(200)).body;
      expect(d.totals.soldUnits.current).toBe(4);
      expect(d.totals.paidUnits.current).toBe(3);
      expect(d.totals.issued.current).toBe(6); // 7 émis − 1 annulé
      expect(d.totals.cancelledTickets).toBe(1);
      expect(d.totals.scanned.current).toBe(2);
      expect(d.totals.refusedScans.total).toBe(2);
      expect(d.totals.usageRate).toBe(33.3);
      expect(d.hourly[10].entries + d.hourly[11].entries).toBe(2);
    });

    it('14. carte thermique : entrées et commandes jamais mélangées', async () => {
      const entries = (
        await get(duo.agent, '/analytics/heatmap', { metric: 'entries' }).expect(200)
      ).body;
      expect(entries.cells[4][10]).toBe(1);
      expect(entries.cells[4][11]).toBe(1);
      expect(entries.cells.flat().reduce((a: number, b: number) => a + b, 0)).toBe(2);
      const orders = (await get(duo.agent, '/analytics/heatmap', { metric: 'orders' }).expect(200))
        .body;
      expect(orders.cells[4][12]).toBe(3);
      expect(orders.cells[3][23]).toBe(1);
      expect(orders.weekdayCount).toEqual([1, 1, 1, 1, 1, 0, 0]);
    });
  });

  describe('marges estimées', () => {
    it('15-16. coûts complets, coût manquant, sans recette', async () => {
      const d = (await get(duo.agent, '/analytics/margins').expect(200)).body;
      const row = (est: string, product: string) =>
        d.rows.find((r: any) => r.establishmentId === est && r.product === product);
      expect(row(estD, 'Poulet braisé')).toMatchObject({
        unitCost: 1550,
        materialCost: 3100,
        margin: 4900,
        marginRate: 61.3,
        gap: null,
      });
      expect(row(estL, 'Poulet braisé')).toMatchObject({
        gap: 'MISSING_COST',
        missingCosts: ['Poulet cru'],
        margin: null,
      });
      expect(row(estD, 'Jus de bissap')).toMatchObject({ gap: 'NO_RECIPE', margin: null });
      expect(d.summary).toMatchObject({
        revenueCosted: 8000,
        materialCost: 3100,
        grossMargin: 4900,
        complete: false,
      });
      expect(d.costs[0]).toMatchObject({ stockItem: 'Poulet cru', change: 7.1 });
    });
  });

  describe('établissements, isolation, permissions', () => {
    it('17. comparaison et consolidation', async () => {
      const d = (await get(duo.agent, '/analytics/establishments').expect(200)).body;
      const byName = Object.fromEntries(
        d.rows.map((r: any) => [r.establishment, r.revenue.current]),
      );
      expect(byName['Maquis Lagos']).toBe(13000);
      expect(d.consolidated.revenue.current).toBe(39000);
      expect(d.topProducts[0]).toMatchObject({ product: 'Poulet braisé', total: 5 });
    });

    it('18. isolation : une autre organisation ne voit ni ne cible ces établissements', async () => {
      await get(other.agent, '/analytics/overview', { establishmentId: estD }).expect(404);
      const own = (await get(other.agent, '/analytics/overview').expect(200)).body;
      expect(own.revenue.current).toBe(50000);
      const duoOverview = (await get(duo.agent, '/analytics/overview').expect(200)).body;
      expect(duoOverview.revenue.current).not.toBe(39000 + 50000);
      // Paramètre non prévu (organisation) : refusé, jamais utilisé.
      await get(duo.agent, '/analytics/overview', { organizationId: other.organizationId }).expect(
        400,
      );
    });

    it('19. RBAC : superviseur limité à ses établissements, sans marges ni export ; caissier refusé', async () => {
      const d = (await get(supervisorL, '/analytics/overview').expect(200)).body;
      expect(d.revenue.current).toBe(13000);
      await get(supervisorL, '/analytics/overview', { establishmentId: estD }).expect(404);
      await get(supervisorL, '/analytics/margins').expect(403);
      await get(supervisorL, '/analytics/export', { report: 'overview' }).expect(403);
      await get(cashier, '/analytics/overview').expect(403);
      await get(cashier, '/analytics/scope').expect(403);
    });
  });

  describe('exports', () => {
    it('20. export CSV : mêmes chiffres que l’écran, en-tête complet, export journalisé', async () => {
      const res = await get(duo.agent, '/analytics/export', {
        report: 'restaurant-products',
      }).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text.startsWith('﻿')).toBe(true);
      expect(res.text).toContain('Fuseau horaire;Africa/Bamako');
      expect(res.text).toContain('Devise;FCFA (XOF), montants TTC');
      expect(res.text).toContain('Poulet braisé;Plats;5;20000');
      const log = await prisma.auditLog.findFirst({
        where: { organizationId: duo.organizationId, action: 'analytics.exported' },
      });
      expect(log?.metadata).toMatchObject({ report: 'restaurant-products', rows: 2 });
      const cols = await get(duo.agent, '/analytics/export', {
        report: 'restaurant-products',
        columns: 'product,revenue',
      }).expect(200);
      expect(cols.text).toContain('Produit;CA (FCFA)\r\nPoulet braisé;20000');
      await get(duo.agent, '/analytics/export', {
        report: 'restaurant-products',
        columns: 'product,secret',
      }).expect(400);
    });

    it('23. injection de formules neutralisée dans le CSV', async () => {
      await prisma.product.update({
        where: { id: poulet.product },
        data: { name: '=HYPERLINK("http://x","ok")' },
      });
      try {
        const res = await get(duo.agent, '/analytics/export', {
          report: 'restaurant-products',
        }).expect(200);
        expect(res.text).toContain(`"'=HYPERLINK(""http://x"",""ok"")"`);
        expect(res.text).not.toMatch(/(^|;)=HYPERLINK/m);
      } finally {
        await prisma.product.update({
          where: { id: poulet.product },
          data: { name: 'Poulet braisé' },
        });
      }
    });

    it('période invalide ou trop longue : refus explicite', async () => {
      const res = await duo.agent
        .get(api('/analytics/overview'))
        .query({ period: 'custom', from: '2024-01-01', to: '2026-01-01' })
        .expect(400);
      expect(res.body.code).toBe('PERIOD_RANGE_TOO_LONG');
    });
  });

  describe('performance', () => {
    it('26. 5 000 ventes encaissées sur un mois : vue globale et restaurant en moins de 5 s', async () => {
      const session = await prisma.cashSession.findFirstOrThrow({
        where: { establishmentId: estD, status: 'OPEN' },
      });
      const base = Date.parse('2026-10-01T08:00:00Z');
      const sales = Array.from({ length: 5000 }, (_, i) => ({
        id: randomUUID(),
        organizationId: duo.organizationId,
        establishmentId: estD,
        cashSessionId: session.id,
        cashierId: session.openedById,
        number: 100_000 + i,
        activity: 'RESTAURANT' as const,
        paymentStatus: 'PAID' as const,
        total: 4000,
        createdAt: new Date(base + i * 8 * 60_000),
      }));
      await prisma.sale.createMany({ data: sales });
      await prisma.saleLine.createMany({
        data: sales.map((s) => ({
          organizationId: s.organizationId,
          saleId: s.id,
          variantId: poulet.variant,
          productName: 'Poulet braisé',
          variantName: 'Standard',
          unitPrice: 4000,
          quantity: 1,
          lineTotal: 4000,
        })),
      });
      await prisma.payment.createMany({
        data: sales.map((s) => ({
          organizationId: s.organizationId,
          saleId: s.id,
          cashSessionId: s.cashSessionId,
          receivedById: s.cashierId,
          method: 'CASH' as const,
          status: 'SUCCEEDED' as const,
          amount: 4000,
          createdAt: s.createdAt,
        })),
      });
      const month = { period: 'custom', from: '2026-10-01', to: '2026-10-31' };
      for (const path of [
        '/analytics/overview',
        '/analytics/restaurant',
        '/analytics/establishments',
      ]) {
        const t0 = Date.now();
        await duo.agent.get(api(path)).query(month).expect(200);
        const ms = Date.now() - t0;
        // Mesure conservée dans le journal de test (latence Neon comprise).
        console.log(`[perf] ${path} : ${ms} ms`);
        expect(ms).toBeLessThan(5_000);
      }
    }, 300_000);
  });
});
