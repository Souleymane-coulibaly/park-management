import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import {
  FACTURE_PRODUCT_CODE,
  type OrgReportBlock,
  type OrganizationReport,
  STOCK_PRODUCT_CODE,
  localMoment,
} from '@ocall/shared';
import type { TenantContext } from '../src/common/auth-context';
import { OrganizationReportingRegistry } from '../src/common/integration/organization-reporting';
import { OrganizationReportService } from '../src/modules/dashboard/organization-report.service';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  login,
  signup,
} from './helpers';

/**
 * Ocall Suite — étape 5 : tableau de bord de l'organisation (lot A).
 *
 * Une organisation Parc + Restaurant avec Facture, Stock et School ; un établissement du référentiel
 * (« Agence Kayes ») porte une facture, une boutique et une école ; une facture, une boutique et une
 * école restent « non rattachées ». Chaque bloc doit égaler le rapport de son application (mêmes
 * calculs), le filtre et « Non rattaché » ne rien attribuer automatiquement, les droits de chaque
 * application s'appliquer, et une application en panne ne pas bloquer la page. Aucun total entre
 * applications. Bases de test locales jetables uniquement.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const enabled = Boolean(
  process.env.TEST_STOCK_DATABASE_URL &&
  process.env.TEST_FACTURE_DATABASE_URL &&
  process.env.TEST_SCHOOL_DATABASE_URL,
);

(enabled ? describe : describe.skip)('Ocall Suite S5 — tableau de bord de l’organisation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stockDb: OcallStockPrismaService;
  let factureDb: FacturePrismaService;
  let platform: InternalAccount;
  let org: SignedUpOwner;
  let other: SignedUpOwner;
  let a: Agent;
  let estMain: string;
  let kayes: string;
  let otherEst: string;
  let shopKayes: { id: string; locations: { id: string }[] };
  let shopFree: { id: string; locations: { id: string }[] };
  let schoolKayes: string;
  const plans: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function trial(organizationId: string, code: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
    const plan = await prisma.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `S5 ${code} ${organizationId.slice(0, 8)} ${RUN}`,
        monthlyPrice: 17_500,
        setupFee: 0,
        isActive: false,
      },
    });
    plans.push(plan.id);
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
      data: { organizationId, productId: product.id, planId: plan.id, status: 'TRIALING' },
    });
  }

  async function employee(role: string, establishmentId = estMain) {
    const res = (
      await a
        .post(api('/employees'))
        .send({ firstName: 'Awa', lastName: role, role, establishmentIds: [establishmentId] })
        .expect(201)
    ).body;
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginId: res.employee.loginId },
      select: { id: true },
    });
    return {
      agent: await connect(res.employee.loginId, res.temporaryPassword),
      userId: user.id,
    };
  }

  const report = async (agent: Agent, query: Record<string, string> = {}) =>
    (await agent.get(api('/dashboard/organization')).query(query).expect(200))
      .body as OrganizationReport;
  const block = (r: OrganizationReport, product: string) =>
    r.blocks.find((b) => b.product === product);
  const metric = (b: OrgReportBlock | undefined, id: string) =>
    b?.metrics.find((m) => m.id === id)?.value;
  const site = (b: OrgReportBlock | undefined, id: string | null, key: string) =>
    b?.bySite.find((r) => r.establishmentId === id)?.values[key];

  async function stockSale(
    shop: { locations: { id: string }[] },
    code: string,
    variant: string,
    price: number,
  ) {
    const register = (
      await a
        .post(api('/ocall-stock/registers'))
        .send({ code, name: `Caisse ${code}`, locationId: shop.locations[0]!.id })
        .expect(201)
    ).body.id;
    await a
      .post(api(`/ocall-stock/registers/${register}/sessions`))
      .send({ openingFloat: 0 })
      .expect(201);
    return (
      await a
        .post(api('/ocall-stock/sales'))
        .send({
          idempotencyKey: randomUUID(),
          registerId: register,
          lines: [{ variantId: variant, quantity: 1 }],
          payments: [{ method: 'CASH', amount: price }],
        })
        .expect(201)
    ).body as { id: string; total: number };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockDb = app.get(OcallStockPrismaService);
    factureDb = app.get(FacturePrismaService);
    platform = await internalAccount(app, prisma, `s5-owner-${RUN}`, 'PLATFORM_OWNER');
    org = await signup(app, 's5Report', 'PARK_RESTAURANT');
    other = await signup(app, 's5Other', 'PARK');
    a = org.agent;
    estMain = (await a.get(api('/establishments')).expect(200)).body[0].id;
    otherEst = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    kayes = (
      await a
        .post(api('/establishments'))
        .send({ name: 'Agence Kayes', businessType: 'NONE', city: 'Kayes' })
        .expect(201)
    ).body.id;
    await trial(org.organizationId, FACTURE_PRODUCT_CODE);
    await trial(org.organizationId, STOCK_PRODUCT_CODE);

    // Restaurant : deux ventes encaissées au site principal.
    const category = (await a.post(api('/catalog/categories')).send({ name: 'Plats' }).expect(201))
      .body.id;
    const dish = (
      await a
        .post(api('/catalog/products'))
        .send({
          name: 'Poulet braisé',
          categoryId: category,
          variants: [{ name: 'Standard', prices: [{ establishmentId: estMain, price: 4000 }] }],
        })
        .expect(201)
    ).body.variants[0].id;
    await a
      .post(api('/cash-sessions'))
      .send({ establishmentId: estMain, openingFloat: 0 })
      .expect(201);
    for (const quantity of [1, 2]) {
      const sale = (
        await a
          .post(api('/sales'))
          .send({ establishmentId: estMain, lines: [{ variantId: dish, quantity }] })
          .expect(201)
      ).body;
      await a
        .post(api(`/sales/${sale.id}/payments`))
        .send({ method: 'CASH', amountTendered: sale.total })
        .expect(200);
    }

    // Facture : une facture de l'agence de Kayes (réglée), une facture sans établissement.
    await a
      .put(api('/facture/settings'))
      .send({
        legalName: `S5 ${RUN} SARL`,
        address: 'Rue 310',
        city: 'Bamako',
        nif: '084123456A',
        defaultVatRate: 18,
        paymentTermsDays: 30,
      })
      .expect(200);
    const client = (
      await a.post(api('/facture/clients')).send({ kind: 'COMPANY', name: 'BTP Sahel' }).expect(201)
    ).body.id;
    const invoice = async (unitPrice: number, establishmentId?: string) => {
      const draft = (
        await a
          .post(api('/facture/documents'))
          .send({
            type: 'INVOICE',
            clientId: client,
            establishmentId,
            lines: [{ label: 'Prestation', unit: 'unité', quantity: 1, unitPrice, vatRate: 18 }],
          })
          .expect(201)
      ).body;
      return (await a.post(api(`/facture/documents/${draft.id}/issue`)).expect(200)).body;
    };
    const kayesInvoice = await invoice(10_000, kayes);
    await invoice(5_000);
    await a
      .post(api(`/facture/documents/${kayesInvoice.id}/payments`))
      .send({ amount: 11_800, method: 'CASH', paidAt: today })
      .expect(201);

    // Stock : boutique de Kayes (vente facturée) et boutique non rattachée.
    shopKayes = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'KAY', name: 'Boutique Kayes', kind: 'STORE', establishmentId: kayes })
        .expect(201)
    ).body;
    shopFree = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'LIB', name: 'Boutique libre', kind: 'STORE' })
        .expect(201)
    ).body;
    const variant = (
      await a
        .post(api('/ocall-stock/products'))
        .send({
          name: 'Ciment 50 kg',
          salePrice: 5_900,
          purchasePrice: 4_000,
          vatRate: 18,
          isStockable: false,
        })
        .expect(201)
    ).body.variants[0].id as string;
    const kayesSale = await stockSale(shopKayes, 'CK1', variant, 5_900);
    await stockSale(shopFree, 'CL1', variant, 5_900);
    const stockInvoice = (
      await a
        .post(api('/facture/stock/sales/invoice'))
        .send({ sale: kayesSale.id, clientId: client })
        .expect(201)
    ).body;
    await a.post(api(`/facture/documents/${stockInvoice.id}/issue`)).expect(200);

    // School : une école rattachée à Kayes, une non rattachée.
    const contract = (
      await platform.agent
        .post(api('/platform/contracts'))
        .send({ organizationId: org.organizationId, reference: `S5-${RUN}`, ...TERMS })
        .expect(201)
    ).body;
    await platform.agent
      .post(api(`/platform/contracts/${contract.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    for (const name of ['École Kayes', 'École libre']) {
      const id = (
        await a
          .post(api('/school/schools'))
          .send({ name, type: 'PRIMARY', countryCode: 'ML' })
          .expect(201)
      ).body.id as string;
      const year = (
        await a
          .post(api('/school/years'))
          .send({ schoolId: id, label: '2026-2027', startsOn: '2026-09-01', endsOn: '2027-06-30' })
          .expect(201)
      ).body.id;
      await a
        .post(api(`/school/years/${year}/status`))
        .send({ status: 'ACTIVE' })
        .expect(200);
      if (name === 'École Kayes') {
        schoolKayes = id;
        await a
          .put(api(`/school/schools/${id}/establishment`))
          .send({ establishmentId: kayes })
          .expect(200);
      }
    }
  }, 300_000);

  afterAll(async () => {
    try {
      const ids = [org?.organizationId, other?.organizationId].filter(Boolean) as string[];
      if (stockDb && ids.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(stockDb, ids);
      }
      if (factureDb && ids.length) await purgeFactureOrganizations(factureDb, ids);
      if (prisma) {
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('propriétaire : un bloc par application ouverte, chacun égal au rapport de son application', async () => {
    const r = await report(a);
    expect(r.blocks.map((b) => b.product)).toEqual([
      'OCALL_PARK',
      'OCALL_PARK_RESTAURANT',
      'OCALL_FACTURE',
      'OCALL_STOCK',
      'OCALL_SCHOOL',
    ]);
    expect(r.blocks.every((b) => b.status === 'ok')).toBe(true);
    expect(r.meta.timezone).toBe('Africa/Bamako');
    expect(r.meta.currency).toBe('XOF');
    // Aucun total entre applications.
    expect(Object.keys(r)).toEqual(['meta', 'blocks']);

    const restaurant = (
      await a
        .get(api('/analytics/overview'))
        .query({ period: 'this_month', activity: 'RESTAURANT' })
        .expect(200)
    ).body;
    expect(metric(block(r, 'OCALL_PARK_RESTAURANT'), 'collected')).toBe(12_000);
    expect(metric(block(r, 'OCALL_PARK_RESTAURANT'), 'collected')).toBe(restaurant.revenue.current);
    expect(metric(block(r, 'OCALL_PARK_RESTAURANT'), 'orders')).toBe(restaurant.orders.current);

    // Facture : facturé et encaissé distincts ; factures de ventes Stock isolées.
    const facture = (await a.get(api('/facture/dashboard')).expect(200)).body;
    const f = block(r, 'OCALL_FACTURE');
    expect(metric(f, 'invoiced')).toBe(11_800 + 5_900 + 5_900);
    expect(metric(f, 'invoiced')).toBe(facture.invoiced.netTtc);
    expect(metric(f, 'collected')).toBe(11_800);
    expect(metric(f, 'collected')).toBe(facture.collected.amount);
    expect(facture.invoiced.fromStockSales).toMatchObject({ count: 1, netTtc: 5_900 });
    expect(f?.metrics.find((m) => m.id === 'invoiced')?.hint).toContain('dont ventes Stock');
    expect(f?.metrics.find((m) => m.id === 'invoiced')?.nature).toBe('invoiced');
    expect(f?.metrics.find((m) => m.id === 'collected')?.nature).toBe('collected');

    const stock = (
      await a
        .get(api('/ocall-stock/reports/dashboard'))
        .query({ from: monthStart, to: today })
        .expect(200)
    ).body;
    expect(metric(block(r, 'OCALL_STOCK'), 'collected')).toBe(11_800);
    expect(metric(block(r, 'OCALL_STOCK'), 'collected')).toBe(stock.sales.revenue);

    const s = block(r, 'OCALL_SCHOOL');
    expect(metric(s, 'students')).toBe(0);
    expect(metric(s, 'collected')).toBe(0);
  });

  it('par établissement : Kayes et « Non rattaché », sans attribution automatique', async () => {
    const all = await report(a);
    const f = block(all, 'OCALL_FACTURE');
    expect(site(f, kayes, 'invoiced')).toBe(11_800 + 5_900);
    expect(site(f, null, 'invoiced')).toBe(5_900);
    expect(site(block(all, 'OCALL_STOCK'), kayes, 'collected')).toBe(5_900);
    expect(site(block(all, 'OCALL_STOCK'), null, 'collected')).toBe(5_900);
    expect(site(block(all, 'OCALL_PARK_RESTAURANT'), estMain, 'collected')).toBe(12_000);

    const k = await report(a, { establishmentId: kayes });
    expect(k.meta.establishment).toBe(kayes);
    expect(metric(block(k, 'OCALL_FACTURE'), 'invoiced')).toBe(11_800 + 5_900);
    expect(metric(block(k, 'OCALL_FACTURE'), 'collected')).toBe(11_800);
    expect(metric(block(k, 'OCALL_STOCK'), 'collected')).toBe(5_900);
    expect(metric(block(k, 'OCALL_PARK_RESTAURANT'), 'collected')).toBe(0);
    expect(block(k, 'OCALL_PARK_RESTAURANT')?.message).toContain('Aucun restaurant');
    const kSchool = block(k, 'OCALL_SCHOOL');
    expect(kSchool?.bySite.map((x) => x.establishmentId)).toEqual([kayes]);
    expect(
      k.blocks.flatMap((b) => b.bySite.map((x) => x.establishmentId)).every((id) => id === kayes),
    ).toBe(true);

    const none = await report(a, { establishmentId: 'none' });
    expect(metric(block(none, 'OCALL_FACTURE'), 'invoiced')).toBe(5_900);
    expect(metric(block(none, 'OCALL_FACTURE'), 'collected')).toBe(0);
    expect(metric(block(none, 'OCALL_STOCK'), 'collected')).toBe(5_900);
    expect(metric(block(none, 'OCALL_PARK_RESTAURANT'), 'collected')).toBe(0);
    expect(block(none, 'OCALL_SCHOOL')?.bySite.map((x) => x.establishmentId)).toEqual([null]);
    // L'école de Kayes n'a pas été déplacée, la facture sans établissement non plus.
    expect(
      none.blocks.flatMap((b) => b.bySite.map((x) => x.establishmentId)).every((id) => id === null),
    ).toBe(true);
    expect(schoolKayes).toBeTruthy();

    // Le filtre est vérifié contre le référentiel de l'organisation.
    await a.get(api('/dashboard/organization')).query({ establishmentId: otherEst }).expect(404);
    await a
      .get(api('/dashboard/organization'))
      .query({ establishmentId: randomUUID() })
      .expect(404);
    await a.get(api('/dashboard/organization')).query({ establishmentId: 'abc' }).expect(400);
    await a
      .get(api('/dashboard/organization'))
      .query({ period: 'custom', from: '2026-11-10', to: '2026-11-01' })
      .expect(400);
    await a
      .get(api('/dashboard/organization'))
      .query({ organizationId: other.organizationId })
      .expect(400);
  });

  it('droits : administrateur selon ses rôles réels, boutiques du membre Stock, autres rôles refusés', async () => {
    const admin = await employee('ADMIN');
    const asAdmin = await report(admin.agent);
    // Rôle Park (analyses) : oui ; aucun rôle Facture, Stock ni School : aucun bloc.
    expect(asAdmin.blocks.map((b) => b.product)).toEqual(['OCALL_PARK', 'OCALL_PARK_RESTAURANT']);

    // Rôle Stock limité à la boutique libre : seules ses ventes.
    const member = (
      await a
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: admin.userId, role: 'STORE_MANAGER' })
        .expect(201)
    ).body.member;
    await a
      .put(api(`/ocall-stock/members/${member.id}/sites`))
      .send({ siteIds: [shopFree.id] })
      .expect(200);
    const limited = await report(admin.agent);
    expect(metric(block(limited, 'OCALL_STOCK'), 'collected')).toBe(5_900);
    expect(block(limited, 'OCALL_STOCK')?.bySite.map((x) => x.establishmentId)).toEqual([null]);
    // Kayes : boutique hors de ses droits, rien n'apparaît.
    const limitedKayes = await report(admin.agent, { establishmentId: kayes });
    expect(metric(block(limitedKayes, 'OCALL_STOCK'), 'collected')).toBe(0);
    // Pas même le nom d'une boutique hors de ses droits.
    expect(block(limitedKayes, 'OCALL_STOCK')?.bySite).toEqual([]);

    const supervisor = await employee('SUPERVISOR');
    await supervisor.agent.get(api('/dashboard/organization')).expect(403);
    const cashier = await employee('CASHIER');
    await cashier.agent.get(api('/dashboard/organization')).expect(403);
    // Compte d'application seulement (technicien Facture) : refusé.
    const tech = (
      await a
        .post(api('/facture/members'))
        .send({ firstName: 'Moussa', lastName: 'Tech', role: 'TECHNICIAN' })
        .expect(201)
    ).body;
    const techAgent = await connect(tech.member.loginId, tech.temporaryPassword);
    await techAgent.get(api('/dashboard/organization')).expect(403);
  });

  it('autre organisation : ses seules applications, aucune donnée de la première', async () => {
    const r = await report(other.agent);
    // Parc seulement (métier Parc) ; Stock COMING_SOON sans essai, Facture et School non ouverts.
    expect(r.blocks.map((b) => b.product)).toEqual(['OCALL_PARK']);
    expect(r.meta.establishments.map((e) => e.id)).toEqual([otherEst]);
    expect(metric(block(r, 'OCALL_PARK'), 'collected')).toBe(0);
    await other.agent
      .get(api('/dashboard/organization'))
      .query({ establishmentId: kayes })
      .expect(404);
  });

  it('lot B — tableau de bord Facture : période, établissement, « sans établissement », ventes Stock isolées', async () => {
    const month = (await a.get(api('/facture/dashboard')).expect(200)).body;
    expect(month.month).toBe(today.slice(0, 7));
    expect(month.period).toEqual({
      from: monthStart,
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const dashboard = async (query: Record<string, string>) =>
      (await a.get(api('/facture/dashboard')).query(query).expect(200)).body;
    const k = await dashboard({ establishmentId: kayes });
    expect(k.invoiced.netTtc).toBe(11_800 + 5_900);
    expect(k.collected.amount).toBe(11_800);
    expect(k.invoiced.fromStockSales).toMatchObject({ count: 1, netTtc: 5_900 });
    expect(k.outstanding.amount).toBe(5_900);
    const none = await dashboard({ establishmentId: 'none' });
    expect(none.invoiced.netTtc).toBe(5_900);
    expect(none.invoiced.fromStockSales.count).toBe(0);
    expect(none.collected.amount).toBe(0);
    const custom = await dashboard({ from: today, to: today });
    expect(custom.month).toBeNull();
    expect(custom.invoiced.netTtc).toBe(month.invoiced.netTtc);
    // Établissement d'une autre organisation : rien (aucune fuite), jamais une erreur serveur.
    const foreign = await dashboard({ establishmentId: otherEst });
    expect(foreign.invoiced.netTtc).toBe(0);
    await a.get(api('/facture/dashboard')).query({ establishmentId: 'abc' }).expect(400);
    await a.get(api('/facture/dashboard')).query({ from: today }).expect(400);
    await a.get(api('/facture/dashboard')).query({ from: today, to: '2020-01-01' }).expect(400);
  });

  it('lot B — exports Facture : colonne « Établissement » (nom figé) et filtre', async () => {
    const csv = async (journal: string, query: Record<string, string>) =>
      (
        await a
          .get(api(`/facture/exports/${journal}`))
          .query({ from: monthStart, to: today, ...query })
          .buffer(true)
          .parse((res, cb) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c: string) => (data += c));
            res.on('end', () => cb(null, data));
          })
          .expect(200)
      ).body as string;
    const lines = (text: string) =>
      text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
    const all = lines(await csv('sales', {}));
    expect(all[0]!.split(';').at(-1)).toBe('Établissement');
    expect(all).toHaveLength(4);
    const k = lines(await csv('sales', { establishmentId: kayes }));
    expect(k).toHaveLength(3);
    expect(k.slice(1).every((l) => l.endsWith('Agence Kayes'))).toBe(true);
    const none = lines(await csv('sales', { establishmentId: 'none' }));
    expect(none).toHaveLength(2);
    expect(none[1]!.endsWith(';')).toBe(true);
    const payments = lines(await csv('payments', { establishmentId: kayes }));
    expect(payments[0]!.split(';').at(-1)).toBe('Établissement');
    expect(payments).toHaveLength(2);
    expect(payments[1]!.endsWith('Agence Kayes')).toBe(true);
    expect(lines(await csv('payments', { establishmentId: 'none' }))).toHaveLength(1);
  });

  it('lot B — tableau de bord Stock par établissement (boutiques rattachées, non rattachées)', async () => {
    const stock = async (query: Record<string, string>) =>
      (
        await a
          .get(api('/ocall-stock/reports/dashboard'))
          .query({ from: monthStart, to: today, ...query })
          .expect(200)
      ).body;
    const k = await stock({ establishmentId: kayes });
    expect(k.sales.revenue).toBe(5_900);
    expect(k.sites.map((x: { code: string }) => x.code)).toEqual(['KAY']);
    expect(k.sites[0].establishmentId).toBe(kayes);
    expect(k.establishments).toEqual([{ id: kayes, name: 'Agence Kayes', isActive: true }]);
    const none = await stock({ establishmentId: 'none' });
    expect(none.sales.revenue).toBe(5_900);
    expect(none.sites.map((x: { code: string }) => x.code)).toEqual(['LIB']);
    await a
      .get(api('/ocall-stock/reports/dashboard'))
      .query({ establishmentId: kayes, siteId: shopFree.id })
      .expect(404);
    await a
      .get(api('/ocall-stock/reports/dashboard'))
      .query({ establishmentId: 'abc' })
      .expect(400);
  });

  it('fuseaux : jours de la période dans le fuseau de l’organisation, appliqués aux ventes Stock', async () => {
    const owner = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId: org.organizationId, role: 'OWNER' },
      select: { id: true, userId: true },
    });
    const service = app.get(OrganizationReportService);
    // Instant de référence juste après la dernière vente Stock : la journée locale contient les ventes
    // quelle que soit l'heure d'exécution (un minuit local entre les ventes et ce test faussait le jour).
    const lastSale = await stockDb.stockSale.findFirstOrThrow({
      where: { organizationId: org.organizationId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const now = new Date(lastSale.createdAt.getTime() + 1_000);
    // Kiritimati (UTC+14) et Pago Pago (UTC-11) : à toute heure, l'un des deux n'est pas au jour UTC.
    for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const auth = {
        user: { id: owner.userId },
        membership: {
          id: owner.id,
          role: 'OWNER',
          organizationId: org.organizationId,
          businessType: 'PARK_RESTAURANT',
          timezone,
        },
      } as unknown as TenantContext;
      const r = await service.report(auth, { period: 'today' }, now);
      expect(r.meta.timezone).toBe(timezone);
      expect(r.meta.period.days).toEqual([localMoment(now, timezone).date]);
      expect(metric(block(r, 'OCALL_STOCK'), 'collected')).toBe(11_800);
    }
  });

  it('lot C — copilote : lieu sans activité introuvable ; chiffre d’affaires du superviseur ; devise', async () => {
    const none = await a
      .post(api('/ai/copilot/ask'))
      .send({ establishmentId: kayes, question: 'Combien ai-je vendu hier ?' });
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('ESTABLISHMENT_NOT_FOUND');
    const main = await a
      .post(api('/ai/copilot/ask'))
      .send({ establishmentId: estMain, question: 'Combien ai-je vendu hier ?' });
    expect(main.body.code).not.toBe('ESTABLISHMENT_NOT_FOUND');

    // /dashboard : le superviseur voit le chiffre d'affaires de ses seuls établissements.
    const segou = (
      await a
        .post(api('/establishments'))
        .send({ name: 'Maquis Ségou', businessType: 'RESTAURANT', city: 'Ségou' })
        .expect(201)
    ).body.id;
    const here = await employee('SUPERVISOR');
    const there = await employee('SUPERVISOR', segou);
    const revenue = async (agent: Agent) =>
      (await agent.get(api('/dashboard')).expect(200)).body.revenue.RESTAURANT.last30Days;
    expect(await revenue(here.agent)).toBe(12_000);
    expect(await revenue(there.agent)).toBe(0);
    expect(await revenue(a)).toBe(12_000);

    // Devise des analyses : celle de l'organisation.
    await prisma.organization.update({
      where: { id: org.organizationId },
      data: { currency: 'EUR' },
    });
    try {
      const overview = (
        await a.get(api('/analytics/overview')).query({ period: 'this_month' }).expect(200)
      ).body;
      expect(overview.meta.currency).toBe('EUR');
      expect((await report(a)).meta.currency).toBe('EUR');
    } finally {
      await prisma.organization.update({
        where: { id: org.organizationId },
        data: { currency: 'XOF' },
      });
    }
  });

  it('application en panne : bloc « indisponible », le reste du tableau de bord répond', async () => {
    app.get(OrganizationReportingRegistry).register({
      product: 'OCALL_TEST_PANNE',
      label: 'Application en panne',
      order: 99,
      href: '/',
      report: async () => {
        throw new Error('base injoignable');
      },
    });
    const r = await report(a);
    const broken = block(r, 'OCALL_TEST_PANNE');
    expect(broken).toMatchObject({ status: 'unavailable', metrics: [], bySite: [] });
    expect(broken?.message).toContain('indisponible');
    expect(r.blocks.filter((b) => b.status === 'ok')).toHaveLength(5);
  });
});
