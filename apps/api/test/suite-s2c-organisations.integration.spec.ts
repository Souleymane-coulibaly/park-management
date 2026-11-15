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
 * Ocall Suite — Sprint 2, étape C : un même compte dans plusieurs organisations.
 * - Invitation par une autre organisation (réponse identique que le compte existe ou non), acceptée par la
 *   personne depuis son propre compte ; rôles et établissements contrôlés ; échue, refusée, révoquée.
 * - Changement d'organisation : nouvelle session sur la seule adhésion choisie, ancienne session fermée ;
 *   droits et données de l'organisation choisie uniquement.
 * - Compte partagé : ni mot de passe ni identité modifiables depuis une seule organisation.
 * - Écarts de l'étape B : compteurs Park, lieu encore utilisé, création partielle Stock annulée.
 * Données fictives, bases jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_STOCK_DATABASE_URL);

(enabled ? describe : describe.skip)('Ocall Suite S2C — plusieurs organisations', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stockDb: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let siteA: string;
  let siteB: string;
  let shared: { loginId: string; userId: string; membershipA: string; agent: Agent };
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
        name: `S2C stock ${organizationId.slice(0, 8)} ${RUN}`,
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

  const invite = (owner: Agent, body: Record<string, unknown>) =>
    owner.post(api('/organization/invitations')).send(body);
  const membershipOf = (organizationId: string, userId: string) =>
    prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, role: true, isActive: true },
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockDb = app.get(OcallStockPrismaService);
    orgA = await signup(app, 's2cA', 'PARK');
    orgB = await signup(app, 's2cB', 'PARK');
    await stockTrial(orgB.organizationId);
    siteA = (await orgA.agent.get(api('/establishments')).expect(200)).body[0].id;
    siteB = (await orgB.agent.get(api('/establishments')).expect(200)).body[0].id;
    const created = (
      await orgA.agent
        .post(api('/employees'))
        .send({
          firstName: 'Moussa',
          lastName: 'Partagé',
          role: 'ADMIN',
          establishmentIds: [siteA],
        })
        .expect(201)
    ).body;
    const user = await prisma.user.findUniqueOrThrow({
      where: { loginId: created.employee.loginId },
      select: { id: true },
    });
    shared = {
      loginId: created.employee.loginId,
      userId: user.id,
      membershipA: created.employee.id,
      agent: await connect(created.employee.loginId, created.temporaryPassword),
    };
  }, 300_000);

  afterAll(async () => {
    try {
      const ids = [orgA?.organizationId, orgB?.organizationId].filter(Boolean) as string[];
      if (stockDb && ids.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(stockDb, ids);
      }
      if (prisma) {
        await prisma.organization.updateMany({
          where: { id: { in: ids } },
          data: { status: 'ACTIVE' },
        });
        await cleanup(prisma);
        await prisma.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
      }
    } finally {
      await app?.close();
    }
  });

  it('invitation : réponse identique que le compte existe ou non ; rôles et établissements contrôlés', async () => {
    const known = (
      await invite(orgB.agent, {
        identifier: shared.loginId.toLowerCase(),
        role: 'CASHIER',
        establishmentIds: [siteB],
      }).expect(201)
    ).body;
    const unknown = (
      await invite(orgB.agent, {
        identifier: `INCONNU-${RUN}`,
        role: 'CASHIER',
        establishmentIds: [siteB],
      }).expect(201)
    ).body;
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known).toMatchObject({ identifier: shared.loginId, state: 'PENDING', role: 'CASHIER' });
    // Rien n'est créé avant l'acceptation.
    expect(await membershipOf(orgB.organizationId, shared.userId)).toBeNull();
    const twice = await invite(orgB.agent, {
      identifier: shared.loginId,
      role: 'CASHIER',
      establishmentIds: [siteB],
    }).expect(409);
    expect(twice.body.code).toBe('INVITATION_PENDING');
    // Contrôles : propriétaire jamais ; établissement exigé, de l'organisation, avec une activité Park.
    await invite(orgB.agent, { identifier: 'x@exemple.ml', role: 'OWNER' }).expect(400);
    await invite(orgB.agent, { identifier: 'y@exemple.ml', role: 'CASHIER' }).expect(400);
    await invite(orgB.agent, {
      identifier: 'z@exemple.ml',
      role: 'CASHIER',
      establishmentIds: [siteA],
    }).expect(404);
    const shop = (
      await orgB.agent
        .post(api('/establishments'))
        .send({ name: 'Boutique sans parc', businessType: 'NONE', kind: 'SHOP' })
        .expect(201)
    ).body;
    await invite(orgB.agent, {
      identifier: 'w@exemple.ml',
      role: 'CASHIER',
      establishmentIds: [shop.id],
    }).expect(404);
    await invite(orgB.agent, { identifier: 'pas un mail@', role: 'PRODUCT_USER' }).expect(400);
    // Déjà membre de l'organisation : seule information révélée (sur elle-même).
    const already = await invite(orgA.agent, { identifier: shared.loginId, role: 'PRODUCT_USER' });
    expect(already.status).toBe(409);
    expect(already.body.code).toBe('ALREADY_MEMBER');
    // Un administrateur n'invite pas d'administrateur ; un caissier n'invite personne.
    await invite(shared.agent, { identifier: 'v@exemple.ml', role: 'ADMIN' }).expect(403);
  });

  it('acceptation : seulement par le compte invité, une fois ; adhésion et établissement créés', async () => {
    const pending = (await shared.agent.get(api('/auth/invitations')).expect(200)).body;
    expect(pending).toHaveLength(1);
    expect(pending[0].organizationName).toContain('s2cB');
    // Un autre compte ne voit ni n'accepte l'invitation.
    expect((await orgA.agent.get(api('/auth/invitations')).expect(200)).body).toEqual([]);
    await orgA.agent.post(api(`/auth/invitations/${pending[0].id}/accept`)).expect(404);
    await orgA.agent.post(api(`/auth/invitations/${pending[0].id}/decline`)).expect(404);
    const accepted = (
      await shared.agent.post(api(`/auth/invitations/${pending[0].id}/accept`)).expect(200)
    ).body;
    expect(accepted).toEqual({ organizationId: orgB.organizationId, role: 'CASHIER' });
    await shared.agent.post(api(`/auth/invitations/${pending[0].id}/accept`)).expect(404);
    const membership = await membershipOf(orgB.organizationId, shared.userId);
    expect(membership).toMatchObject({ role: 'CASHIER', isActive: true });
    const assignments = await prisma.establishmentAssignment.findMany({
      where: { membershipId: membership!.id },
      select: { establishmentId: true },
    });
    expect(assignments.map((x) => x.establishmentId)).toEqual([siteB]);
    // Rôle et adhésion dans A inchangés.
    expect(await membershipOf(orgA.organizationId, shared.userId)).toMatchObject({
      role: 'ADMIN',
      isActive: true,
    });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgB.organizationId, action: 'organization.invitation_accepted' },
      }),
    ).toBe(1);
  });

  it('changement d’organisation : nouvelle session, ancienne fermée, droits de la seule organisation choisie', async () => {
    const orgs = (await shared.agent.get(api('/auth/organizations')).expect(200)).body;
    expect(
      orgs.map((o: { organizationId: string; current: boolean }) => [o.organizationId, o.current]),
    ).toEqual([
      [orgA.organizationId, true],
      [orgB.organizationId, false],
    ]);
    await shared.agent.get(api('/employees')).expect(200); // administrateur dans A
    const me = (
      await shared.agent
        .post(api('/auth/switch-organization'))
        .send({ organizationId: orgB.organizationId })
        .expect(200)
    ).body;
    expect(me.organization.id).toBe(orgB.organizationId);
    expect(me.role).toBe('CASHIER');
    // Droits de caissier dans B : ni équipe ni lieux de A.
    await shared.agent.get(api('/employees')).expect(403);
    await shared.agent.get(api('/establishments')).expect(403);
    const ticketing = (await shared.agent.get(api('/ticketing/establishments')).expect(200)).body;
    expect(ticketing.map((e: { id: string }) => e.id)).toEqual([siteB]);
    await shared.agent.get(api(`/employees/${shared.membershipA}`)).expect(403);
    // L'ancienne session (organisation A) est fermée.
    const sessions = await prisma.session.findMany({
      where: { userId: shared.userId, revokedAt: null },
      select: { membershipId: true },
    });
    const bMembership = await membershipOf(orgB.organizationId, shared.userId);
    expect(sessions.map((s) => s.membershipId)).toEqual([bMembership!.id]);
    // Journal dans B.
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgB.organizationId, action: 'auth.organization_switched' },
      }),
    ).toBe(1);
    // Retour dans A : droits d'administrateur retrouvés.
    await shared.agent
      .post(api('/auth/switch-organization'))
      .send({ organizationId: orgA.organizationId })
      .expect(200);
    await shared.agent.get(api('/employees')).expect(200);
    // Refus : même organisation, organisation sans adhésion, adhésion désactivée, organisation suspendue.
    await shared.agent
      .post(api('/auth/switch-organization'))
      .send({ organizationId: orgA.organizationId })
      .expect(400);
    await orgA.agent
      .post(api('/auth/switch-organization'))
      .send({ organizationId: orgB.organizationId })
      .expect(404);
    await prisma.organizationMembership.update({
      where: { id: bMembership!.id },
      data: { isActive: false },
    });
    await shared.agent
      .post(api('/auth/switch-organization'))
      .send({ organizationId: orgB.organizationId })
      .expect(404);
    await prisma.organizationMembership.update({
      where: { id: bMembership!.id },
      data: { isActive: true },
    });
    await prisma.organization.update({
      where: { id: orgB.organizationId },
      data: { status: 'SUSPENDED' },
    });
    await shared.agent
      .post(api('/auth/switch-organization'))
      .send({ organizationId: orgB.organizationId })
      .expect(404);
    expect(
      (await shared.agent.get(api('/auth/organizations')).expect(200)).body.map(
        (o: { organizationId: string }) => o.organizationId,
      ),
    ).toEqual([orgA.organizationId]);
    // Connexion : la plus ancienne organisation active ; A suspendue, B active : session dans B.
    await prisma.organization.update({
      where: { id: orgB.organizationId },
      data: { status: 'ACTIVE' },
    });
    await prisma.organization.update({
      where: { id: orgA.organizationId },
      data: { status: 'SUSPENDED' },
    });
    const relogged = await login(app, shared.loginId, PASSWORD);
    expect(relogged.status).toBe(200);
    expect(relogged.body.organization.id).toBe(orgB.organizationId);
    await prisma.organization.update({
      where: { id: orgA.organizationId },
      data: { status: 'ACTIVE' },
    });
  });

  it('compte partagé : ni mot de passe ni identité modifiables depuis une seule organisation', async () => {
    const bMembership = await membershipOf(orgB.organizationId, shared.userId);
    for (const [owner, id] of [
      [orgA.agent, shared.membershipA],
      [orgB.agent, bMembership!.id],
    ] as const) {
      const reset = await owner.post(api(`/employees/${id}/reset-password`)).expect(409);
      expect(reset.body.code).toBe('SHARED_ACCOUNT');
      await owner
        .patch(api(`/employees/${id}`))
        .send({ email: `pirate-${RUN}@exemple.ml` })
        .expect(409);
    }
    // Chaque organisation garde la main sur son adhésion : B désactive, A reste ouverte.
    await orgB.agent.post(api(`/employees/${bMembership!.id}/deactivate`)).expect(200);
    const again = await login(app, shared.loginId, PASSWORD);
    expect(again.status).toBe(200);
    expect(again.body.organization.id).toBe(orgA.organizationId);
    await again.agent.get(api('/employees')).expect(200);
  });

  it('invitations : échue, refusée, révoquée ; jamais acceptées', async () => {
    const make = async (identifier: string) =>
      (await invite(orgB.agent, { identifier, role: 'PRODUCT_USER' }).expect(201)).body
        .id as string;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { loginId: orgA.loginId },
      select: { loginId: true, email: true },
    });
    const expired = await make(owner.email!);
    await prisma.organizationInvitation.update({
      where: { id: expired },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await orgA.agent.get(api('/auth/invitations')).expect(200)).body).toEqual([]);
    await orgA.agent.post(api(`/auth/invitations/${expired}/accept`)).expect(404);
    const listed = (await orgB.agent.get(api('/organization/invitations')).expect(200)).body;
    expect(listed.find((i: { id: string }) => i.id === expired).state).toBe('EXPIRED');
    const revoked = await make(owner.loginId);
    await orgB.agent.post(api(`/organization/invitations/${revoked}/revoke`)).expect(201);
    await orgA.agent.post(api(`/auth/invitations/${revoked}/accept`)).expect(404);
    // L'autre organisation ne révoque pas une invitation qui n'est pas la sienne.
    const declined = await make(owner.loginId);
    await orgA.agent.post(api(`/organization/invitations/${declined}/revoke`)).expect(404);
    await orgA.agent.post(api(`/auth/invitations/${declined}/decline`)).expect(200);
    await orgA.agent.post(api(`/auth/invitations/${declined}/accept`)).expect(404);
    expect(
      await membershipOf(
        orgB.organizationId,
        (await prisma.user.findUniqueOrThrow({ where: { loginId: orgA.loginId } })).id,
      ),
    ).toBeNull();
  });

  it('écarts de l’étape B : compteurs Park, lieu encore utilisé, création partielle Stock annulée', async () => {
    // Compteurs Park : un lieu sans activité Park n'est pas compté.
    const before = (await orgB.agent.get(api('/dashboard')).expect(200)).body;
    await orgB.agent
      .post(api('/establishments'))
      .send({ name: 'Dépôt sans parc', businessType: 'NONE', kind: 'WAREHOUSE' })
      .expect(201);
    const after = (await orgB.agent.get(api('/dashboard')).expect(200)).body;
    expect(after.establishments).toEqual(before.establishments);
    // Lieu encore utilisé par Stock : désactivation refusée tant que le rattachement existe.
    const site = (
      await orgB.agent
        .post(api('/ocall-stock/sites'))
        .send({ code: 'MAG', name: 'Magasin rattaché', kind: 'STORE', createEstablishment: true })
        .expect(201)
    ).body;
    const used = await orgB.agent
      .patch(api(`/establishments/${site.establishmentId}`))
      .send({ isActive: false })
      .expect(409);
    expect(used.body.code).toBe('ESTABLISHMENT_IN_USE');
    await orgB.agent
      .put(api(`/ocall-stock/sites/${site.id}/establishment`))
      .send({ establishmentId: null })
      .expect(200);
    await orgB.agent
      .patch(api(`/establishments/${site.establishmentId}`))
      .send({ isActive: false })
      .expect(200);
    // Création partielle : le site Stock échoue après la création du lieu ; le lieu est annulé.
    const count = () =>
      prisma.establishment.count({ where: { organizationId: orgB.organizationId } });
    const establishments = await count();
    const spy = jest
      .spyOn(stockDb, '$transaction')
      .mockImplementationOnce(() => Promise.reject(new Error('Base Stock indisponible')));
    try {
      await orgB.agent
        .post(api('/ocall-stock/sites'))
        .send({
          code: 'PANNE',
          name: 'Boutique en panne',
          kind: 'STORE',
          createEstablishment: true,
        })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await count()).toBe(establishments);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: orgB.organizationId,
          action: 'establishment.creation_rolled_back',
        },
      }),
    ).toBe(1);
    // Le même nom est de nouveau disponible.
    await orgB.agent
      .post(api('/ocall-stock/sites'))
      .send({ code: 'PANNE', name: 'Boutique en panne', kind: 'STORE', createEstablishment: true })
      .expect(201);
  });
});
