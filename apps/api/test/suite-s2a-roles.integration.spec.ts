import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FACTURE_PRODUCT_CODE, STOCK_PRODUCT_CODE } from '@ocall/shared';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { OcallStockPrismaService } from '../src/modules/ocall-stock/ocall-stock-prisma.service';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
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
 * Ocall Suite — Sprint 2, étape A : rôles distincts par application et par site.
 * - Un membre de l'organisation (employé Park, membre d'une autre application) reçoit un rôle dans Stock,
 *   Facture et School sans nouveau compte ; son rôle Park ne change pas ; aucune application ne lui donne
 *   de droit tant qu'elle ne l'a pas ajouté.
 * - Désactiver un rôle dans une application ne touche ni les autres ni Park ; un compte PRODUCT_USER reste
 *   ouvert tant qu'une application au moins lui donne un rôle actif.
 * - Ocall Stock : rôle propre à une boutique, qui restreint le rôle principal et ne l'élargit jamais.
 * - Isolation : aucun ajout d'un compte d'une autre organisation, du propriétaire, ni par un non-gérant.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const enabled = Boolean(
  process.env.TEST_STOCK_DATABASE_URL &&
  process.env.TEST_FACTURE_DATABASE_URL &&
  process.env.TEST_SCHOOL_DATABASE_URL,
);
const key = () => randomUUID();

(enabled ? describe : describe.skip)('Ocall Suite S2A — rôles par application et par site', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stockDb: OcallStockPrismaService;
  let factureDb: FacturePrismaService;
  let schoolDb: SchoolPrismaService;
  let platform: InternalAccount;
  let org: SignedUpOwner;
  let other: SignedUpOwner;
  let a: Agent;
  let schoolId: string;
  let ownerUserId: string;
  let cashier: { agent: Agent; userId: string; loginId: string };
  let otherEmployee: { userId: string };
  const plans: string[] = [];

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  /** Essai ouvert en base sur une offre de test inactive (Stock, Facture). */
  async function trial(organizationId: string, code: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
    const plan = await prisma.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `S2A ${code} ${organizationId.slice(0, 8)} ${RUN}`,
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

  async function parkEmployee(owner: SignedUpOwner, role: string, lastName: string) {
    const establishments = (await owner.agent.get(api('/establishments')).expect(200)).body;
    const res = (
      await owner.agent
        .post(api('/employees'))
        .send({
          firstName: 'Awa',
          lastName,
          role,
          establishmentIds: [establishments[0].id],
        })
        .expect(201)
    ).body;
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginId: res.employee.loginId },
      select: { id: true },
    });
    return {
      loginId: res.employee.loginId as string,
      temporaryPassword: res.temporaryPassword as string,
      userId: user.id,
      establishmentId: establishments[0].id as string,
    };
  }

  const status = async (agent: Agent, path: string) => (await agent.get(api(path))).status;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockDb = app.get(OcallStockPrismaService);
    factureDb = app.get(FacturePrismaService);
    schoolDb = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `s2a-owner-${RUN}`, 'PLATFORM_OWNER');
    org = await signup(app, 's2aRoles', 'PARK');
    other = await signup(app, 's2aOther', 'PARK');
    a = org.agent;
    ownerUserId = (
      await prisma.user.findUniqueOrThrow({ where: { loginId: org.loginId }, select: { id: true } })
    ).id;
    await trial(org.organizationId, STOCK_PRODUCT_CODE);
    await trial(org.organizationId, FACTURE_PRODUCT_CODE);
    await trial(other.organizationId, STOCK_PRODUCT_CODE);
    const contract = (
      await platform.agent
        .post(api('/platform/contracts'))
        .send({ organizationId: org.organizationId, reference: `S2A-${RUN}`, ...TERMS })
        .expect(201)
    ).body;
    await platform.agent
      .post(api(`/platform/contracts/${contract.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    schoolId = (
      await a
        .post(api('/school/schools'))
        .send({ name: 'École Les Baobabs', type: 'PRIMARY', countryCode: 'ML' })
        .expect(201)
    ).body.id;
    const employee = await parkEmployee(org, 'CASHIER', 'Caisse');
    cashier = {
      agent: await connect(employee.loginId, employee.temporaryPassword),
      userId: employee.userId,
      loginId: employee.loginId,
    };
    otherEmployee = { userId: (await parkEmployee(other, 'CASHIER', 'Autre')).userId };
  }, 300_000);

  afterAll(async () => {
    try {
      const ids = [org?.organizationId, other?.organizationId].filter(Boolean) as string[];
      if (stockDb && ids.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(stockDb, ids);
      }
      if (factureDb && ids.length) {
        const where = { organizationId: { in: ids } };
        await factureDb.factureMember.deleteMany({ where });
        await factureDb.factureSettings.deleteMany({ where });
      }
      if (schoolDb && ids.length) {
        const where = { organizationId: { in: ids } };
        await schoolDb.schoolAccessDecision.deleteMany({ where });
        await schoolDb.schoolMember.deleteMany({ where });
        await schoolDb.school.deleteMany({ where });
        await schoolDb.schoolGroup.deleteMany({ where });
      }
      if (prisma) {
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('un employé Park n’a aucun droit applicatif tant qu’une application ne l’a pas ajouté', async () => {
    expect(await status(cashier.agent, '/ocall-stock/context')).toBe(403);
    expect(await status(cashier.agent, '/facture/context')).toBe(403);
    expect(await status(cashier.agent, '/school/context')).toBe(403);
    // Liste des personnes à ajouter : l'employé oui ; ni le propriétaire ni un compte d'un autre client.
    for (const path of [
      '/ocall-stock/members/candidates',
      '/facture/members/candidates',
      '/school/members/candidates',
    ]) {
      const ids = (await a.get(api(path)).expect(200)).body.map(
        (c: { userId: string }) => c.userId,
      );
      expect(ids).toContain(cashier.userId);
      expect(ids).not.toContain(ownerUserId);
      expect(ids).not.toContain(otherEmployee.userId);
    }
    // Un employé Park ne consulte pas la liste.
    expect(await status(cashier.agent, '/ocall-stock/members/candidates')).toBe(403);
  });

  it('ajout à Stock, Facture et School sans nouveau compte ; rôle Park inchangé', async () => {
    const users = await prisma.user.count();
    const stock = (
      await a
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: cashier.userId, role: 'SALES' })
        .expect(201)
    ).body;
    expect(stock.member).toMatchObject({ loginId: cashier.loginId, role: 'SALES' });
    expect(stock.temporaryPassword).toBeUndefined();
    await a
      .post(api('/facture/members/existing'))
      .send({ userId: cashier.userId, role: 'SALES' })
      .expect(201);
    await a
      .post(api('/school/members/existing'))
      .send({ userId: cashier.userId, role: 'SECRETARY', schoolIds: [schoolId] })
      .expect(201);
    expect(await prisma.user.count()).toBe(users);

    expect((await cashier.agent.get(api('/ocall-stock/context')).expect(200)).body.role).toBe(
      'SALES',
    );
    expect((await cashier.agent.get(api('/facture/context')).expect(200)).body.role).toBe('SALES');
    expect((await cashier.agent.get(api('/school/context')).expect(200)).body.role).toBe(
      'SECRETARY',
    );
    // Rôle Park inchangé : caissier, limité à son établissement.
    const membership = await prisma.organizationMembership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: org.organizationId, userId: cashier.userId },
      },
      select: { role: true, isActive: true },
    });
    expect(membership).toEqual({ role: 'CASHIER', isActive: true });
    expect((await cashier.agent.get(api('/auth/me')).expect(200)).body.role).toBe('CASHIER');
    // Deuxième ajout refusé ; la personne n'est plus proposée.
    const twice = await a
      .post(api('/ocall-stock/members/existing'))
      .send({ userId: cashier.userId, role: 'CASHIER' })
      .expect(409);
    expect(twice.body.code).toBe('STOCK_MEMBER_EXISTS');
    const left = (await a.get(api('/ocall-stock/members/candidates')).expect(200)).body;
    expect(left.map((c: { userId: string }) => c.userId)).not.toContain(cashier.userId);
    // Journal : ajout tracé avec le rôle Park d'origine.
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.organizationId, action: 'stock.member_attached' },
      select: { metadata: true },
    });
    expect(audit?.metadata).toMatchObject({ userId: cashier.userId, suiteRole: 'CASHIER' });
  });

  it('isolation : ni compte d’un autre client, ni propriétaire, ni ajout par un non-gérant', async () => {
    for (const [path, body] of [
      ['/ocall-stock/members/existing', { role: 'CASHIER' }],
      ['/facture/members/existing', { role: 'TECHNICIAN' }],
      ['/school/members/existing', { role: 'SECRETARY', schoolIds: [schoolId] }],
    ] as const) {
      const foreign = await a
        .post(api(path))
        .send({ ...body, userId: otherEmployee.userId })
        .expect(404);
      expect(foreign.body.code).toBe('ORGANIZATION_MEMBER_NOT_FOUND');
      await a
        .post(api(path))
        .send({ ...body, userId: ownerUserId })
        .expect(404);
      await a
        .post(api(path))
        .send({ ...body, userId: randomUUID() })
        .expect(404);
    }
    // Un commercial Stock (sans gestion de l'équipe) n'ajoute personne.
    const employee = await parkEmployee(org, 'SUPERVISOR', 'Superviseur');
    const denied = await cashier.agent
      .post(api('/ocall-stock/members/existing'))
      .send({ userId: employee.userId, role: 'ADMIN' })
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    // L'autre organisation ne voit pas les membres de la première.
    const ids = (
      await other.agent.get(api('/ocall-stock/members/candidates')).expect(200)
    ).body.map((c: { userId: string }) => c.userId);
    expect(ids).not.toContain(cashier.userId);
    expect(ids).not.toContain(employee.userId);
    // Un administrateur Park, non propriétaire, reste sans droit applicatif tant qu'il n'est pas ajouté.
    const admin = await parkEmployee(org, 'ADMIN', 'Admin');
    const adminAgent = await connect(admin.loginId, admin.temporaryPassword);
    expect(await status(adminAgent, '/ocall-stock/context')).toBe(403);
    expect(await status(adminAgent, '/facture/context')).toBe(403);
    expect(await status(adminAgent, '/school/context')).toBe(403);
  });

  it('désactivation dans une application : ni les autres applications ni Park ne changent', async () => {
    const member = await stockDb.stockMember.findFirstOrThrow({
      where: { organizationId: org.organizationId, userId: cashier.userId },
    });
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: false })
      .expect(200);
    expect(await status(cashier.agent, '/ocall-stock/context')).toBe(403);
    expect(await status(cashier.agent, '/facture/context')).toBe(200);
    expect(await status(cashier.agent, '/school/context')).toBe(200);
    const membership = await prisma.organizationMembership.findUniqueOrThrow({
      where: {
        organizationId_userId: { organizationId: org.organizationId, userId: cashier.userId },
      },
      select: { role: true, isActive: true },
    });
    expect(membership).toEqual({ role: 'CASHIER', isActive: true });
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: true })
      .expect(200);
    expect(await status(cashier.agent, '/ocall-stock/context')).toBe(200);

    // Employé Park présent dans la seule application Stock : fermé dans Stock, il garde Park.
    const gate = await parkEmployee(org, 'GATE_AGENT', 'Entrée');
    const gateAgent = await connect(gate.loginId, gate.temporaryPassword);
    const attached = (
      await a
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: gate.userId, role: 'AUDITOR' })
        .expect(201)
    ).body;
    await a
      .patch(api(`/ocall-stock/members/${attached.member.id}`))
      .send({ isActive: false })
      .expect(200);
    expect(await status(gateAgent, '/ocall-stock/context')).toBe(403);
    expect((await gateAgent.get(api('/auth/me')).expect(200)).body.role).toBe('GATE_AGENT');
    expect(
      await prisma.organizationMembership.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId: org.organizationId, userId: gate.userId },
        },
        select: { role: true, isActive: true },
      }),
    ).toEqual({ role: 'GATE_AGENT', isActive: true });
  });

  it('compte réservé aux applications : ouvert tant qu’une application lui donne un rôle actif', async () => {
    const created = (
      await a
        .post(api('/facture/members'))
        .send({ firstName: 'Moussa', lastName: 'Multi', role: 'ACCOUNTANT' })
        .expect(201)
    ).body;
    const agentMulti = await connect(created.member.loginId, created.temporaryPassword);
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginId: created.member.loginId },
      select: { id: true },
    });
    const stock = (
      await a
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: user.id, role: 'AUDITOR' })
        .expect(201)
    ).body;
    const membership = () =>
      prisma.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: org.organizationId, userId: user.id } },
        select: { role: true, isActive: true },
      });
    // Fermé dans Facture : Stock reste ouvert, session conservée.
    await a
      .patch(api(`/facture/members/${created.member.id}`))
      .send({ isActive: false })
      .expect(200);
    expect(await membership()).toEqual({ role: 'PRODUCT_USER', isActive: true });
    expect(await status(agentMulti, '/facture/context')).toBe(403);
    expect(await status(agentMulti, '/ocall-stock/context')).toBe(200);
    // Fermé aussi dans Stock : compte Suite fermé, sessions révoquées.
    await a
      .patch(api(`/ocall-stock/members/${stock.member.id}`))
      .send({ isActive: false })
      .expect(200);
    expect(await membership()).toEqual({ role: 'PRODUCT_USER', isActive: false });
    expect(await status(agentMulti, '/ocall-stock/context')).toBe(401);
    // Réouvert dans Facture : compte rouvert, connexion possible, Stock toujours fermé.
    await a
      .patch(api(`/facture/members/${created.member.id}`))
      .send({ isActive: true })
      .expect(200);
    expect(await membership()).toEqual({ role: 'PRODUCT_USER', isActive: true });
    const again = await login(app, created.member.loginId, PASSWORD);
    expect(again.status).toBe(200);
    expect(await status(again.agent, '/facture/context')).toBe(200);
    expect(await status(again.agent, '/ocall-stock/context')).toBe(403);
  });

  describe('Ocall Stock : rôle propre à une boutique', () => {
    let bko: { id: string; general: string };
    let seg: { id: string; general: string };
    let kay: { id: string; general: string };
    let paint: string;
    let manager: { agent: Agent; id: string };

    async function site(code: string, name: string) {
      const s = (
        await a
          .post(api('/ocall-stock/sites'))
          .send({ code, name, kind: 'STORE', address: `Rue ${code}`, city: 'Bamako' })
          .expect(201)
      ).body;
      return { id: s.id as string, general: s.locations[0].id as string };
    }

    const move = (agent: Agent, locationId: string) =>
      agent
        .post(api('/ocall-stock/movements'))
        .send({ kind: 'IN', variantId: paint, locationId, quantity: 1, idempotencyKey: key() });

    const setSites = (memberId: string, body: Record<string, unknown>, agent: Agent = a) =>
      agent.put(api(`/ocall-stock/members/${memberId}/sites`)).send(body);

    beforeAll(async () => {
      bko = await site('BKO', 'Boutique Bamako');
      seg = await site('SEG', 'Boutique Ségou');
      kay = await site('KAY', 'Boutique Kayes');
      paint = (
        await a
          .post(api('/ocall-stock/products'))
          .send({ name: 'Peinture blanche 5 L', salePrice: 10_000 })
          .expect(201)
      ).body.variants[0].id;
      for (const s of [bko, seg]) await move(a, s.general).expect(201);
      const created = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Fatou', lastName: 'Gérante', role: 'STORE_MANAGER' })
          .expect(201)
      ).body;
      manager = {
        agent: await connect(created.member.loginId, created.temporaryPassword),
        id: created.member.id,
      };
    }, 120_000);

    it('sans rôle de boutique : rien ne change (rôle principal partout)', async () => {
      await setSites(manager.id, { siteIds: [bko.id, seg.id] }).expect(200);
      await move(manager.agent, bko.general).expect(201);
      await move(manager.agent, seg.general).expect(201);
      // Boutique non rattachée : invisible.
      expect((await move(manager.agent, kay.general)).status).toBe(404);
    });

    it('rôle de boutique inférieur : le geste est refusé dans cette boutique seulement', async () => {
      const saved = (
        await setSites(manager.id, {
          siteIds: [bko.id, seg.id],
          siteRoles: [{ siteId: seg.id, role: 'CASHIER' }],
        }).expect(200)
      ).body;
      expect(saved.siteRoles).toEqual([{ siteId: seg.id, role: 'CASHIER' }]);
      const listed = (await a.get(api('/ocall-stock/members')).expect(200)).body.find(
        (m: { id: string }) => m.id === manager.id,
      );
      expect(listed.siteRoles).toEqual([{ siteId: seg.id, role: 'CASHIER' }]);
      const before = await stockDb.stockMovement.count({
        where: { organizationId: org.organizationId, siteId: seg.id },
      });
      // Ségou : caissière (aucun mouvement manuel) ; Bamako : responsable.
      expect((await move(manager.agent, seg.general)).status).toBe(404);
      await move(manager.agent, bko.general).expect(201);
      expect(
        await stockDb.stockMovement.count({
          where: { organizationId: org.organizationId, siteId: seg.id },
        }),
      ).toBe(before);
      // Registre des mouvements : rien de Ségou (caissière), Bamako visible ; vue d'ensemble sans Ségou.
      const atSeg = (
        await manager.agent.get(api('/ocall-stock/movements')).query({ siteId: seg.id }).expect(200)
      ).body;
      expect(atSeg).toMatchObject({ items: [], total: 0 });
      const atBko = (
        await manager.agent.get(api('/ocall-stock/movements')).query({ siteId: bko.id }).expect(200)
      ).body;
      expect(atBko.total).toBeGreaterThan(0);
      const all = (await manager.agent.get(api('/ocall-stock/movements')).expect(200)).body;
      expect(all.total).toBe(atBko.total);
      // Le propriétaire voit bien des mouvements à Ségou : le filtre vient du rôle de boutique.
      const owner = (
        await a.get(api('/ocall-stock/movements')).query({ siteId: seg.id }).expect(200)
      ).body;
      expect(owner.total).toBeGreaterThan(0);
      // Stocks : la caissière les lit, Ségou reste visible.
      const levels = (
        await manager.agent.get(api('/ocall-stock/levels')).query({ siteId: seg.id }).expect(200)
      ).body;
      expect(levels.total).toBeGreaterThan(0);
    });

    it('rôle de boutique supérieur : jamais plus que le rôle principal', async () => {
      const created = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Ibrahim', lastName: 'Caisse', role: 'CASHIER' })
          .expect(201)
      ).body;
      const agent = await connect(created.member.loginId, created.temporaryPassword);
      await setSites(created.member.id, {
        siteIds: [bko.id],
        siteRoles: [{ siteId: bko.id, role: 'STORE_MANAGER' }],
      }).expect(200);
      expect((await move(agent, bko.general)).status).toBe(403);
      await agent.get(api('/ocall-stock/purchase-orders')).expect(403);
    });

    it('remise en caisse selon le rôle de la boutique de la caisse', async () => {
      const register = async (code: string, locationId: string) =>
        (
          await a
            .post(api('/ocall-stock/registers'))
            .send({ code, name: code, locationId })
            .expect(201)
        ).body.id as string;
      const rBko = await register(`B${Date.now() % 100000}`, bko.general);
      const rSeg = await register(`S${Date.now() % 100000}`, seg.general);
      for (const r of [rBko, rSeg]) {
        await manager.agent
          .post(api(`/ocall-stock/registers/${r}/sessions`))
          .send({ openingFloat: 0 })
          .expect(201);
      }
      const sell = (registerId: string) =>
        manager.agent.post(api('/ocall-stock/sales')).send({
          idempotencyKey: key(),
          registerId,
          lines: [{ variantId: paint, quantity: 1, discount: 500 }],
          payments: [{ method: 'CASH', amount: 9_500 }],
        });
      await sell(rBko).expect(201);
      const refused = await sell(rSeg).expect(403);
      expect(refused.body.code).toBe('STOCK_DISCOUNT_FORBIDDEN');
    });

    it('geste vérifié sur la boutique : magasinier à Ségou entre du stock mais n’ajuste pas', async () => {
      await setSites(manager.id, {
        siteIds: [bko.id, seg.id],
        siteRoles: [{ siteId: seg.id, role: 'STOREKEEPER' }],
      }).expect(200);
      const adjust = (locationId: string) =>
        manager.agent.post(api('/ocall-stock/movements')).send({
          kind: 'ADJUSTMENT',
          variantId: paint,
          locationId,
          quantity: -1,
          reason: 'Casse constatée',
          idempotencyKey: key(),
        });
      // La route accepte « entrer » OU « ajuster » : Ségou reste visible, le geste précis est refusé.
      await move(manager.agent, seg.general).expect(201);
      const refused = await adjust(seg.general).expect(403);
      expect(refused.body.code).toBe('FORBIDDEN');
      await adjust(bko.general).expect(201);
    });

    it('tableau de bord : chaque section sur les seules boutiques où le rôle la permet', async () => {
      await setSites(manager.id, {
        siteIds: [bko.id, seg.id],
        siteRoles: [{ siteId: seg.id, role: 'CASHIER' }],
      }).expect(200);
      const supplierId = (
        await a
          .post(api('/ocall-stock/suppliers'))
          .send({ name: 'Grossiste Sahel Distribution' })
          .expect(201)
      ).body.id;
      const order = (
        await a
          .post(api('/ocall-stock/purchase-orders'))
          .send({
            supplierId,
            siteId: seg.id,
            lines: [{ variantId: paint, quantity: 4, unitCost: 6_000, vatRate: 18 }],
          })
          .expect(201)
      ).body.id;
      await a.post(api(`/ocall-stock/purchase-orders/${order}/order`)).expect(200);
      const dashboard = (agent: Agent) =>
        agent
          .get(api('/ocall-stock/reports/dashboard'))
          .expect(200)
          .then((r) => r.body);
      const forOwner = await dashboard(a);
      const forManager = await dashboard(manager.agent);
      // Commande de Ségou : vue par le propriétaire, pas par la caissière de Ségou.
      expect(forOwner.purchases.orders).toBeGreaterThanOrEqual(1);
      expect(forManager.purchases.orders).toBe(0);
      // Ventes : la caissière de Ségou les voit (remise refusée plus haut, vente de Bamako comptée).
      expect(forManager.sales.count).toBeGreaterThanOrEqual(1);
      // Par rôle de boutique Ségou « caissière » : achats invisibles même en filtrant sur Ségou.
      const filtered = (
        await manager.agent
          .get(api('/ocall-stock/reports/dashboard'))
          .query({ siteId: seg.id })
          .expect(200)
      ).body;
      expect(filtered.purchases.orders).toBe(0);
    });

    it('contrôles : rôle de boutique sur un site rattaché, jamais administrateur, ni pour un administrateur', async () => {
      const outside = await setSites(manager.id, {
        siteIds: [bko.id],
        siteRoles: [{ siteId: seg.id, role: 'CASHIER' }],
      }).expect(400);
      expect(outside.body.code).toBe('STOCK_SITE_ROLES');
      await setSites(manager.id, {
        siteIds: [bko.id],
        siteRoles: [{ siteId: bko.id, role: 'ADMIN' }],
      }).expect(400);
      const admin = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Kadi', lastName: 'Admin', role: 'ADMIN' })
          .expect(201)
      ).body;
      const forAdmin = await setSites(admin.member.id, {
        siteIds: [bko.id],
        siteRoles: [{ siteId: bko.id, role: 'CASHIER' }],
      }).expect(400);
      expect(forAdmin.body.code).toBe('STOCK_SITE_ROLES_ADMIN');
      // Autre organisation : ni le membre ni la boutique.
      await setSites(manager.id, { siteIds: [bko.id] }, other.agent).expect(404);
      // La base refuse un rôle de boutique administrateur.
      await expect(
        stockDb.$executeRaw`UPDATE "StockMemberSite" SET role = 'ADMIN' WHERE "memberId" = ${manager.id}::uuid`,
      ).rejects.toThrow(/StockMemberSite_role_check/);
      // Le membre ne modifie pas ses propres boutiques (réservé aux administrateurs).
      await setSites(manager.id, { siteIds: [] }, manager.agent).expect(403);
    });
  });
});
