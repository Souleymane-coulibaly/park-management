import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
import { allocateFactureNumber } from '../src/modules/facture/facture-numbering';
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
 * Ocall Facture — socle F0 : accès par abonnement et essai, lecture seule, rôles et permissions,
 * identité légale (Mali), TVA 0 à 20 %, logo, aperçu PDF de l'en-tête, équipe sur deux bases,
 * numérotation continue sans trou, isolation entre organisations. Données fictives, bases locales
 * jetables (Suite et Facture distinctes).
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);

(enabled ? describe : describe.skip)('Ocall Facture F0 (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;

  const settings = (over: Record<string, unknown> = {}) => ({
    legalName: `Froid Services ${RUN} SARL`,
    tradeName: 'Froid Services',
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    phone: '+223 70 00 00 00',
    email: `contact.${RUN}@test.ocallpark.local`,
    nif: '084123456A',
    rccm: 'MA.BKO.2026.B.1234',
    taxRegime: 'Régime du réel normal',
    bankDetails: 'Banque fictive — IBAN ML00 0000 0000',
    legalFooter: 'Pénalités de retard selon les conditions générales.',
    defaultVatRate: 18,
    paymentTermsDays: 30,
    ...over,
  });

  /** Essai Ocall Facture ouvert directement en base (le produit reste « à venir » au catalogue). */
  async function startTrial(organizationId: string, endsAt = new Date(Date.now() + 14 * DAY)) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    await prisma.productTrial.create({
      data: {
        organizationId,
        productId: product.id,
        startedAt: new Date(),
        endsAt,
        startedByOcall: true,
      },
    });
    await prisma.subscription.upsert({
      where: { organizationId_productId: { organizationId, productId: product.id } },
      create: { organizationId, productId: product.id, planId, status: 'TRIALING' },
      update: { status: 'TRIALING' },
    });
  }

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    // Offre de test INACTIVE : le catalogue public de Facture reste vide.
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureA', 'PARK');
    orgB = await signup(app, 'factureB', 'PARK');
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        const ids = [orgA.organizationId, orgB.organizationId];
        await db.factureMember.deleteMany({ where: { organizationId: { in: ids } } });
        await db.factureSettings.deleteMany({ where: { organizationId: { in: ids } } });
        await db.factureNumberCounter.deleteMany({ where: { organizationId: { in: ids } } });
      }
      if (prisma) {
        await cleanup(prisma);
        if (planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('sans essai ni abonnement : application fermée et absente du portail', async () => {
    const res = await orgA.agent.get(api('/facture/context'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRODUCT_NOT_ENABLED');
    const apps = (await orgA.agent.get(api('/suite/apps')).expect(200)).body;
    expect(apps.map((a: { code: string }) => a.code)).not.toContain(FACTURE_PRODUCT_CODE);
    // Abonnement souscrit mais jamais activé (ni essai ni paiement) : toujours aucun accès.
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    await prisma.subscription.create({
      data: {
        organizationId: orgA.organizationId,
        productId: product.id,
        planId,
        status: 'NOT_ACTIVATED',
      },
    });
    expect((await orgA.agent.get(api('/facture/context'))).body.code).toBe('PRODUCT_NOT_ENABLED');
  });

  it('essai en cours : propriétaire gérant d’office, application visible au portail', async () => {
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    const ctx = (await orgA.agent.get(api('/facture/context')).expect(200)).body;
    expect(ctx).toMatchObject({
      access: 'full',
      role: 'MANAGER',
      roleLabel: 'Propriétaire (gérant)',
      settingsReady: false,
    });
    expect(ctx.permissions).toContain('facture.settings.manage');
    const apps = (await orgA.agent.get(api('/suite/apps')).expect(200)).body;
    expect(apps).toContainEqual({
      code: FACTURE_PRODUCT_CODE,
      name: 'Ocall Facture',
      href: '/facture',
      access: 'full',
    });
    // Portail Ocall Suite : tuile Facture ouverte, essai en cours.
    const overview = (await orgA.agent.get(api('/suite/overview')).expect(200)).body;
    const tile = (overview.apps ?? overview).find(
      (a: { code: string }) => a.code === FACTURE_PRODUCT_CODE,
    );
    expect(tile).toMatchObject({ access: 'full', href: '/facture' });
    expect(tile.trial).toMatchObject({ active: true });
  });

  it('identité légale : brouillon proposé, TVA de 0 à 20 % seulement, mentions manquantes', async () => {
    const draft = (await orgA.agent.get(api('/facture/settings')).expect(200)).body;
    expect(draft).toMatchObject({
      saved: false,
      defaultVatRate: 18,
      country: 'ML',
      currency: 'XOF',
    });
    expect(draft.legalName).toBe(`Test factureA ${RUN}`);
    expect(draft.legalMissing).toContain('Numéro d’identification fiscale (NIF)');
    // Aperçu impossible avant l'enregistrement de l'identité.
    expect((await orgA.agent.get(api('/facture/settings/letterhead.pdf'))).body.code).toBe(
      'SETTINGS_REQUIRED',
    );
    for (const defaultVatRate of [21, -1, 18.5, '18']) {
      await orgA.agent.put(api('/facture/settings')).send(settings({ defaultVatRate })).expect(400);
    }
    await orgA.agent
      .put(api('/facture/settings'))
      .send(settings({ nif: '<x>' }))
      .expect(400);
    await orgA.agent
      .put(api('/facture/settings'))
      .send(settings({ phone: '70000000' }))
      .expect(400);
    await orgA.agent
      .put(api('/facture/settings'))
      .send({ ...settings(), organizationId: orgB.organizationId })
      .expect(400);
    const partial = (
      await orgA.agent
        .put(api('/facture/settings'))
        .send(settings({ nif: '', taxRegime: null, defaultVatRate: 0 }))
        .expect(200)
    ).body;
    expect(partial).toMatchObject({ saved: true, nif: null, defaultVatRate: 0 });
    expect(partial.legalMissing).toEqual([
      'Numéro d’identification fiscale (NIF)',
      'Régime d’imposition',
    ]);
    const full = (await orgA.agent.put(api('/facture/settings')).send(settings()).expect(200)).body;
    expect(full).toMatchObject({ saved: true, defaultVatRate: 18, legalMissing: [] });
    expect(full).not.toHaveProperty('logoKey');
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgA.organizationId, action: 'facture.settings_updated' },
      }),
    ).toBe(2);
    // Isolation : l'organisation B ne voit que son propre brouillon.
    const other = (await orgB.agent.get(api('/facture/settings')).expect(200)).body;
    expect(other).toMatchObject({ saved: false, legalName: `Test factureB ${RUN}` });
  });

  it('logo vérifié et réencodé ; aperçu PDF de l’en-tête', async () => {
    await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', Buffer.from('pas une image'), {
        filename: 'logo.png',
        contentType: 'image/png',
      })
      .expect(400);
    // Image valide mais type non autorisé : refusée avant tout traitement.
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    expect(
      (
        await orgA.agent
          .post(api('/facture/settings/logo'))
          .attach('file', gif, { filename: 'logo.gif', contentType: 'image/gif' })
      ).status,
    ).toBe(400);
    await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'logo.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    const png = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: '#1f6f4a' },
    })
      .png()
      .toBuffer();
    await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    const first = (
      await db.factureSettings.findUniqueOrThrow({
        where: { organizationId: orgA.organizationId },
      })
    ).logoKey;
    expect(first).toMatch(new RegExp(`^org/${orgA.organizationId}/_/[0-9a-f-]{36}\\.png$`));
    const logo = await orgA.agent.get(api('/facture/settings/logo')).expect(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['cache-control']).toBe('private, no-store');
    const meta = await sharp(logo.body as Buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(600);
    // Remplacement : nouvelle clé.
    await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    const second = (
      await db.factureSettings.findUniqueOrThrow({
        where: { organizationId: orgA.organizationId },
      })
    ).logoKey;
    expect(second).not.toBe(first);
    // Organisation B : aucun logo ; jamais celui de A.
    await orgB.agent.get(api('/facture/settings/logo')).expect(404);
    const pdf = await orgA.agent
      .get(api('/facture/settings/letterhead.pdf'))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('équipe : comptes dédiés à Facture, rôles et permissions, désactivation sur les deux bases', async () => {
    const created = async (role: string) => {
      const res = await orgA.agent
        .post(api('/facture/members'))
        .send({ firstName: 'Membre', lastName: role, role })
        .expect(201);
      return {
        id: res.body.member.id as string,
        agent: await connect(res.body.member.loginId, res.body.temporaryPassword),
      };
    };
    const tech = await created('TECHNICIAN');
    const sales = await created('SALES');
    // Compte Suite PRODUCT_USER, sans aucun droit Park.
    const user = await prisma.organizationMembership.findFirstOrThrow({
      where: { organizationId: orgA.organizationId, user: { lastName: 'TECHNICIAN' } },
    });
    expect(user.role).toBe('PRODUCT_USER');
    expect((await tech.agent.get(api('/facture/context')).expect(200)).body).toMatchObject({
      role: 'TECHNICIAN',
      permissions: ['facture.access'],
    });
    await tech.agent.get(api('/facture/settings')).expect(200);
    await tech.agent.put(api('/facture/settings')).send(settings()).expect(403);
    await tech.agent.get(api('/facture/members')).expect(403);
    await sales.agent.get(api('/facture/members')).expect(200);
    await sales.agent
      .post(api('/facture/members'))
      .send({ firstName: 'X', lastName: 'Y', role: 'MANAGER' })
      .expect(403);
    await sales.agent
      .patch(api(`/facture/members/${tech.id}`))
      .send({ isActive: false })
      .expect(403);
    // Rôle Park (administrateur, non propriétaire) : aucun droit Facture.
    const establishments = (await orgA.agent.get(api('/establishments')).expect(200)).body;
    const parkAdmin = (
      await orgA.agent
        .post(api('/employees'))
        .send({
          firstName: 'Admin',
          lastName: 'Park',
          role: 'ADMIN',
          establishmentIds: [establishments[0].id],
        })
        .expect(201)
    ).body;
    const parkAgent = await connect(parkAdmin.employee.loginId, parkAdmin.temporaryPassword);
    expect((await parkAgent.get(api('/facture/context'))).status).toBe(403);
    // Membre désactivé dans Facture alors que Suite n'a pas encore recopié l'état : refusé quand même.
    await db.factureMember.update({ where: { id: sales.id }, data: { isActive: false } });
    expect((await sales.agent.get(api('/facture/context'))).status).toBe(403);
    await db.factureMember.update({ where: { id: sales.id }, data: { isActive: true } });
    // Organisation B : membre de A introuvable.
    await orgB.agent
      .patch(api(`/facture/members/${tech.id}`))
      .send({ isActive: false })
      .expect(404);
    // Désactivation par le gérant : compte Suite fermé et sessions révoquées.
    await orgA.agent
      .patch(api(`/facture/members/${tech.id}`))
      .send({ isActive: false })
      .expect(200);
    expect((await tech.agent.get(api('/facture/context'))).status).toBe(401);
    expect(
      (await prisma.organizationMembership.findUniqueOrThrow({ where: { id: user.id } })).isActive,
    ).toBe(false);
  });

  it('essai échu : lecture seule, aucune écriture', async () => {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    await prisma.productTrial.update({
      where: {
        organizationId_productId: { organizationId: orgB.organizationId, productId: product.id },
      },
      data: { endsAt: new Date(Date.now() - DAY) },
    });
    expect((await orgB.agent.get(api('/facture/context')).expect(200)).body.access).toBe(
      'read_only',
    );
    const write = await orgB.agent.put(api('/facture/settings')).send(settings());
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('numérotation : continue sous concurrence, sans trou après annulation, par organisation et année', async () => {
    const org = orgA.organizationId;
    const at = new Date('2026-06-15T10:00:00Z');
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.$transaction((tx) => allocateFactureNumber(tx, org, 'INVOICE', at)),
      ),
    );
    expect(numbers.map((n) => n.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    // Émission annulée : son rang est rendu.
    await expect(
      db.$transaction(async (tx) => {
        await allocateFactureNumber(tx, org, 'INVOICE', at);
        throw new Error('annulation fictive');
      }),
    ).rejects.toThrow('annulation fictive');
    expect(
      (await db.$transaction((tx) => allocateFactureNumber(tx, org, 'INVOICE', at))).number,
    ).toBe('FAC-2026-00021');
    // Autre type, autre année, autre organisation : séries indépendantes.
    expect(
      (await db.$transaction((tx) => allocateFactureNumber(tx, org, 'QUOTE', at))).number,
    ).toBe('DEV-2026-00001');
    expect(
      (
        await db.$transaction((tx) =>
          allocateFactureNumber(tx, org, 'INVOICE', new Date('2027-01-01T00:00:00Z')),
        )
      ).number,
    ).toBe('FAC-2027-00001');
    expect(
      (await db.$transaction((tx) => allocateFactureNumber(tx, orgB.organizationId, 'INVOICE', at)))
        .number,
    ).toBe('FAC-2026-00001');
  });

  it('identifiant étranger ou mal formé : refusé sans fuite', async () => {
    await orgA.agent
      .patch(api(`/facture/members/${randomUUID()}`))
      .send({ isActive: true })
      .expect(404);
    await orgA.agent
      .patch(api('/facture/members/pas-un-uuid'))
      .send({ isActive: true })
      .expect(400);
  });
});
