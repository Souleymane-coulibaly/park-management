import type { INestApplication } from '@nestjs/common';
import { STOCK_PRODUCT_CODE } from '@ocall/shared';
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
 * Ocall Suite — Sprint 2, étape B : référentiel commun des sites (établissements Suite réutilisés).
 * - Un lieu est enregistré une seule fois ; plusieurs applications l'utilisent (Park, Stock, School) ;
 *   le référentiel montre, pour chaque site, les applications qui l'utilisent, sans doublon.
 * - Enseignes (facultatives) ; lieux sans activité Park pour les autres applications.
 * - Rattachement explicite seulement : les correspondances proposées ne sont jamais appliquées ; un lieu
 *   d'une autre organisation est introuvable ; un lieu désactivé ou déjà pris est refusé.
 * - Désactivation globale d'un membre (Park) et retrait d'un rôle applicatif : effets distincts.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };
const enabled = Boolean(
  process.env.TEST_STOCK_DATABASE_URL && process.env.TEST_SCHOOL_DATABASE_URL,
);

interface RegistryRow {
  id: string;
  name: string;
  kind: string | null;
  businessType: string;
  brandId: string | null;
  isActive: boolean;
  applications: { product: string; appSiteId: string | null; appSiteName: string }[];
}

(enabled ? describe : describe.skip)('Ocall Suite S2B — référentiel commun des sites', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stockDb: OcallStockPrismaService;
  let schoolDb: SchoolPrismaService;
  let platform: InternalAccount;
  let org: SignedUpOwner;
  let other: SignedUpOwner;
  let a: Agent;
  let park: { id: string; name: string };
  let otherSite: string;
  let legacy: string; // site Stock créé « avant » le référentiel, jamais rattaché automatiquement
  let schoolId: string;
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

  async function stockTrial(organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: STOCK_PRODUCT_CODE },
    });
    const plan = await prisma.subscriptionPlan.create({
      data: {
        productId: product.id,
        name: `S2B stock ${organizationId.slice(0, 8)} ${RUN}`,
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

  const registry = async (agent: Agent = a) =>
    (await agent.get(api('/establishments/registry')).expect(200)).body as RegistryRow[];
  const stockSite = (code: string, name: string, extra: Record<string, unknown> = {}) =>
    a.post(api('/ocall-stock/sites')).send({ code, name, kind: 'STORE', city: 'Bamako', ...extra });
  const link = (siteId: string, body: Record<string, unknown>, agent: Agent = a) =>
    agent.put(api(`/ocall-stock/sites/${siteId}/establishment`)).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockDb = app.get(OcallStockPrismaService);
    schoolDb = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `s2b-owner-${RUN}`, 'PLATFORM_OWNER');
    org = await signup(app, 's2bSites', 'PARK');
    other = await signup(app, 's2bOther', 'PARK');
    a = org.agent;
    await stockTrial(org.organizationId);
    await stockTrial(other.organizationId);
    const contract = (
      await platform.agent
        .post(api('/platform/contracts'))
        .send({ organizationId: org.organizationId, reference: `S2B-${RUN}`, ...TERMS })
        .expect(201)
    ).body;
    await platform.agent
      .post(api(`/platform/contracts/${contract.id}/status`))
      .send({ status: 'ACTIVE', reason: 'Décision de test' })
      .expect(200);
    const establishments = (await a.get(api('/establishments')).expect(200)).body;
    park = { id: establishments[0].id, name: establishments[0].name };
    otherSite = (await other.agent.get(api('/establishments')).expect(200)).body[0].id;
    legacy = (await stockSite('ANC', 'Boutique Ségou').expect(201)).body.id;
  }, 300_000);

  afterAll(async () => {
    try {
      const ids = [org?.organizationId, other?.organizationId].filter(Boolean) as string[];
      if (stockDb && ids.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(stockDb, ids);
      }
      if (schoolDb && ids.length) {
        const where = { organizationId: { in: ids } };
        await schoolDb.schoolAccessDecision.deleteMany({ where });
        await schoolDb.schoolMember.deleteMany({ where });
        await schoolDb.school.deleteMany({ where });
        await schoolDb.schoolGroup.deleteMany({ where });
      }
      if (prisma) {
        await prisma.establishment.updateMany({
          where: { organizationId: { in: ids } },
          data: { brandId: null },
        });
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('référentiel : établissements existants réutilisés, lieu sans activité Park, enseigne', async () => {
    // L'établissement Park existant est déjà dans le référentiel, utilisé par Ocall Park.
    const before = await registry();
    const existing = before.find((s) => s.id === park.id)!;
    expect(existing).toMatchObject({ kind: null, brandId: null });
    expect(existing.applications.map((u) => u.product)).toEqual(['OCALL_PARK']);
    // Enseigne, puis boutique sans activité Park rattachée à l'enseigne.
    const brand = (
      await a.post(api('/establishments/brands')).send({ name: 'Quincaillerie Sahel' }).expect(201)
    ).body;
    const dup = await a
      .post(api('/establishments/brands'))
      .send({ name: 'Quincaillerie Sahel' })
      .expect(409);
    expect(dup.body.code).toBe('BRAND_NAME_TAKEN');
    const shop = (
      await a
        .post(api('/establishments'))
        .send({
          name: 'Boutique Bamako',
          businessType: 'NONE',
          kind: 'SHOP',
          brandId: brand.id,
          city: 'Bamako',
        })
        .expect(201)
    ).body;
    expect(shop).toMatchObject({ kind: 'SHOP', brandId: brand.id, businessType: 'NONE' });
    const row = (await registry()).find((s) => s.id === shop.id)!;
    expect(row.applications).toEqual([]);
    // Une boutique sans activité Park n'est vendable ni en caisse Park ni en billetterie.
    const ticketing = (await a.get(api('/ticketing/establishments')).expect(200)).body as {
      id: string;
    }[];
    expect(ticketing.map((e) => e.id)).toContain(park.id);
    expect(ticketing.map((e) => e.id)).not.toContain(shop.id);
    // Enseigne d'une autre organisation : introuvable ; nature inconnue : refusée.
    const foreignBrand = (
      await other.agent.post(api('/establishments/brands')).send({ name: 'Autre' }).expect(201)
    ).body;
    const refused = await a
      .patch(api(`/establishments/${shop.id}`))
      .send({ brandId: foreignBrand.id })
      .expect(404);
    expect(refused.body.code).toBe('BRAND_NOT_FOUND');
    await a
      .patch(api(`/establishments/${shop.id}`))
      .send({ kind: 'CASTLE' })
      .expect(400);
    // L'autre organisation ne voit ni la boutique ni l'enseigne.
    expect((await registry(other.agent)).map((s) => s.id)).not.toContain(shop.id);
    const otherBrands = (await other.agent.get(api('/establishments/brands')).expect(200)).body;
    expect(otherBrands.map((b: { id: string }) => b.id)).not.toContain(brand.id);
  });

  it('Stock : suggestion jamais appliquée, rattachement explicite d’un lieu partagé avec Park', async () => {
    // Un lieu du référentiel porte le même nom que le site Stock existant : simple suggestion.
    const same = (
      await a
        .post(api('/establishments'))
        .send({ name: 'Boutique Ségou', businessType: 'NONE', kind: 'SHOP', city: 'Bamako' })
        .expect(201)
    ).body;
    const view = (await a.get(api('/ocall-stock/sites/registry')).expect(200)).body;
    expect(view.suggestions).toContainEqual({
      siteId: legacy,
      establishmentId: same.id,
      reason: 'same-name',
    });
    const untouched = await stockDb.stockSite.findUniqueOrThrow({ where: { id: legacy } });
    expect(untouched.establishmentId).toBeNull();
    // Rattachement explicite : le lieu Park existant devient aussi un site Stock (une seule fiche).
    const linked = (await link(legacy, { establishmentId: park.id }).expect(200)).body;
    expect(linked.establishmentId).toBe(park.id);
    const shared = (await registry()).filter((s) => s.id === park.id);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.applications.map((u) => u.product).sort()).toEqual([
      'OCALL_PARK',
      'OCALL_STOCK',
    ]);
    // Un second site Stock ne peut pas prendre le même lieu.
    const second = (await stockSite('SEG2', 'Annexe Ségou').expect(201)).body.id;
    const taken = await link(second, { establishmentId: park.id }).expect(409);
    expect(taken.body.code).toBe('STOCK_SITE_ESTABLISHMENT_TAKEN');
    // Lieu d'une autre organisation : introuvable ; choix ambigu : refusé.
    const foreign = await link(second, { establishmentId: otherSite }).expect(404);
    expect(foreign.body.code).toBe('ESTABLISHMENT_NOT_FOUND');
    await link(second, { establishmentId: same.id, createEstablishment: true }).expect(400);
    await link(second, {}).expect(400);
    // Lieu désactivé : refusé.
    await a
      .patch(api(`/establishments/${same.id}`))
      .send({ isActive: false })
      .expect(200);
    const inactive = await link(second, { establishmentId: same.id }).expect(409);
    expect(inactive.body.code).toBe('ESTABLISHMENT_INACTIVE');
    // Retrait du rattachement : le site Stock reste, le lieu Park aussi.
    await link(legacy, { establishmentId: null }).expect(200);
    expect(
      (await registry()).find((s) => s.id === park.id)!.applications.map((u) => u.product),
    ).toEqual(['OCALL_PARK']);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: org.organizationId,
          action: { in: ['stock.site_establishment_linked', 'stock.site_establishment_unlinked'] },
        },
      }),
    ).toBe(2);
  });

  it('Stock : création du lieu en même temps que le site, nom déjà pris refusé sans rien créer', async () => {
    const created = (
      await stockSite('KAY', 'Boutique Kayes', { createEstablishment: true }).expect(201)
    ).body;
    expect(created.establishmentId).toBeTruthy();
    const est = (await registry()).find((s) => s.id === created.establishmentId)!;
    expect(est).toMatchObject({ name: 'Boutique Kayes', kind: 'SHOP', businessType: 'NONE' });
    expect(est.applications).toEqual([
      expect.objectContaining({ product: 'OCALL_STOCK', appSiteId: created.id }),
    ]);
    // Même nom qu'un lieu existant : 409, ni lieu ni site Stock en double.
    const sites = await stockDb.stockSite.count({ where: { organizationId: org.organizationId } });
    const establishments = await prisma.establishment.count({
      where: { organizationId: org.organizationId },
    });
    const dup = await stockSite('KAY2', 'Boutique Kayes', { createEstablishment: true }).expect(
      409,
    );
    expect(dup.body.code).toBe('ESTABLISHMENT_NAME_TAKEN');
    // Code de site déjà pris : refusé avant de créer le lieu.
    await stockSite('KAY', 'Nouveau nom', { createEstablishment: true }).expect(409);
    expect(await stockDb.stockSite.count({ where: { organizationId: org.organizationId } })).toBe(
      sites,
    );
    expect(
      await prisma.establishment.count({ where: { organizationId: org.organizationId } }),
    ).toBe(establishments);
    // Création avec un lieu existant d'une autre organisation : refusée, aucun site créé.
    await stockSite('ETR', 'Étranger', { establishmentId: otherSite }).expect(404);
    expect(await stockDb.stockSite.count({ where: { organizationId: org.organizationId } })).toBe(
      sites,
    );
  });

  it('droits : un responsable Stock sans gestion des sites ne rattache rien ; un administrateur Stock ne modifie pas le référentiel', async () => {
    const add = async (role: string, lastName: string) => {
      const created = (
        await a
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Membre', lastName, role })
          .expect(201)
      ).body;
      return connect(created.member.loginId, created.temporaryPassword);
    };
    const manager = await add('STORE_MANAGER', 'Gérant');
    await manager.get(api('/ocall-stock/sites/registry')).expect(403);
    await link(legacy, { establishmentId: park.id }, manager).expect(403);
    const admin = await add('ADMIN', 'Admin');
    // L'administrateur Stock rattache, mais ne touche pas aux établissements eux-mêmes (droit Suite).
    await link(legacy, { establishmentId: park.id }, admin).expect(200);
    await admin
      .patch(api(`/establishments/${park.id}`))
      .send({ name: 'Piraté' })
      .expect(403);
    await admin.get(api('/establishments/registry')).expect(403);
    await link(legacy, { establishmentId: null }, admin).expect(200);
    // Site Stock d'une autre organisation : introuvable, même pour son administrateur.
    const foreign = await link(legacy, { establishmentId: otherSite }, other.agent).expect(404);
    expect(foreign.body.code).toBe('STOCK_SITE_NOT_FOUND');
    await other.agent.get(api('/ocall-stock/sites/registry')).expect(200);
    const otherView = (await other.agent.get(api('/ocall-stock/sites/registry')).expect(200)).body;
    expect(otherView.establishments.map((e: { id: string }) => e.id)).not.toContain(park.id);
  });

  it('School : une école rattachée à un lieu du référentiel, une seule par lieu', async () => {
    schoolId = (
      await a
        .post(api('/school/schools'))
        .send({ name: 'École Les Baobabs', type: 'PRIMARY', countryCode: 'ML' })
        .expect(201)
    ).body.id;
    const view = (await a.get(api('/school/schools/registry')).expect(200)).body;
    expect(view.establishments.map((e: { id: string }) => e.id)).toContain(park.id);
    const linked = (
      await a
        .put(api(`/school/schools/${schoolId}/establishment`))
        .send({ createEstablishment: true })
        .expect(200)
    ).body;
    expect(linked.establishmentId).toBeTruthy();
    const row = (await registry()).find((s) => s.id === linked.establishmentId)!;
    expect(row).toMatchObject({ name: 'École Les Baobabs', kind: 'SCHOOL' });
    expect(row.applications.map((u) => u.product)).toEqual(['OCALL_SCHOOL']);
    const second = (
      await a
        .post(api('/school/schools'))
        .send({ name: 'Annexe Baobabs', type: 'PRIMARY', countryCode: 'ML' })
        .expect(201)
    ).body.id;
    const taken = await a
      .put(api(`/school/schools/${second}/establishment`))
      .send({ establishmentId: linked.establishmentId })
      .expect(409);
    expect(taken.body.code).toBe('SCHOOL_ESTABLISHMENT_TAKEN');
    await a
      .put(api(`/school/schools/${second}/establishment`))
      .send({ establishmentId: otherSite })
      .expect(404);
    // Le contexte School expose le lieu rattaché.
    const context = (await a.get(api('/school/context')).expect(200)).body;
    expect(context.schools.find((s: { id: string }) => s.id === schoolId).establishmentId).toBe(
      linked.establishmentId,
    );
  });

  it('désactivation globale (Park) et retrait d’un rôle applicatif : effets distincts', async () => {
    const establishments = (await a.get(api('/establishments')).expect(200)).body;
    const employee = (
      await a
        .post(api('/employees'))
        .send({
          firstName: 'Awa',
          lastName: 'Globale',
          role: 'CASHIER',
          establishmentIds: [establishments.find((e: { id: string }) => e.id === park.id).id],
        })
        .expect(201)
    ).body;
    const agent = await connect(employee.employee.loginId, employee.temporaryPassword);
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginId: employee.employee.loginId },
      select: { id: true },
    });
    const member = (
      await a
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: user.id, role: 'CASHIER' })
        .expect(201)
    ).body.member;
    await agent.get(api('/ocall-stock/context')).expect(200);
    // Retrait du rôle Stock : Park reste ouvert.
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: false })
      .expect(200);
    await agent.get(api('/ocall-stock/context')).expect(403);
    expect((await agent.get(api('/auth/me')).expect(200)).body.role).toBe('CASHIER');
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: true })
      .expect(200);
    await agent.get(api('/ocall-stock/context')).expect(200);
    // Désactivation globale (Park) : plus aucune application, sessions fermées.
    await a.post(api(`/employees/${employee.employee.id}/deactivate`)).expect(200);
    expect((await agent.get(api('/ocall-stock/context'))).status).toBe(401);
    // Une réactivation dans Stock ne rouvre pas un compte fermé globalement.
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: false })
      .expect(200);
    await a
      .patch(api(`/ocall-stock/members/${member.id}`))
      .send({ isActive: true })
      .expect(200);
    expect(
      (
        await prisma.organizationMembership.findUniqueOrThrow({
          where: {
            organizationId_userId: { organizationId: org.organizationId, userId: user.id },
          },
          select: { isActive: true },
        })
      ).isActive,
    ).toBe(false);
    expect((await login(app, employee.employee.loginId, PASSWORD)).status).not.toBe(200);
  });
});
