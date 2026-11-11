import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import sharp from 'sharp';
import { FactureInterventionsService } from '../src/modules/facture/facture-interventions.service';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
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
 * Ocall Facture — interventions F3 : équipements, planning et techniciens, travaux (temps, pièces,
 * photos), fin des travaux figée, signature du client (empreinte du rapport), rapport PDF, facturation
 * idempotente, rôles (le technicien ne voit que ses interventions), isolation, déclencheurs de la base,
 * concurrence. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const YEAR = new Date().getUTCFullYear();
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = isoDay(new Date());
const TOMORROW = isoDay(new Date(Date.now() + DAY));

(enabled ? describe : describe.skip)('Ocall Facture F3 — interventions (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let clientA: string;
  let clientA2: string;
  let clientB: string;
  let equipmentA: string;
  let equipmentB: string;
  let laborItem: string;
  let partItem: string;
  let tech: { id: string; agent: Agent };
  let sales: { id: string; agent: Agent };
  let photo: Buffer;
  let signature: Buffer;
  let blank: Buffer;

  async function startTrial(organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
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

  async function member(role: string, lastName: string) {
    const res = await orgA.agent
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName, role })
      .expect(201);
    const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return { id: res.body.member.id as string, agent: session.agent };
  }

  /** Intervention planifiée demain de 8 h à 10 h (heure du Mali = UTC). */
  const plan = (agent: Agent, extra: Record<string, unknown> = {}) =>
    agent.post(api('/facture/interventions')).send({
      clientId: clientA,
      equipmentId: equipmentA,
      title: 'Climatiseur en panne',
      scheduledStart: `${TOMORROW}T08:00:00Z`,
      scheduledEnd: `${TOMORROW}T10:00:00Z`,
      technicianIds: [tech.id],
      ...extra,
    });

  const time = (agent: Agent, id: string, minutes: number, extra: Record<string, unknown> = {}) =>
    agent
      .post(api(`/facture/interventions/${id}/time`))
      .send({ workDate: TODAY, minutes, ...extra });

  const upload = (agent: Agent, id: string, body: Buffer, type = 'image/png') =>
    agent
      .post(api(`/facture/interventions/${id}/photos`))
      .field('caption', 'Avant travaux')
      .attach('file', body, { filename: 'photo.png', contentType: type });

  const sign = (agent: Agent, id: string, body: Buffer, signerName = 'Awa Traoré') =>
    agent
      .post(api(`/facture/interventions/${id}/sign`))
      .field('signerName', signerName)
      .attach('file', body, { filename: 'signature.png', contentType: 'image/png' });

  /** Intervention démarrée par le technicien, 90 min et 2 pièces saisies, travaux terminés. */
  async function completed() {
    const id = (await plan(orgA.agent).expect(201)).body.id as string;
    await tech.agent.post(api(`/facture/interventions/${id}/start`)).expect(200);
    await time(tech.agent, id, 90, { note: 'Recharge en gaz' }).expect(201);
    await tech.agent
      .post(api(`/facture/interventions/${id}/parts`))
      .send({ itemId: partItem, quantity: 2 })
      .expect(201);
    await tech.agent
      .post(api(`/facture/interventions/${id}/complete`))
      .send({ workSummary: 'Recharge en gaz R410A, nettoyage des filtres.' })
      .expect(200);
    return id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture F3 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF3A', 'PARK');
    orgB = await signup(app, 'factureF3B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    for (const [owner, name] of [
      [orgA, 'Froid Services'],
      [orgB, 'Kati Clim'],
    ] as const) {
      await owner.agent
        .put(api('/facture/settings'))
        .send({
          legalName: `${name} ${RUN} SARL`,
          tradeName: name,
          address: 'ACI 2000',
          city: 'Bamako',
          nif: '084123456A',
          taxRegime: 'Régime du réel normal',
          defaultVatRate: 18,
          paymentTermsDays: 30,
        })
        .expect(200);
    }
    const client = async (owner: SignedUpOwner, name: string) =>
      (
        await owner.agent
          .post(api('/facture/clients'))
          .send({ name, address: 'Rue 310', city: 'Bamako', phone: '+223 70 00 00 00' })
          .expect(201)
      ).body.id as string;
    clientA = await client(orgA, 'Hôtel du Fleuve');
    clientA2 = await client(orgA, 'Banque du Sahel');
    clientB = await client(orgB, 'Clinique Lumière');
    const equipment = async (owner: SignedUpOwner, clientId: string) =>
      (
        await owner.agent
          .post(api('/facture/equipment'))
          .send({ clientId, name: 'Climatiseur salle 1', brand: 'Daikin', serialNumber: 'DK-001' })
          .expect(201)
      ).body.id as string;
    equipmentA = await equipment(orgA, clientA);
    equipmentB = await equipment(orgB, clientB);
    const item = async (kind: string, name: string, unit: string, unitPrice: number) =>
      (
        await orgA.agent
          .post(api('/facture/items'))
          .send({ kind, name, unit, unitPrice, vatRate: 18 })
          .expect(201)
      ).body.id as string;
    laborItem = await item('SERVICE', 'Main-d’œuvre technicien', 'heure', 10_000);
    partItem = await item('PRODUCT', 'Filtre à air', 'unité', 25_000);
    // Quatre connexions en tout (inscriptions comprises) : sous la limite du compartiment « auth ».
    tech = await member('TECHNICIAN', 'Technicien');
    sales = await member('SALES', 'Commercial');

    photo = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#3a7bd5' },
    })
      .png()
      .toBuffer();
    blank = await sharp({
      create: { width: 400, height: 150, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    signature = await sharp({
      create: { width: 400, height: 150, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: { create: { width: 220, height: 5, channels: 3, background: '#111111' } },
          top: 70,
          left: 90,
        },
      ])
      .png()
      .toBuffer();
  }, 300_000);

  afterAll(async () => {
    try {
      if (db && orgA && orgB) {
        await purgeFactureOrganizations(db, [orgA.organizationId, orgB.organizationId]);
      }
      if (prisma) {
        await cleanup(prisma);
        if (planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('planning : référence, lieu du client, équipement du client, créneau, techniciens ; base', async () => {
    const created = (await plan(orgA.agent).expect(201)).body;
    expect(created).toMatchObject({
      number: `INT-${YEAR}-00001`,
      status: 'PLANNED',
      siteAddress: 'Rue 310, Bamako',
      contactPhone: '+223 70 00 00 00',
      equipment: { id: equipmentA, name: 'Climatiseur salle 1' },
      technicians: [expect.objectContaining({ memberId: tech.id, name: 'Membre Technicien' })],
      can: { manage: true, work: true, invoice: true },
    });
    expect((await plan(orgA.agent).expect(201)).body.number).toBe(`INT-${YEAR}-00002`);

    // Équipement d'un autre client, d'une autre organisation ; créneau inversé ; membre non affectable.
    expect((await plan(orgA.agent, { clientId: clientA2 })).body.code).toBe(
      'FACTURE_EQUIPMENT_NOT_FOUND',
    );
    expect((await plan(orgA.agent, { equipmentId: equipmentB })).body.code).toBe(
      'FACTURE_EQUIPMENT_NOT_FOUND',
    );
    expect((await plan(orgA.agent, { scheduledEnd: `${TOMORROW}T07:00:00Z` })).body.code).toBe(
      'FACTURE_INTERVENTION_SLOT',
    );
    expect((await plan(orgA.agent, { technicianIds: [sales.id] })).body.code).toBe(
      'FACTURE_TECHNICIAN_INVALID',
    );
    await plan(orgA.agent, { technicianIds: ['not-a-uuid'] }).expect(400);

    // Planning de la semaine, puis déplacement du créneau.
    const week = await orgA.agent
      .get(api(`/facture/interventions?from=${TODAY}&to=${isoDay(new Date(Date.now() + 7 * DAY))}`))
      .expect(200);
    expect(week.body.map((r: { id: string }) => r.id)).toContain(created.id);
    const moved = (
      await orgA.agent
        .patch(api(`/facture/interventions/${created.id}`))
        .send({ scheduledStart: `${TOMORROW}T14:00:00Z`, scheduledEnd: `${TOMORROW}T16:00:00Z` })
        .expect(200)
    ).body;
    expect(moved.scheduledStart).toBe(`${TOMORROW}T14:00:00.000Z`);

    // La base refuse une intervention créée hors « planifiée » et toute suppression.
    await expect(
      db.factureIntervention.create({
        data: {
          organizationId: orgA.organizationId,
          number: `INT-${YEAR}-99999`,
          year: YEAR,
          sequence: 99_999,
          clientId: clientA,
          title: 'Forgée',
          scheduledStart: new Date(),
          scheduledEnd: new Date(Date.now() + DAY),
          status: 'COMPLETED',
          createdByUserId: orgA.organizationId,
        },
      }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_INVALID|FactureIntervention_completed_check/);
    await expect(db.factureIntervention.delete({ where: { id: created.id } })).rejects.toThrow(
      /FACTURE_INTERVENTION_FROZEN/,
    );
    await expect(
      db.factureIntervention.update({ where: { id: created.id }, data: { status: 'SIGNED' } }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN|FactureIntervention_/);
  });

  it('réalisée, signée, facturée : temps, pièces, photos, rapport figé, empreinte, facture', async () => {
    const id = (await plan(orgA.agent).expect(201)).body.id as string;
    // Rien ne se saisit avant le démarrage.
    expect((await time(tech.agent, id, 30)).body.code).toBe('FACTURE_INTERVENTION_NOT_IN_PROGRESS');
    await tech.agent.post(api(`/facture/interventions/${id}/start`)).expect(200);
    expect((await tech.agent.post(api(`/facture/interventions/${id}/start`))).status).toBe(409);

    await time(tech.agent, id, 90, { note: 'Recharge en gaz' }).expect(201);
    expect((await time(tech.agent, id, 30, { workDate: TOMORROW })).body.code).toBe(
      'FACTURE_TIME_IN_FUTURE',
    );
    await time(tech.agent, id, 721).expect(400);
    await tech.agent
      .post(api(`/facture/interventions/${id}/parts`))
      .send({ itemId: partItem, quantity: 2 })
      .expect(201);
    const wrongPart = await tech.agent
      .post(api(`/facture/interventions/${id}/parts`))
      .send({ itemId: equipmentA, quantity: 1 });
    expect(wrongPart.body.code).toBe('FACTURE_ITEM_NOT_FOUND');
    const pic = (await upload(tech.agent, id, photo).expect(201)).body.id as string;
    expect((await upload(tech.agent, id, Buffer.from('pas une image'))).body.code).toBe(
      'PHOTO_REFUSED',
    );
    expect((await upload(tech.agent, id, photo, 'image/gif')).body.code).toBe('PHOTO_REFUSED');
    const served = await tech.agent
      .get(api(`/facture/interventions/${id}/photos/${pic}`))
      .expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('no-store');

    const done = (
      await tech.agent
        .post(api(`/facture/interventions/${id}/complete`))
        .send({
          workSummary: 'Recharge en gaz R410A, nettoyage des filtres.',
          recommendations: 'Entretien tous les 6 mois.',
        })
        .expect(200)
    ).body;
    expect(done).toMatchObject({ status: 'COMPLETED', totalMinutes: 90 });
    expect(done.parts).toEqual([expect.objectContaining({ label: 'Filtre à air', quantity: 2 })]);
    expect(done.photos).toEqual([expect.objectContaining({ id: pic, caption: 'Avant travaux' })]);
    expect(done.photos[0].storageKey).toBeUndefined();

    // Travaux terminés : plus de saisie, ni par l'API ni directement en base.
    expect((await time(tech.agent, id, 15)).body.code).toBe('FACTURE_INTERVENTION_NOT_IN_PROGRESS');
    expect((await upload(tech.agent, id, photo)).body.code).toBe(
      'FACTURE_INTERVENTION_NOT_IN_PROGRESS',
    );
    await expect(
      db.factureTimeEntry.create({
        data: {
          organizationId: orgA.organizationId,
          interventionId: id,
          memberId: tech.id,
          workDate: new Date(TODAY),
          minutes: 600,
          createdByUserId: orgA.organizationId,
        },
      }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN/);
    await expect(db.facturePartUsage.deleteMany({ where: { interventionId: id } })).rejects.toThrow(
      /FACTURE_INTERVENTION_FROZEN/,
    );
    await expect(
      db.factureIntervention.update({ where: { id }, data: { workSummary: 'Réécrit' } }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN/);

    // Facturer avant la signature : refusé.
    expect(
      (await orgA.agent.post(api(`/facture/interventions/${id}/invoice`)).send({})).body.code,
    ).toBe('FACTURE_INTERVENTION_NOT_SIGNED');

    // Signature vide refusée ; signature valide : nom, date, empreinte SHA-256.
    expect((await sign(tech.agent, id, blank)).body.code).toBe('SIGNATURE_REFUSED');
    // Signature posée en base sans l'instantané des données imprimées : refusée.
    await expect(
      db.factureIntervention.update({
        where: { id },
        data: {
          status: 'SIGNED',
          signerName: 'Awa Traoré',
          signedAt: new Date(),
          signatureKey: 'cle-factice',
          reportHash: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_INVALID: une signature fige/);
    await sign(tech.agent, id, signature, 'A').expect(400);
    const signed = (await sign(tech.agent, id, signature).expect(200)).body;
    expect(signed).toMatchObject({
      status: 'SIGNED',
      signerName: 'Awa Traoré',
      hasSignature: true,
    });
    expect(signed.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.signatureKey).toBeUndefined();
    expect((await sign(tech.agent, id, signature)).body.code).toBe('FACTURE_INTERVENTION_STATUS');
    expect((await orgA.agent.post(api(`/facture/interventions/${id}/reopen`))).status).toBe(409);
    await expect(
      db.factureIntervention.update({ where: { id }, data: { signerName: 'Quelqu’un d’autre' } }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN/);

    // Audit V1 (P1) : client, lieu, équipement et techniciens imprimés sont figés à la signature.
    const frozen = await db.factureIntervention.findUniqueOrThrow({ where: { id } });
    expect(frozen.reportSnapshot).toMatchObject({
      client: { id: clientA, name: 'Hôtel du Fleuve' },
      equipment: { id: equipmentA, serialNumber: 'DK-001' },
      technicians: [expect.stringContaining('Technicien')],
    });
    await expect(
      db.factureIntervention.update({
        where: { id },
        data: { reportSnapshot: { client: { name: 'Faux' } } },
      }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN/);
    // Fiches modifiées après la signature : le rapport signé imprime toujours l'instantané.
    await db.factureEquipment.update({
      where: { id: equipmentA },
      data: { serialNumber: 'DK-999' },
    });
    await db.factureClient.update({ where: { id: clientA }, data: { name: 'Nom changé' } });
    const reread = await db.factureIntervention.findUniqueOrThrow({
      where: { id },
      include: { client: true, equipment: true, technicians: { include: { member: true } } },
    });
    expect(reread.client.name).toBe('Nom changé');
    const printed = app
      .get(FactureInterventionsService)
      .printedData(reread as unknown as Parameters<FactureInterventionsService['printedData']>[0]);
    expect(printed).toEqual(frozen.reportSnapshot);
    await db.factureEquipment.update({
      where: { id: equipmentA },
      data: { serialNumber: 'DK-001' },
    });
    await db.factureClient.update({ where: { id: clientA }, data: { name: 'Hôtel du Fleuve' } });
    const png = await tech.agent.get(api(`/facture/interventions/${id}/signature`)).expect(200);
    expect(png.headers['content-type']).toBe('image/png');

    const pdf = await tech.agent
      .get(api(`/facture/interventions/${id}/report`))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/rapport-INT-\d{4}-\d{5}\.pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Le technicien ne facture pas ; la facture brouillon reprend temps et pièces aux prix copiés.
    await tech.agent
      .post(api(`/facture/interventions/${id}/invoice`))
      .send({})
      .expect(403);
    const billed = (
      await orgA.agent
        .post(api(`/facture/interventions/${id}/invoice`))
        .send({ laborItemId: laborItem })
        .expect(201)
    ).body;
    expect(billed.created).toBe(true);
    const again = (
      await orgA.agent
        .post(api(`/facture/interventions/${id}/invoice`))
        .send({})
        .expect(201)
    ).body;
    expect(again).toEqual({ invoiceId: billed.invoiceId, created: false });

    const draft = (await orgA.agent.get(api(`/facture/documents/${billed.invoiceId}`)).expect(200))
      .body;
    expect(draft).toMatchObject({
      type: 'INVOICE',
      status: 'DRAFT',
      // 1,5 h × 10 000 + 2 × 25 000 = 65 000 HT ; TVA 18 % = 11 700.
      totalHt: 65_000,
      totalVat: 11_700,
      totalTtc: 76_700,
      intervention: { id },
    });
    expect(draft.subject).toMatch(/^Intervention INT-\d{4}-\d{5} — Climatiseur en panne$/);
    expect(draft.lines).toEqual([
      expect.objectContaining({
        itemId: laborItem,
        unit: 'heure',
        quantity: 1.5,
        unitPrice: 10_000,
      }),
      expect.objectContaining({ itemId: partItem, quantity: 2, unitPrice: 25_000 }),
    ]);
    const invoiced = (await orgA.agent.get(api(`/facture/interventions/${id}`)).expect(200)).body;
    expect(invoiced).toMatchObject({
      status: 'INVOICED',
      invoice: { id: billed.invoiceId, status: 'DRAFT' },
    });

    // Le brouillon garde son client et ne se supprime pas ; il s'émet normalement.
    const patch = await orgA.agent.put(api(`/facture/documents/${billed.invoiceId}`)).send({
      clientId: clientA2,
      lines: draft.lines.map(
        ({ id: _i, totalHt: _t, position: _p, ...l }: Record<string, unknown>) => l,
      ),
    });
    expect(patch.body.code).toBe('FACTURE_INTERVENTION_CLIENT');
    await expect(
      db.factureDocument.update({ where: { id: billed.invoiceId }, data: { clientId: clientA2 } }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_INVALID/);
    expect((await orgA.agent.delete(api(`/facture/documents/${billed.invoiceId}`))).body.code).toBe(
      'FACTURE_DOCUMENT_FROM_INTERVENTION',
    );
    const issued = (
      await orgA.agent.post(api(`/facture/documents/${billed.invoiceId}/issue`)).expect(200)
    ).body;
    expect(issued).toMatchObject({ status: 'ISSUED', totalTtc: 76_700 });
    expect(issued.number).toMatch(/^FAC-\d{4}-\d{5}$/);
  });

  it('concurrence : fin des travaux contre saisie ; double facturation ; photos plafonnées', async () => {
    const id = (await plan(orgA.agent).expect(201)).body.id as string;
    await tech.agent.post(api(`/facture/interventions/${id}/start`)).expect(200);
    await time(tech.agent, id, 30).expect(201);
    const [entry, done] = await Promise.all([
      time(tech.agent, id, 45),
      orgA.agent
        .post(api(`/facture/interventions/${id}/complete`))
        .send({ workSummary: 'Diagnostic carte électronique.' }),
    ]);
    expect(done.status).toBe(200);
    expect([201, 409]).toContain(entry.status);
    const rows = await db.factureTimeEntry.findMany({ where: { interventionId: id } });
    const final = (await orgA.agent.get(api(`/facture/interventions/${id}`)).expect(200)).body;
    // La saisie concurrente est soit comptée avant la fin, soit refusée : jamais ajoutée après.
    expect(rows).toHaveLength(entry.status === 201 ? 2 : 1);
    expect(final.totalMinutes).toBe(entry.status === 201 ? 75 : 30);

    await sign(tech.agent, id, signature).expect(200);
    const both = await Promise.all([
      orgA.agent.post(api(`/facture/interventions/${id}/invoice`)).send({ laborItemId: laborItem }),
      sales.agent
        .post(api(`/facture/interventions/${id}/invoice`))
        .send({ laborItemId: laborItem }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(both.map((r) => r.body.invoiceId)).size).toBe(1);
    expect(both.filter((r) => r.body.created)).toHaveLength(1);
    expect(
      await db.factureDocument.count({
        where: { organizationId: orgA.organizationId, intervention: { id } },
      }),
    ).toBe(1);

    // Douze photos au plus, même envoyées ensemble.
    const other = (await plan(orgA.agent).expect(201)).body.id as string;
    await tech.agent.post(api(`/facture/interventions/${other}/start`)).expect(200);
    const uploads = await Promise.all(
      Array.from({ length: 14 }, () => upload(tech.agent, other, photo)),
    );
    expect(uploads.filter((r) => r.status === 201)).toHaveLength(12);
    expect(uploads.filter((r) => r.body.code === 'FACTURE_PHOTOS_LIMIT')).toHaveLength(2);
  });

  it('réouverture, annulation, retrait de technicien : statuts tenus', async () => {
    const id = await completed();
    await tech.agent.post(api(`/facture/interventions/${id}/reopen`)).expect(403);
    // « Démarrer » une intervention réalisée ne la rouvre pas.
    expect((await tech.agent.post(api(`/facture/interventions/${id}/start`))).body.code).toBe(
      'FACTURE_INTERVENTION_STATUS',
    );
    const reopened = (await orgA.agent.post(api(`/facture/interventions/${id}/reopen`)).expect(200))
      .body;
    expect(reopened).toMatchObject({ status: 'IN_PROGRESS', completedAt: null });
    // Rouverte : saisie possible de nouveau ; le technicien qui a du temps reste affecté.
    await time(tech.agent, id, 15).expect(201);
    const unassign = await orgA.agent
      .patch(api(`/facture/interventions/${id}`))
      .send({ technicianIds: [] });
    expect(unassign.body.code).toBe('FACTURE_TECHNICIAN_HAS_TIME');

    const planned = (await plan(orgA.agent).expect(201)).body.id as string;
    await orgA.agent
      .post(api(`/facture/interventions/${planned}/cancel`))
      .send({ reason: 'x' })
      .expect(400);
    const cancelled = (
      await orgA.agent
        .post(api(`/facture/interventions/${planned}/cancel`))
        .send({ reason: 'Client absent, à replanifier' })
        .expect(200)
    ).body;
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Client absent, à replanifier',
    });
    expect((await tech.agent.post(api(`/facture/interventions/${planned}/start`))).status).toBe(
      409,
    );
    expect(
      (
        await orgA.agent
          .patch(api(`/facture/interventions/${planned}`))
          .send({ title: 'Nouveau titre' })
      ).body.code,
    ).toBe('FACTURE_INTERVENTION_CLOSED');
    await expect(
      db.factureIntervention.update({ where: { id: planned }, data: { status: 'PLANNED' } }),
    ).rejects.toThrow(/FACTURE_INTERVENTION_FROZEN|FactureIntervention_cancel_check/);
  });

  it('rôles et isolation : le technicien voit ses interventions ; le commercial planifie', async () => {
    const mine = (await plan(orgA.agent).expect(201)).body.id as string;
    const notMine = (await plan(orgA.agent, { technicianIds: [] }).expect(201)).body.id as string;

    const list = (await tech.agent.get(api('/facture/interventions')).expect(200)).body as {
      id: string;
    }[];
    expect(list.map((r) => r.id)).toContain(mine);
    expect(list.map((r) => r.id)).not.toContain(notMine);
    expect((await tech.agent.get(api(`/facture/interventions/${notMine}`))).status).toBe(404);
    expect((await tech.agent.post(api(`/facture/interventions/${notMine}/start`))).status).toBe(
      404,
    );
    await plan(tech.agent).expect(403);
    await tech.agent
      .post(api('/facture/equipment'))
      .send({ clientId: clientA, name: 'Groupe électrogène' })
      .expect(403);
    await tech.agent.get(api('/facture/documents')).expect(403);
    const mineView = (await tech.agent.get(api(`/facture/interventions/${mine}`)).expect(200)).body;
    expect(mineView.can).toEqual({ manage: false, work: true, invoice: false });

    // Un technicien saisit son propre temps seulement.
    await tech.agent.post(api(`/facture/interventions/${mine}/start`)).expect(200);
    await time(tech.agent, mine, 30, { memberId: sales.id }).expect(403);

    // Le commercial planifie, ne réalise pas.
    const bySales = (await plan(sales.agent).expect(201)).body;
    expect(bySales.can).toEqual({ manage: true, work: false, invoice: true });
    await sales.agent.post(api(`/facture/interventions/${bySales.id}/start`)).expect(403);
    await time(sales.agent, mine, 30, { memberId: tech.id }).expect(403);

    // Isolation : rien d'une autre organisation n'est visible ni utilisable.
    expect((await orgB.agent.get(api(`/facture/interventions/${mine}`))).status).toBe(404);
    expect((await orgB.agent.get(api('/facture/interventions')).expect(200)).body).toEqual([]);
    const crossEquipment = await orgB.agent.post(api('/facture/interventions')).send({
      clientId: clientB,
      equipmentId: equipmentA,
      title: 'Inter-organisation',
      scheduledStart: `${TOMORROW}T08:00:00Z`,
      scheduledEnd: `${TOMORROW}T09:00:00Z`,
      technicianIds: [tech.id],
    });
    expect(crossEquipment.body.code).toBe('FACTURE_EQUIPMENT_NOT_FOUND');
    const crossTech = await orgB.agent.post(api('/facture/interventions')).send({
      clientId: clientB,
      title: 'Inter-organisation',
      scheduledStart: `${TOMORROW}T08:00:00Z`,
      scheduledEnd: `${TOMORROW}T09:00:00Z`,
      technicianIds: [tech.id],
    });
    expect(crossTech.body.code).toBe('FACTURE_TECHNICIAN_INVALID');
    expect(
      (await orgB.agent.get(api('/facture/equipment')).expect(200)).body.map(
        (e: { id: string }) => e.id,
      ),
    ).toEqual([equipmentB]);
  });
});
