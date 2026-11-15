import type { INestApplication } from '@nestjs/common';
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
 * Ocall Suite — Sprint 2, étape D : accès harmonisés entre applications.
 * - Désactivation d'un compte réservé aux applications (PRODUCT_USER) par l'organisation : durable (un rôle
 *   d'application ne la défait pas), réservée au propriétaire, levée seulement si une application donne
 *   encore un rôle, limitée à cette organisation (ses autres organisations restent ouvertes).
 * - Portail : applications présentées selon le rôle réellement attribué à la personne.
 * - Permissions par organisation et par application, avant et après changement d'organisation.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);

interface PortalApp {
  code: string;
  access: string;
  hasRole: boolean;
  href: string | null;
}

(enabled ? describe : describe.skip)(
  'Ocall Suite S2D — accès par organisation et par application',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let stockDb: OcallStockPrismaService;
    let orgA: SignedUpOwner;
    let orgB: SignedUpOwner;
    let siteA: string;
    let adminA: { agent: Agent; userId: string; membershipId: string };
    let cashierA: { agent: Agent; userId: string };
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
          name: `S2D stock ${organizationId.slice(0, 8)} ${RUN}`,
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

    async function parkEmployee(role: string) {
      const created = (
        await orgA.agent
          .post(api('/employees'))
          .send({ firstName: 'Fanta', lastName: role, role, establishmentIds: [siteA] })
          .expect(201)
      ).body;
      const user = await prisma.user.findUniqueOrThrow({
        where: { loginId: created.employee.loginId },
        select: { id: true },
      });
      return {
        agent: await connect(created.employee.loginId, created.temporaryPassword),
        userId: user.id,
        membershipId: created.employee.id as string,
      };
    }

    /** Compte réservé à Stock dans l'organisation A (PRODUCT_USER). */
    async function stockOnly(role = 'SALES') {
      const created = (
        await orgA.agent
          .post(api('/ocall-stock/members'))
          .send({ firstName: 'Oumar', lastName: `Stock ${role}`, role })
          .expect(201)
      ).body;
      const user = await prisma.user.findUniqueOrThrow({
        where: { loginId: created.member.loginId },
        select: { id: true },
      });
      const membership = await prisma.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgA.organizationId, userId: user.id } },
        select: { id: true, role: true },
      });
      expect(membership.role).toBe('PRODUCT_USER');
      return {
        loginId: created.member.loginId as string,
        memberId: created.member.id as string,
        userId: user.id,
        membershipId: membership.id,
        agent: await connect(created.member.loginId, created.temporaryPassword),
      };
    }

    const membershipState = (organizationId: string, userId: string) =>
      prisma.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId } },
        select: { isActive: true, suspendedAt: true },
      });

    const status = async (agent: Agent, path: string) => (await agent.get(api(path))).status;

    const portal = async (agent: Agent) =>
      (await agent.get(api('/suite/overview')).expect(200)).body as PortalApp[];

    beforeAll(async () => {
      ({ app, prisma } = await createTestApp());
      stockDb = app.get(OcallStockPrismaService);
      orgA = await signup(app, 's2dA', 'PARK');
      orgB = await signup(app, 's2dB', 'PARK');
      await stockTrial(orgA.organizationId);
      siteA = (await orgA.agent.get(api('/establishments')).expect(200)).body[0].id;
      adminA = await parkEmployee('ADMIN');
      cashierA = await parkEmployee('CASHIER');
    }, 300_000);

    afterAll(async () => {
      try {
        const ids = [orgA?.organizationId, orgB?.organizationId].filter(Boolean) as string[];
        if (stockDb && ids.length) {
          const { purgeStockOrganizations } = await import('@ocall/stock-database');
          await purgeStockOrganizations(stockDb, ids);
        }
        if (prisma) {
          await cleanup(prisma);
          await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
        }
      } finally {
        await app?.close();
      }
    });

    it('désactivation d’un compte réservé aux applications : durable, réservée au propriétaire, levée si un rôle reste', async () => {
      const person = await stockOnly();
      expect(await status(person.agent, '/ocall-stock/context')).toBe(200);
      // Un administrateur Park ne gère pas ces comptes.
      await adminA.agent.post(api(`/employees/${person.membershipId}/deactivate`)).expect(403);
      await orgA.agent.post(api(`/employees/${person.membershipId}/deactivate`)).expect(200);
      expect(await membershipState(orgA.organizationId, person.userId)).toMatchObject({
        isActive: false,
        suspendedAt: expect.any(Date),
      });
      expect(await status(person.agent, '/ocall-stock/context')).toBe(401);
      expect((await login(app, person.loginId, PASSWORD)).status).not.toBe(200);
      // Un changement de rôle dans Stock (qui recalcule l'état du compte) ne rouvre pas l'adhésion.
      await orgA.agent
        .patch(api(`/ocall-stock/members/${person.memberId}`))
        .send({ role: 'AUDITOR' })
        .expect(200);
      expect((await membershipState(orgA.organizationId, person.userId)).isActive).toBe(false);
      expect((await login(app, person.loginId, PASSWORD)).status).not.toBe(200);
      const listed = (await orgA.agent.get(api('/employees')).expect(200)).body.find(
        (e: { id: string }) => e.id === person.membershipId,
      );
      expect(listed).toMatchObject({ isActive: false, suspended: true });
      // Réactivation : Stock lui donne encore un rôle, le compte rouvre.
      await orgA.agent.post(api(`/employees/${person.membershipId}/reactivate`)).expect(200);
      expect(await membershipState(orgA.organizationId, person.userId)).toEqual({
        isActive: true,
        suspendedAt: null,
      });
      const again = await login(app, person.loginId, PASSWORD);
      expect(again.status).toBe(200);
      expect(await status(again.agent, '/ocall-stock/context')).toBe(200);
    });

    it('réactivation sans rôle d’application : le compte reste fermé ; désactivé, aucune application ne le rouvre', async () => {
      const person = await stockOnly();
      // Fermé par Stock (plus aucun rôle) : non désactivé par l'organisation.
      await orgA.agent
        .patch(api(`/ocall-stock/members/${person.memberId}`))
        .send({ isActive: false })
        .expect(200);
      expect(await membershipState(orgA.organizationId, person.userId)).toEqual({
        isActive: false,
        suspendedAt: null,
      });
      // « Réactiver » ne rouvre pas un compte sans rôle d'application.
      await orgA.agent.post(api(`/employees/${person.membershipId}/reactivate`)).expect(200);
      expect((await membershipState(orgA.organizationId, person.userId)).isActive).toBe(false);
      // Désactivé par l'organisation, puis rouvert dans Stock : l'adhésion reste fermée.
      await orgA.agent.post(api(`/employees/${person.membershipId}/deactivate`)).expect(200);
      await orgA.agent
        .patch(api(`/ocall-stock/members/${person.memberId}`))
        .send({ isActive: true })
        .expect(200);
      expect(await membershipState(orgA.organizationId, person.userId)).toMatchObject({
        isActive: false,
        suspendedAt: expect.any(Date),
      });
      expect((await login(app, person.loginId, PASSWORD)).status).not.toBe(200);
    });

    it('plusieurs organisations : la désactivation dans A ne ferme ni l’adhésion ni les sessions de B', async () => {
      const person = await stockOnly();
      await orgB.agent
        .post(api('/organization/invitations'))
        .send({ identifier: person.loginId, role: 'ADMIN' })
        .expect(201);
      const [invitation] = (await person.agent.get(api('/auth/invitations')).expect(200)).body;
      await person.agent.post(api(`/auth/invitations/${invitation.id}/accept`)).expect(200);
      // Session dans B (nouvelle session ; celle de A est fermée par le changement).
      const inB = await login(app, person.loginId, PASSWORD);
      await inB.agent
        .post(api('/auth/switch-organization'))
        .send({ organizationId: orgB.organizationId })
        .expect(200);
      await orgA.agent.post(api(`/employees/${person.membershipId}/deactivate`)).expect(200);
      expect(await membershipState(orgB.organizationId, person.userId)).toEqual({
        isActive: true,
        suspendedAt: null,
      });
      // La session de B fonctionne toujours ; A n'est plus proposée ni accessible.
      const me = (await inB.agent.get(api('/auth/me')).expect(200)).body;
      expect(me.organization.id).toBe(orgB.organizationId);
      const orgs = (await inB.agent.get(api('/auth/organizations')).expect(200)).body;
      expect(orgs.map((o: { organizationId: string }) => o.organizationId)).toEqual([
        orgB.organizationId,
      ]);
      await inB.agent
        .post(api('/auth/switch-organization'))
        .send({ organizationId: orgA.organizationId })
        .expect(404);
      // Nouvelle connexion : ouverte dans B, la seule organisation active du compte.
      const fresh = await login(app, person.loginId, PASSWORD);
      expect(fresh.status).toBe(200);
      expect((await fresh.agent.get(api('/auth/me')).expect(200)).body.organization.id).toBe(
        orgB.organizationId,
      );
    });

    it('portail : applications présentées selon le rôle réellement attribué', async () => {
      const byCode = (apps: PortalApp[]) => Object.fromEntries(apps.map((a) => [a.code, a]));
      // Propriétaire : responsable d'office de chaque application ouverte.
      const owner = byCode(await portal(orgA.agent));
      expect(owner.OCALL_STOCK).toMatchObject({ hasRole: true, href: '/stock' });
      expect(owner.OCALL_PARK).toMatchObject({ hasRole: true, href: '/app' });
      // Caissier Park : seulement Park (aucun rôle Stock, ni catalogue ni facturation).
      const cashier = await portal(cashierA.agent);
      expect(cashier.map((a) => a.code)).toEqual(['OCALL_PARK']);
      expect(cashier[0]).toMatchObject({ hasRole: true, href: '/app' });
      // Administrateur Park sans rôle Stock : Stock affiché sans lien ; avec un rôle, lien ouvert.
      expect(byCode(await portal(adminA.agent)).OCALL_STOCK).toMatchObject({
        access: 'full',
        hasRole: false,
        href: null,
      });
      expect(await status(adminA.agent, '/ocall-stock/context')).toBe(403);
      await orgA.agent
        .post(api('/ocall-stock/members/existing'))
        .send({ userId: adminA.userId, role: 'AUDITOR' })
        .expect(201);
      expect(byCode(await portal(adminA.agent)).OCALL_STOCK).toMatchObject({
        hasRole: true,
        href: '/stock',
      });
      expect(await status(adminA.agent, '/ocall-stock/context')).toBe(200);
      // Compte réservé à Stock : seulement Stock, jamais Park.
      const stockUser = await stockOnly();
      expect((await portal(stockUser.agent)).map((a) => a.code)).toEqual(['OCALL_STOCK']);
    });

    it('permissions par organisation et par application, avant et après changement d’organisation', async () => {
      const person = await stockOnly();
      await orgB.agent
        .post(api('/organization/invitations'))
        .send({ identifier: person.loginId, role: 'ADMIN' })
        .expect(201);
      const [invitation] = (await person.agent.get(api('/auth/invitations')).expect(200)).body;
      await person.agent.post(api(`/auth/invitations/${invitation.id}/accept`)).expect(200);
      const agent = person.agent;
      // A : rôle Stock, aucun droit Park.
      expect(await status(agent, '/ocall-stock/context')).toBe(200);
      expect(await status(agent, '/employees')).toBe(403);
      // B : administrateur Park ; Stock non activé pour B.
      await agent
        .post(api('/auth/switch-organization'))
        .send({ organizationId: orgB.organizationId })
        .expect(200);
      expect(await status(agent, '/employees')).toBe(200);
      const denied = await agent.get(api('/ocall-stock/context'));
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('PRODUCT_NOT_ENABLED');
      expect((await portal(agent)).find((a) => a.code === 'OCALL_STOCK')?.hasRole ?? false).toBe(
        false,
      );
      // Stock activé pour B : l'administrateur Park de B n'y a pas de rôle (son rôle Stock est dans A).
      await stockTrial(orgB.organizationId);
      const noRole = await agent.get(api('/ocall-stock/context'));
      expect(noRole.status).toBe(403);
      expect(noRole.body.code).toBe('FORBIDDEN');
      // Retour dans A : droits de A uniquement.
      await agent
        .post(api('/auth/switch-organization'))
        .send({ organizationId: orgA.organizationId })
        .expect(200);
      expect(await status(agent, '/ocall-stock/context')).toBe(200);
      expect(await status(agent, '/employees')).toBe(403);
      const ctx = (await agent.get(api('/ocall-stock/context')).expect(200)).body;
      expect(ctx.organizationId ?? orgA.organizationId).toBe(orgA.organizationId);
    });
  },
);
