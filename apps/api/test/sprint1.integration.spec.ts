import type { INestApplication } from '@nestjs/common';
import { hash } from 'argon2';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  PASSWORD,
  RUN,
  type SignedUpOwner,
  agent,
  cleanup,
  createTestApp,
  email,
  login,
  signup,
} from './helpers';

/**
 * Tests d'intégration du Sprint 1, exécutés contre une vraie base PostgreSQL (Neon, branche de dev).
 * Chaque exécution crée ses propres organisations et les supprime à la fin.
 */
describe('Sprint 1 — socle SaaS (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let parkA: SignedUpOwner;
  let restoB: SignedUpOwner;
  let establishmentA: string;
  let establishmentB: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    parkA = await signup(app, 'parka', 'PARK');
    restoB = await signup(app, 'restob', 'RESTAURANT');
    establishmentA = (await parkA.agent.get('/api/v1/establishments').expect(200)).body[0].id;
    establishmentB = (await restoB.agent.get('/api/v1/establishments').expect(200)).body[0].id;
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  describe("création d'organisation", () => {
    it("crée l'organisation, le propriétaire, un établissement et un abonnement non activé", async () => {
      const me = await parkA.agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.role).toBe('OWNER');
      expect(me.body.organization.businessType).toBe('PARK');
      expect(me.body.organization.timezone).toBe('Africa/Bamako');
      expect(me.body.user.loginId).toMatch(/^[A-Z0-9]+-0001$/);

      const sub = await parkA.agent.get('/api/v1/subscription').expect(200);
      expect(sub.body.status).toBe('NOT_ACTIVATED');
      expect(sub.body.plan.businessType).toBe('PARK');
      expect(sub.body.events[0].type).toBe('CREATED');
    });

    it('refuse un e-mail déjà utilisé', async () => {
      const res = await agent(app).post('/api/v1/auth/signup').send({
        organizationName: 'Doublon',
        businessType: 'PARK',
        countryCode: 'ML',
        establishmentName: 'Site X',
        firstName: 'A',
        lastName: 'B',
        email: parkA.email,
        password: PASSWORD,
      });
      expect(res.status).toBe(409);
    });

    it('refuse un mot de passe faible', async () => {
      const res = await agent(app)
        .post('/api/v1/auth/signup')
        .send({
          organizationName: 'Faible',
          businessType: 'PARK',
          countryCode: 'ML',
          establishmentName: 'Site X',
          firstName: 'A',
          lastName: 'B',
          email: email('weak'),
          password: 'motdepasse',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('WEAK_PASSWORD');
    });

    it('les prix des offres viennent de la base', async () => {
      const plans = await agent(app).get('/api/v1/plans').expect(200);
      const prices = Object.fromEntries(
        plans.body.map((p: { businessType: string; monthlyPrice: number }) => [
          p.businessType,
          p.monthlyPrice,
        ]),
      );
      expect(Object.keys(prices).sort()).toEqual(['PARK', 'PARK_RESTAURANT', 'RESTAURANT']);
    });
  });

  describe('connexion', () => {
    it('connexion valide par e-mail et par identifiant', async () => {
      expect((await login(app, parkA.email, PASSWORD)).status).toBe(200);
      expect((await login(app, parkA.loginId.toLowerCase(), PASSWORD)).status).toBe(200);
    });

    it('connexion invalide : message générique, sans distinguer compte inconnu et mauvais mot de passe', async () => {
      const wrong = await login(app, parkA.email, 'MauvaisMotDePasse1');
      const unknown = await login(app, email('inconnu'), 'MauvaisMotDePasse1');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('verrouille le compte après des échecs répétés', async () => {
      const victim = await signup(app, 'lock', 'PARK');
      for (let i = 0; i < 3; i++) await login(app, victim.email, 'MauvaisMotDePasse1');
      const locked = await login(app, victim.email, PASSWORD);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('déconnexion : la session est révoquée côté serveur', async () => {
      const session = await login(app, parkA.email, PASSWORD);
      await session.agent.post('/api/v1/auth/logout').expect(204);
      await session.agent.get('/api/v1/auth/me').expect(401);
    });

    it('refuse une requête sans session', async () => {
      await agent(app).get('/api/v1/establishments').expect(401);
    });
  });

  describe('employés et mot de passe initial', () => {
    let cashierId: string;
    let cashierLoginId: string;
    let cashierTempPassword: string;

    it('crée un employé avec identifiant individuel et mot de passe temporaire', async () => {
      const res = await parkA.agent
        .post('/api/v1/employees')
        .send({
          firstName: 'Moussa',
          lastName: 'Diarra',
          role: 'CASHIER',
          establishmentIds: [establishmentA],
        })
        .expect(201);
      cashierId = res.body.employee.id;
      cashierLoginId = res.body.employee.loginId;
      cashierTempPassword = res.body.temporaryPassword;
      expect(cashierLoginId).toMatch(/-0002$/);
      expect(res.body.employee.mustChangePassword).toBe(true);
    });

    it('impose le changement du mot de passe initial avant tout accès', async () => {
      const session = await login(app, cashierLoginId, cashierTempPassword);
      expect(session.status).toBe(200);
      expect(session.body.user.mustChangePassword).toBe(true);

      const blocked = await session.agent.get('/api/v1/dashboard');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      await session.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: cashierTempPassword, newPassword: PASSWORD })
        .expect(204);
      await session.agent.get('/api/v1/dashboard').expect(200);
    });

    it('permissions : un caissier ne gère ni employés ni établissements', async () => {
      const cashier = await login(app, cashierLoginId, PASSWORD);
      await cashier.agent.get('/api/v1/employees').expect(403);
      await cashier.agent
        .post('/api/v1/establishments')
        .send({ name: 'Pirate', businessType: 'PARK' })
        .expect(403);
      await cashier.agent.get('/api/v1/audit-logs').expect(403);
      expect(cashier.body.navigation.map((n: { key: string }) => n.key)).not.toContain('employees');
    });

    it('refuse un rôle KITCHEN dans une organisation PARK', async () => {
      const res = await parkA.agent.post('/api/v1/employees').send({
        firstName: 'Fanta',
        lastName: 'Keita',
        role: 'KITCHEN',
        establishmentIds: [establishmentA],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ROLE_NOT_AVAILABLE');
    });

    it('désactive un employé et révoque immédiatement ses sessions', async () => {
      const cashier = await login(app, cashierLoginId, PASSWORD);
      await cashier.agent.get('/api/v1/auth/me').expect(200);
      const res = await parkA.agent.post(`/api/v1/employees/${cashierId}/deactivate`).expect(200);
      expect(res.body.isActive).toBe(false);
      await cashier.agent.get('/api/v1/auth/me').expect(401);
      expect((await login(app, cashierLoginId, PASSWORD)).status).toBe(403);
      await parkA.agent.post(`/api/v1/employees/${cashierId}/reactivate`).expect(200);
    });

    it('un ADMIN ne peut ni créer un OWNER ni gérer un OWNER', async () => {
      const created = await parkA.agent
        .post('/api/v1/employees')
        .send({ firstName: 'Ibrahim', lastName: 'Coulibaly', role: 'ADMIN', establishmentIds: [] })
        .expect(201);
      const admin = await login(app, created.body.employee.loginId, created.body.temporaryPassword);
      await admin.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
        .expect(204);

      const res = await admin.agent
        .post('/api/v1/employees')
        .send({ firstName: 'X', lastName: 'Y', role: 'OWNER', establishmentIds: [] });
      expect(res.status).toBe(403);
      const owners = (await admin.agent.get('/api/v1/employees').expect(200)).body.filter(
        (e: { role: string }) => e.role === 'OWNER',
      );
      await admin.agent.post(`/api/v1/employees/${owners[0].id}/deactivate`).expect(403);
      await admin.agent
        .post('/api/v1/organization/business-type')
        .send({ businessType: 'PARK_RESTAURANT' })
        .expect(403);
    });
  });

  describe('isolation multi-tenant', () => {
    it('A ne voit que ses propres établissements et employés', async () => {
      const establishments = (await parkA.agent.get('/api/v1/establishments').expect(200)).body;
      expect(establishments.map((e: { id: string }) => e.id)).not.toContain(establishmentB);
      const employees = (await parkA.agent.get('/api/v1/employees').expect(200)).body;
      expect(employees.every((e: { email: string | null }) => e.email !== restoB.email)).toBe(true);
    });

    it('A ne peut ni lire ni modifier un établissement de B (404, sans révéler son existence)', async () => {
      await parkA.agent.get(`/api/v1/establishments/${establishmentB}`).expect(404);
      await parkA.agent
        .patch(`/api/v1/establishments/${establishmentB}`)
        .send({ name: 'Piraté' })
        .expect(404);
      const intact = await restoB.agent.get(`/api/v1/establishments/${establishmentB}`).expect(200);
      expect(intact.body.name).not.toBe('Piraté');
    });

    it('A ne peut pas agir sur un employé de B', async () => {
      const ownerB = (await restoB.agent.get('/api/v1/employees').expect(200)).body[0];
      await parkA.agent.get(`/api/v1/employees/${ownerB.id}`).expect(404);
      await parkA.agent.post(`/api/v1/employees/${ownerB.id}/deactivate`).expect(404);
      await parkA.agent.post(`/api/v1/employees/${ownerB.id}/reset-password`).expect(404);
    });

    it('A ne peut pas affecter un employé à un établissement de B', async () => {
      const res = await parkA.agent.post('/api/v1/employees').send({
        firstName: 'Seydou',
        lastName: 'Sangaré',
        role: 'GATE_AGENT',
        establishmentIds: [establishmentB],
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ESTABLISHMENT');
    });

    it('un organizationId transmis par le client est refusé', async () => {
      const res = await parkA.agent
        .post('/api/v1/establishments')
        .send({ name: 'Intrus', businessType: 'PARK', organizationId: restoB.organizationId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it("le journal d'audit est cloisonné par organisation", async () => {
      const logsA = (await parkA.agent.get('/api/v1/audit-logs').expect(200)).body;
      expect(logsA.length).toBeGreaterThan(0);
      const idsB = new Set([restoB.organizationId, establishmentB]);
      expect(logsA.some((l: { targetId: string }) => idsB.has(l.targetId))).toBe(false);
    });
  });

  describe('établissements', () => {
    it('crée un établissement compatible et refuse une activité non couverte', async () => {
      const ok = await parkA.agent
        .post('/api/v1/establishments')
        .send({ name: `Annexe ${Date.now()}`, businessType: 'PARK', city: 'Ségou' })
        .expect(201);
      expect(ok.body.timezone).toBe('Africa/Bamako');
      const ko = await parkA.agent
        .post('/api/v1/establishments')
        .send({ name: 'Snack', businessType: 'RESTAURANT' });
      expect(ko.status).toBe(400);
      expect(ko.body.code).toBe('INCOMPATIBLE_BUSINESS_TYPE');
    });
  });

  describe('protection du dernier propriétaire', () => {
    it('le propriétaire unique ne peut ni se désactiver ni se rétrograder', async () => {
      const solo = await signup(app, 'solo', 'RESTAURANT');
      const [owner] = (await solo.agent.get('/api/v1/employees').expect(200)).body;
      const deactivate = await solo.agent.post(`/api/v1/employees/${owner.id}/deactivate`);
      expect(deactivate.status).toBe(403);
      expect(deactivate.body.code).toBe('SELF_ACTION_FORBIDDEN');
      await solo.agent
        .put(`/api/v1/employees/${owner.id}/role`)
        .send({ role: 'ADMIN' })
        .expect(403);
      const after = (await solo.agent.get('/api/v1/employees').expect(200)).body[0];
      expect(after).toMatchObject({ role: 'OWNER', isActive: true });
    });

    it("plusieurs propriétaires sont autorisés et l'un peut retirer l'autre", async () => {
      const org = await signup(app, 'duo', 'PARK');
      const second = await org.agent
        .post('/api/v1/employees')
        .send({ firstName: 'Aminata', lastName: 'Sidibé', role: 'OWNER', establishmentIds: [] })
        .expect(201);
      await org.agent.post(`/api/v1/employees/${second.body.employee.id}/deactivate`).expect(200);
    });

    it("deux propriétaires qui se rétrogradent simultanément : l'organisation garde un OWNER actif", async () => {
      const org = await signup(app, 'race', 'PARK');
      const [first] = (await org.agent.get('/api/v1/employees').expect(200)).body;
      const created = await org.agent
        .post('/api/v1/employees')
        .send({ firstName: 'Oumar', lastName: 'Touré', role: 'OWNER', establishmentIds: [] })
        .expect(201);
      const secondSession = await login(
        app,
        created.body.employee.loginId,
        created.body.temporaryPassword,
      );
      await secondSession.agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: created.body.temporaryPassword, newPassword: PASSWORD })
        .expect(204);

      const [a, b] = await Promise.all([
        org.agent.put(`/api/v1/employees/${created.body.employee.id}/role`).send({ role: 'ADMIN' }),
        secondSession.agent.put(`/api/v1/employees/${first.id}/role`).send({ role: 'ADMIN' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(200);
      // Le perdant est refusé soit par le verrou (409 LAST_OWNER), soit parce qu'il n'est déjà plus OWNER (403).
      expect([403, 409]).toContain(statuses[1]);
      const owners = await prisma.organizationMembership.count({
        where: { organizationId: org.organizationId, role: 'OWNER', isActive: true },
      });
      expect(owners).toBe(1);
    });
  });

  describe('métier', () => {
    it('PARK → PARK_RESTAURANT : données conservées, offre et navigation mises à jour', async () => {
      const before = (await parkA.agent.get('/api/v1/establishments').expect(200)).body.length;
      const res = await parkA.agent
        .post('/api/v1/organization/business-type')
        .send({ businessType: 'PARK_RESTAURANT' })
        .expect(201);
      expect(res.body.businessType).toBe('PARK_RESTAURANT');
      expect((await parkA.agent.get('/api/v1/establishments').expect(200)).body.length).toBe(
        before,
      );

      const sub = await parkA.agent.get('/api/v1/subscription').expect(200);
      expect(sub.body.plan.businessType).toBe('PARK_RESTAURANT');
      expect(sub.body.events[0].type).toBe('PLAN_CHANGED');

      const me = await parkA.agent.get('/api/v1/auth/me').expect(200);
      const keys = me.body.navigation.map((n: { key: string }) => n.key);
      expect(keys).toEqual(expect.arrayContaining(['ticketing', 'pos', 'kitchen']));
    });

    it('refuse une rétrogradation ou un changement latéral', async () => {
      await restoB.agent
        .post('/api/v1/organization/business-type')
        .send({ businessType: 'PARK' })
        .expect(400);
    });

    it("l'accès aux modules est vérifié côté serveur selon le métier", async () => {
      await restoB.agent.get('/api/v1/modules/ticketing').expect(403);
      // Sprint 2 : la caisse est disponible ; Sprint 5 : la cuisine (KDS) aussi ; le CRM reste annoncé « à venir ».
      const pos = await restoB.agent.get('/api/v1/modules/pos').expect(200);
      expect(pos.body.status).toBe('available');
      const kitchen = await restoB.agent.get('/api/v1/modules/kitchen').expect(200);
      expect(kitchen.body.status).toBe('available');
      const crm = await restoB.agent.get('/api/v1/modules/crm').expect(200);
      expect(crm.body.status).toBe('upcoming');
      await restoB.agent.get('/api/v1/modules/inconnu').expect(404);
    });
  });

  describe('Super Admin', () => {
    let superAdmin: Awaited<ReturnType<typeof login>>;

    beforeAll(async () => {
      const adminEmail = email('superadmin');
      await prisma.user.create({
        data: {
          email: adminEmail,
          loginId: adminEmail,
          firstName: 'Super',
          lastName: 'Admin',
          platformRole: 'SUPER_ADMIN',
          mustChangePassword: false,
          passwordHash: await hash(PASSWORD, { type: 2 }),
        },
      });
      superAdmin = await login(app, adminEmail, PASSWORD);
      expect(superAdmin.status).toBe(200);
    });

    it('accède à la vue synthétique et aux organisations, sans les données nominatives', async () => {
      const overview = await superAdmin.agent.get('/api/v1/platform/overview').expect(200);
      expect(overview.body.organizations.total).toBeGreaterThanOrEqual(2);
      const orgs = (await superAdmin.agent.get('/api/v1/platform/organizations').expect(200)).body;
      const a = orgs.find((o: { id: string }) => o.id === parkA.organizationId);
      expect(a).toMatchObject({ businessType: 'PARK_RESTAURANT', status: 'ACTIVE' });
      expect(a).not.toHaveProperty('memberships');
    });

    it("n'a pas accès aux données métier des clients", async () => {
      await superAdmin.agent.get('/api/v1/employees').expect(403);
      await superAdmin.agent.get('/api/v1/establishments').expect(403);
      await superAdmin.agent.get('/api/v1/audit-logs').expect(403);
    });

    it("un propriétaire n'a pas accès à l'espace Super Admin", async () => {
      await parkA.agent.get('/api/v1/platform/organizations').expect(403);
    });

    it('crée une organisation avec un propriétaire au mot de passe temporaire', async () => {
      const res = await superAdmin.agent
        .post('/api/v1/platform/organizations')
        .send({
          organizationName: `Test admincreated ${RUN}`,
          businessType: 'RESTAURANT',
          countryCode: 'SN',
          establishmentName: 'Dakar Plateau',
          ownerFirstName: 'Fatou',
          ownerLastName: 'Ndiaye',
          ownerEmail: email('admincreated'),
        })
        .expect(201);
      const owner = await login(app, res.body.ownerEmail, res.body.temporaryPassword);
      expect(owner.status).toBe(200);
      expect(owner.body.user.mustChangePassword).toBe(true);
      expect(owner.body.organization.timezone).toBe('Africa/Dakar');
    });

    it('suspend une organisation : sessions révoquées, connexion refusée, puis réactivation', async () => {
      const session = await login(app, restoB.email, PASSWORD);
      await superAdmin.agent
        .patch(`/api/v1/platform/organizations/${restoB.organizationId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await session.agent.get('/api/v1/auth/me').expect(401);
      const denied = await login(app, restoB.email, PASSWORD);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('ORGANIZATION_SUSPENDED');
      await superAdmin.agent
        .patch(`/api/v1/platform/organizations/${restoB.organizationId}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect((await login(app, restoB.email, PASSWORD)).status).toBe(200);
    });
  });
});
