import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import sharp from 'sharp';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import { MailService } from '../src/common/mail/mail.service';
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
 * Ocall Facture — commercial F1 : clients, catalogue, devis, pro forma, bons de commande, factures en
 * brouillon, conversions, émission numérotée et figée (API et base), PDF, envoi par e-mail (fournisseur
 * simulé), rôles, lecture seule, isolation entre organisations. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const YEAR = new Date().getUTCFullYear();
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);

(enabled ? describe : describe.skip)('Ocall Facture F1 — commercial (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let mail: MailService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let clientId: string;
  let otherClientId: string;
  let itemId: string;
  let quoteId: string;

  const settings = {
    legalName: `Froid Services ${RUN} SARL`,
    tradeName: 'Froid Services',
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    phone: '+223 70 00 00 00',
    email: `contact.${RUN}@test.ocallpark.local`,
    nif: '084123456A',
    rccm: 'MA.BKO.2026.B.1234',
    taxRegime: 'Régime du réel normal',
    bankDetails: 'Banque fictive — compte 0000',
    legalFooter: null,
    defaultVatRate: 18,
    paymentTermsDays: 30,
    accentColor: '#0B5394',
    quoteValidityDays: 15,
    defaultTerms: 'Paiement à 30 jours.',
  };

  const line = (over: Record<string, unknown> = {}) => ({
    label: 'Maintenance climatiseur',
    unit: 'unité',
    quantity: 2,
    unitPrice: 25_000,
    vatRate: 18,
    ...over,
  });

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

  async function member(role: string): Promise<Agent> {
    const res = await orgA.agent
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName: role, role })
      .expect(201);
    const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  /** Brouillon créé puis émis ; renvoie le document émis. */
  async function issued(type: string, lines = [line()], extra: Record<string, unknown> = {}) {
    const draft = await orgA.agent
      .post(api('/facture/documents'))
      .send({ type, clientId, lines, ...extra })
      .expect(201);
    return (await orgA.agent.post(api(`/facture/documents/${draft.body.id}/issue`)).expect(200))
      .body;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(FacturePrismaService);
    mail = app.get(MailService);
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    planId = (
      await prisma.subscriptionPlan.create({
        data: {
          productId: product.id,
          name: `Facture F1 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF1A', 'PARK');
    orgB = await signup(app, 'factureF1B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    await orgA.agent.put(api('/facture/settings')).send(settings).expect(200);
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

  it('réglages PDF : couleur, validité et conditions proposées', async () => {
    const s = (await orgA.agent.get(api('/facture/settings')).expect(200)).body;
    expect(s).toMatchObject({
      accentColor: '#0b5394',
      quoteValidityDays: 15,
      defaultTerms: 'Paiement à 30 jours.',
    });
    for (const bad of [{ accentColor: 'bleu' }, { quoteValidityDays: 0 }]) {
      await orgA.agent
        .put(api('/facture/settings'))
        .send({ ...settings, ...bad })
        .expect(400);
    }
  });

  it('logos : 3 en en-tête (logo principal compris), 6 en bas de page, 1 cachet, même en envois simultanés', async () => {
    const png = () =>
      sharp({ create: { width: 240, height: 120, channels: 3, background: '#2266aa' } })
        .png()
        .toBuffer();
    const add = async (agent: Agent, placement: string, label?: string) => {
      const req = agent
        .post(api('/facture/settings/logos'))
        .field('placement', placement)
        .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' });
      return label ? req.field('label', label) : req;
    };
    const list = async () =>
      (await orgA.agent.get(api('/facture/settings/logos')).expect(200)).body as {
        id: string;
        placement: string;
        position: number;
      }[];
    // Organisation sans identité enregistrée, emplacement inconnu, image refusée.
    expect((await add(orgB.agent, 'FOOTER')).body.code).toBe('SETTINGS_REQUIRED');
    expect((await add(orgA.agent, 'SIDE')).status).toBe(400);
    const gif = await orgA.agent
      .post(api('/facture/settings/logos'))
      .field('placement', 'FOOTER')
      .attach('file', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
    expect(gif.body.code).toBe('LOGO_REFUSED');

    const burst = async (placement: string, count: number, accepted: number) => {
      const results = await Promise.all(
        Array.from({ length: count }, (_, i) => add(orgA.agent, placement, `${placement} ${i}`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(accepted);
      const refused = results.filter((r) => r.status !== 201);
      expect(refused.every((r) => r.status === 409 && r.body.code === 'FACTURE_LOGOS_LIMIT')).toBe(
        true,
      );
    };
    // Envois simultanés : jamais au-delà du plafond de l'emplacement.
    await burst('HEADER', 4, 3);
    await burst('FOOTER', 8, 6);
    await burst('STAMP', 2, 1);
    let logos = await list();
    const count = (placement: string) => logos.filter((l) => l.placement === placement).length;
    expect([count('HEADER'), count('FOOTER'), count('STAMP')]).toEqual([3, 6, 1]);
    expect(new Set(logos.filter((l) => l.placement === 'FOOTER').map((l) => l.position)).size).toBe(
      6,
    );
    // En-tête complet : le logo principal ne peut plus s'y ajouter.
    const main = await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' });
    expect(main.status).toBe(409);
    expect(main.body.code).toBe('FACTURE_LOGOS_LIMIT');
    // Un logo d'en-tête retiré : le logo principal prend sa place, et l'en-tête est de nouveau plein.
    const header = logos.filter((l) => l.placement === 'HEADER');
    await orgA.agent.delete(api(`/facture/settings/logos/${header[0]!.id}`)).expect(204);
    await orgA.agent
      .post(api('/facture/settings/logo'))
      .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect((await add(orgA.agent, 'HEADER')).body.code).toBe('FACTURE_LOGOS_LIMIT');

    const image = await orgA.agent.get(api(`/facture/settings/logos/${header[1]!.id}`)).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    // Les refusés n'ont laissé aucune ligne ; toutes les clés sont privées à l'organisation.
    const rows = await db.factureLogo.findMany({ where: { organizationId: orgA.organizationId } });
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.storageKey.includes(orgA.organizationId))).toBe(true);

    // Isolation.
    await orgB.agent.get(api(`/facture/settings/logos/${header[1]!.id}`)).expect(404);
    await orgB.agent.delete(api(`/facture/settings/logos/${header[1]!.id}`)).expect(404);
    // On garde 2 logos en bas de page et le cachet pour les PDF de la suite.
    logos = await list();
    for (const l of logos.filter((x) => x.placement === 'FOOTER').slice(2)) {
      await orgA.agent.delete(api(`/facture/settings/logos/${l.id}`)).expect(204);
    }
    expect((await list()).filter((l) => l.placement === 'FOOTER')).toHaveLength(2);
    const pdf = await orgA.agent.get(api('/facture/settings/letterhead.pdf')).expect(200);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('clients : validation, NIF unique, recherche, archivage, isolation', async () => {
    const created = await orgA.agent
      .post(api('/facture/clients'))
      .send({
        name: 'Hôtel du Fleuve SA',
        contactName: 'Awa Traoré',
        email: `Achats.${RUN}@Test.ocallpark.local`,
        phone: '+223 76 00 00 01',
        address: 'Route de Koulikoro',
        city: 'Bamako',
        nif: '087654321B',
        rib: 'ML000 00000 000000000000 00',
        description: 'Hôtellerie — site de Koulikoro',
      })
      .expect(201);
    clientId = created.body.id;
    expect(created.body).toMatchObject({
      rib: 'ML000 00000 000000000000 00',
      description: 'Hôtellerie — site de Koulikoro',
    });
    expect(created.body).toMatchObject({ kind: 'COMPANY', country: 'ML', isArchived: false });
    expect(created.body.email).toBe(`achats.${RUN}@test.ocallpark.local`);
    for (const bad of [
      { name: 'X' },
      { name: 'Client', phone: '76000000' },
      { name: 'Client', nif: '!' },
      { name: 'Client', organizationId: orgB.organizationId },
      { name: 'Client', kind: 'STATE' },
    ]) {
      await orgA.agent.post(api('/facture/clients')).send(bad).expect(400);
    }
    const twin = await orgA.agent
      .post(api('/facture/clients'))
      .send({ name: 'Doublon', nif: '087654321B' });
    expect(twin.status).toBe(409);
    expect(twin.body.code).toBe('FACTURE_CLIENT_NIF_TAKEN');
    // Même NIF dans une autre organisation : permis (aucun lien entre clients).
    await orgB.agent
      .post(api('/facture/clients'))
      .send({ name: 'Client B', nif: '087654321B' })
      .expect(201);
    otherClientId = (
      await orgA.agent
        .post(api('/facture/clients'))
        .send({ name: 'Moussa Keïta', kind: 'INDIVIDUAL' })
        .expect(201)
    ).body.id;

    const found = (await orgA.agent.get(api('/facture/clients?q=fleuve')).expect(200)).body;
    expect(found.map((c: { id: string }) => c.id)).toEqual([clientId]);
    await orgA.agent
      .patch(api(`/facture/clients/${otherClientId}`))
      .send({ isArchived: true })
      .expect(200);
    const active = (await orgA.agent.get(api('/facture/clients')).expect(200)).body;
    expect(active.map((c: { id: string }) => c.id)).not.toContain(otherClientId);
    const all = (await orgA.agent.get(api('/facture/clients?archived=true')).expect(200)).body;
    expect(all.map((c: { id: string }) => c.id)).toContain(otherClientId);

    // Isolation : un client d'une autre organisation n'existe pas.
    await orgB.agent.get(api(`/facture/clients/${clientId}`)).expect(404);
    await orgB.agent
      .patch(api(`/facture/clients/${clientId}`))
      .send({ name: 'Pris' })
      .expect(404);
    const listB = (await orgB.agent.get(api('/facture/clients')).expect(200)).body;
    expect(listB.map((c: { id: string }) => c.id)).not.toContain(clientId);
  });

  it('catalogue : prix entier en FCFA, TVA de 0 à 20 %, référence unique', async () => {
    const item = await orgA.agent
      .post(api('/facture/items'))
      .send({
        reference: 'MAINT-01',
        name: 'Maintenance climatiseur',
        unit: 'unité',
        unitPrice: 25_000,
        vatRate: 18,
      })
      .expect(201);
    itemId = item.body.id;
    expect(item.body).toMatchObject({ kind: 'SERVICE', isArchived: false });
    for (const bad of [
      { name: 'Pièce', unitPrice: 1.5, vatRate: 18 },
      { name: 'Pièce', unitPrice: -1, vatRate: 18 },
      { name: 'Pièce', unitPrice: 100, vatRate: 21 },
      { name: 'Pièce', unitPrice: 100, vatRate: '18' },
    ]) {
      await orgA.agent.post(api('/facture/items')).send(bad).expect(400);
    }
    const dup = await orgA.agent
      .post(api('/facture/items'))
      .send({ reference: 'MAINT-01', name: 'Autre', unitPrice: 1, vatRate: 18 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('FACTURE_ITEM_REFERENCE_TAKEN');
    expect(
      (await orgA.agent.get(api('/facture/items?q=maint')).expect(200)).body.map(
        (i: { id: string }) => i.id,
      ),
    ).toEqual([itemId]);
    await orgB.agent
      .patch(api(`/facture/items/${itemId}`))
      .send({ unitPrice: 1 })
      .expect(404);
  });

  it('brouillon : montants recalculés par l’API, contrôles, aperçu PDF sans numéro', async () => {
    const res = await orgA.agent
      .post(api('/facture/documents'))
      .send({
        type: 'QUOTE',
        clientId,
        subject: 'Entretien annuel',
        lines: [
          line({ itemId, reference: 'MAINT-01' }),
          line({ label: 'Pièce détachée', quantity: 1.5, unitPrice: 10_001, discountPercent: 10 }),
          line({ label: 'Formation', quantity: 1, unitPrice: 50_000, vatRate: 0 }),
        ],
      })
      .expect(201);
    quoteId = res.body.id;
    // 50 000 + 13 501,35 → 13 501 + 50 000 ; TVA 18 % sur 63 501 = 11 430,18 → 11 430.
    expect(res.body).toMatchObject({
      type: 'QUOTE',
      status: 'DRAFT',
      number: null,
      totalHt: 113_501,
      totalVat: 11_430,
      totalTtc: 124_931,
      validityDays: 15,
      terms: 'Paiement à 30 jours.',
      vatBreakdown: [
        { rate: 0, base: 50_000, amount: 0 },
        { rate: 18, base: 63_501, amount: 11_430 },
      ],
    });
    expect(res.body.lines.map((l: { totalHt: number }) => l.totalHt)).toEqual([
      50_000, 13_501, 50_000,
    ]);
    expect(res.body.lines[1].quantity).toBe(1.5);
    expect(res.body.lines[0].reference).toBe('MAINT-01');

    const bad = async (body: Record<string, unknown>, status: number, code?: string) => {
      const r = await orgA.agent.post(api('/facture/documents')).send(body);
      expect(r.status).toBe(status);
      if (code) expect(r.body.code).toBe(code);
    };
    // Montants imposés par le navigateur : refusés (champ non prévu).
    await bad({ type: 'QUOTE', clientId, lines: [line()], totalTtc: 1 }, 400);
    await bad({ type: 'QUOTE', clientId, lines: [line({ quantity: 1.0005 })] }, 400);
    await bad({ type: 'QUOTE', clientId, lines: [line({ vatRate: 19.5 })] }, 400);
    await bad({ type: 'QUOTE', clientId, lines: [line({ discountPercent: 101 })] }, 400);
    await bad({ type: 'CREDIT_NOTE', clientId, lines: [] }, 400);
    await bad(
      { type: 'QUOTE', clientId: otherClientId, lines: [] },
      409,
      'FACTURE_CLIENT_ARCHIVED',
    );
    const clientB = (await orgB.agent.get(api('/facture/clients')).expect(200)).body[0].id;
    await bad({ type: 'QUOTE', clientId: clientB, lines: [] }, 404, 'FACTURE_CLIENT_NOT_FOUND');
    const itemB = (
      await orgB.agent
        .post(api('/facture/items'))
        .send({ name: 'Article B', unitPrice: 1, vatRate: 18 })
        .expect(201)
    ).body.id;
    await bad(
      { type: 'QUOTE', clientId, lines: [line({ itemId: itemB })] },
      404,
      'FACTURE_ITEM_NOT_FOUND',
    );

    // Enregistrement : lignes remplacées en entier, totaux recalculés.
    const updated = await orgA.agent
      .put(api(`/facture/documents/${quoteId}`))
      .send({
        clientId,
        subject: 'Entretien annuel 2026',
        lines: [
          line({ itemId }),
          line({ label: 'Formation', unitPrice: 50_000, quantity: 1, vatRate: 0 }),
        ],
      })
      .expect(200);
    expect(updated.body).toMatchObject({ totalHt: 100_000, totalVat: 9_000, totalTtc: 109_000 });
    expect(updated.body.lines).toHaveLength(2);
    expect(await db.factureDocumentLine.count({ where: { documentId: quoteId } })).toBe(2);

    const pdf = await orgA.agent.get(api(`/facture/documents/${quoteId}/pdf`)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('brouillon-');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('émission : mentions légales, motif d’exonération, numéro unique sous concurrence, document figé', async () => {
    // Organisation sans identité enregistrée : émission refusée.
    const clientB = (await orgB.agent.get(api('/facture/clients')).expect(200)).body[0].id;
    const draftB = await orgB.agent
      .post(api('/facture/documents'))
      .send({ type: 'QUOTE', clientId: clientB, lines: [line()] })
      .expect(201);
    const refusedB = await orgB.agent.post(api(`/facture/documents/${draftB.body.id}/issue`));
    expect(refusedB.status).toBe(409);
    expect(refusedB.body.code).toBe('SETTINGS_REQUIRED');
    // NIF, adresse et régime facultatifs : la raison sociale suffit pour émettre.
    const minimal = (
      await orgB.agent
        .put(api('/facture/settings'))
        .send({ legalName: `Atelier B ${RUN}`, defaultVatRate: 18, paymentTermsDays: 0 })
        .expect(200)
    ).body;
    expect(minimal.legalMissing).toContain('Numéro d’identification fiscale (NIF)');
    const issuedB = (
      await orgB.agent.post(api(`/facture/documents/${draftB.body.id}/issue`)).expect(200)
    ).body;
    expect(issuedB.number).toBe(`DEV-${YEAR}-00001`);
    await orgB.agent.get(api(`/facture/documents/${draftB.body.id}/pdf`)).expect(200);

    const empty = await orgA.agent
      .post(api('/facture/documents'))
      .send({ type: 'QUOTE', clientId, lines: [] })
      .expect(201);
    const emptyIssue = await orgA.agent.post(api(`/facture/documents/${empty.body.id}/issue`));
    expect(emptyIssue.body.code).toBe('FACTURE_DOCUMENT_EMPTY');

    // Ligne exonérée sans motif : refus ; motif ajouté : émission.
    const noReason = await orgA.agent.post(api(`/facture/documents/${quoteId}/issue`));
    expect(noReason.status).toBe(409);
    expect(noReason.body.code).toBe('FACTURE_VAT_EXEMPTION_REASON_REQUIRED');
    const current = (await orgA.agent.get(api(`/facture/documents/${quoteId}`)).expect(200)).body;
    await orgA.agent
      .put(api(`/facture/documents/${quoteId}`))
      .send({
        clientId,
        subject: current.subject,
        vatExemptionReason: 'Formation professionnelle exonérée (fictif).',
        lines: current.lines.map(
          ({ id: _i, position: _p, totalHt: _t, ...l }: Record<string, unknown>) => l,
        ),
      })
      .expect(200);

    // Deux émissions simultanées du même brouillon : un seul numéro.
    const [a, b] = await Promise.all([
      orgA.agent.post(api(`/facture/documents/${quoteId}/issue`)),
      orgA.agent.post(api(`/facture/documents/${quoteId}/issue`)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const doc = (a.status === 200 ? a : b).body;
    expect(doc).toMatchObject({ status: 'ISSUED', number: `DEV-${YEAR}-00001`, sequence: 1 });
    expect(new Date(doc.validUntil).getTime() - new Date(doc.issueDate).getTime()).toBe(15 * DAY);
    expect(
      await db.factureNumberCounter.findUnique({
        where: {
          organizationId_type_year: {
            organizationId: orgA.organizationId,
            type: 'QUOTE',
            year: YEAR,
          },
        },
      }),
    ).toMatchObject({ value: 1 });

    // Figé par l'API…
    const edit = await orgA.agent
      .put(api(`/facture/documents/${quoteId}`))
      .send({ clientId, lines: [line()] });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('FACTURE_DOCUMENT_NOT_DRAFT');
    expect((await orgA.agent.delete(api(`/facture/documents/${quoteId}`))).status).toBe(409);
    // … et par la base elle-même.
    await expect(
      db.factureDocument.update({ where: { id: quoteId }, data: { totalTtc: 1n } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    await expect(
      db.factureDocument.update({ where: { id: quoteId }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow();
    await expect(db.factureDocument.delete({ where: { id: quoteId } })).rejects.toThrow(
      /FACTURE_DOCUMENT_FROZEN/,
    );
    await expect(
      db.factureDocumentLine.updateMany({ where: { documentId: quoteId }, data: { unitPrice: 1 } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    await expect(
      db.factureDocumentLine.deleteMany({ where: { documentId: quoteId } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);

    // Identité du client figée à l'émission.
    await orgA.agent
      .patch(api(`/facture/clients/${clientId}`))
      .send({ name: 'Hôtel du Fleuve (nouveau nom)' })
      .expect(200);
    const frozen = (await orgA.agent.get(api(`/facture/documents/${quoteId}`)).expect(200)).body;
    expect(frozen.client).toMatchObject({
      name: 'Hôtel du Fleuve SA',
      description: 'Hôtellerie — site de Koulikoro',
    });
    const stored = await db.factureDocument.findUniqueOrThrow({ where: { id: quoteId } });
    expect(stored.sellerSnapshot).toMatchObject({
      legalName: settings.legalName,
      salesperson: { loginId: orgA.loginId },
    });
    const pdf = await orgA.agent.get(api(`/facture/documents/${quoteId}/pdf`)).expect(200);
    expect(pdf.headers['content-disposition']).toContain(`DEV-${YEAR}-00001.pdf`);
  });

  it('envoi par e-mail : PDF joint, réponse à l’entreprise, statut « envoyé » seulement si accepté', async () => {
    const start = mail.outbox.length;
    const sent = (
      await orgA.agent
        .post(api(`/facture/documents/${quoteId}/send`))
        .send({ message: 'Comme convenu par téléphone.' })
        .expect(200)
    ).body;
    expect(sent).toMatchObject({ status: 'SENT', sentCount: 1 });
    const message = mail.outbox[start]!;
    expect(message.to).toEqual([`achats.${RUN}@test.ocallpark.local`]);
    expect(message.replyTo).toBe(settings.email);
    expect(message.subject).toContain(`DEV-${YEAR}-00001`);
    expect(message.text).toContain('Comme convenu par téléphone.');
    expect(message.idempotencyKey).toBe(`facture-document/${quoteId}/1`);
    expect(message.attachments![0]!.filename).toBe(`DEV-${YEAR}-00001.pdf`);
    expect(message.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');

    // Échec du fournisseur : erreur, statut et compteur inchangés.
    const spy = jest.spyOn(mail, 'send').mockResolvedValueOnce(false);
    const failed = await orgA.agent
      .post(api(`/facture/documents/${quoteId}/send`))
      .send({ to: 'autre@test.ocallpark.local' });
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('MAIL_NOT_SENT');
    spy.mockRestore();
    expect((await db.factureDocument.findUniqueOrThrow({ where: { id: quoteId } })).sentCount).toBe(
      1,
    );

    // Brouillon : jamais envoyé ; client sans e-mail : destinataire exigé.
    const draft = await orgA.agent
      .post(api('/facture/documents'))
      .send({ type: 'QUOTE', clientId, lines: [line()] })
      .expect(201);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${draft.body.id}/send`)).send({})).body.code,
    ).toBe('FACTURE_DOCUMENT_NOT_SENDABLE');
    const noMail = (
      await orgA.agent.post(api('/facture/clients')).send({ name: 'Sans E-mail SARL' }).expect(201)
    ).body.id;
    const issuedNoMail = (
      await orgA.agent
        .post(api('/facture/documents'))
        .send({ type: 'PRO_FORMA', clientId: noMail, lines: [line()] })
        .expect(201)
    ).body.id;
    await orgA.agent.post(api(`/facture/documents/${issuedNoMail}/issue`)).expect(200);
    const missing = await orgA.agent.post(api(`/facture/documents/${issuedNoMail}/send`)).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('FACTURE_RECIPIENT_REQUIRED');
  });

  it('conversions : devis → bon de commande → facture brouillon, idempotentes, liées à l’origine', async () => {
    const [c1, c2] = await Promise.all([
      orgA.agent.post(api(`/facture/documents/${quoteId}/convert`)).send({ type: 'ORDER' }),
      orgA.agent.post(api(`/facture/documents/${quoteId}/convert`)).send({ type: 'ORDER' }),
    ]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(c1.body.id).toBe(c2.body.id);
    const order = c1.body;
    expect(order).toMatchObject({
      type: 'ORDER',
      status: 'DRAFT',
      number: null,
      sourceDocumentId: quoteId,
      totalTtc: 109_000,
      validityDays: null,
      vatExemptionReason: 'Formation professionnelle exonérée (fictif).',
    });
    expect(order.source).toMatchObject({ id: quoteId, number: `DEV-${YEAR}-00001` });
    expect(order.lines).toHaveLength(2);
    // Convertir le devis vaut acceptation.
    const quote = (await orgA.agent.get(api(`/facture/documents/${quoteId}`)).expect(200)).body;
    expect(quote.status).toBe('ACCEPTED');
    expect(quote.derived).toEqual([expect.objectContaining({ id: order.id, type: 'ORDER' })]);
    // Brouillon de bon de commande : pas encore convertible.
    const early = await orgA.agent
      .post(api(`/facture/documents/${order.id}/convert`))
      .send({ type: 'INVOICE' });
    expect(early.body.code).toBe('FACTURE_CONVERSION_NOT_ALLOWED');

    const orderIssued = (
      await orgA.agent.post(api(`/facture/documents/${order.id}/issue`)).expect(200)
    ).body;
    expect(orderIssued.number).toBe(`BC-${YEAR}-00001`);
    // Un bon de commande n'est ni accepté ni refusé (il vaut accord du client).
    expect((await orgA.agent.post(api(`/facture/documents/${order.id}/accept`))).status).toBe(409);
    await orgA.agent
      .post(api(`/facture/documents/${order.id}/convert`))
      .send({ type: 'QUOTE' })
      .expect(400);

    const invoice = (
      await orgA.agent
        .post(api(`/facture/documents/${order.id}/convert`))
        .send({ type: 'INVOICE' })
        .expect(200)
    ).body;
    expect(invoice).toMatchObject({ type: 'INVOICE', status: 'DRAFT', sourceDocumentId: order.id });
    // Émission d'une facture : module de facturation (F2).
    const issueInvoice = await orgA.agent.post(api(`/facture/documents/${invoice.id}/issue`));
    expect(issueInvoice.status).toBe(409);
    expect(issueInvoice.body.code).toBe('FACTURE_ISSUE_NOT_AVAILABLE');

    // Annuler l'origine d'un document en vigueur : refusé.
    const cancelQuote = await orgA.agent
      .post(api(`/facture/documents/${quoteId}/cancel`))
      .send({ reason: 'Erreur de saisie' });
    expect(cancelQuote.status).toBe(409);
    expect(cancelQuote.body.code).toBe('FACTURE_DOCUMENT_HAS_DERIVED');

    // Isolation : une autre organisation ne voit ni ne convertit ces documents.
    await orgB.agent.get(api(`/facture/documents/${quoteId}`)).expect(404);
    await orgB.agent.get(api(`/facture/documents/${quoteId}/pdf`)).expect(404);
    await orgB.agent
      .post(api(`/facture/documents/${quoteId}/convert`))
      .send({ type: 'INVOICE' })
      .expect(404);
    const listB = (await orgB.agent.get(api('/facture/documents')).expect(200)).body;
    expect(listB.map((d: { id: string }) => d.id)).not.toContain(quoteId);
  });

  it('refus, annulation (numéro conservé), suppression d’un brouillon, duplication', async () => {
    const refused = await issued('QUOTE');
    expect(refused.number).toBe(`DEV-${YEAR}-00002`);
    await orgA.agent.post(api(`/facture/documents/${refused.id}/refuse`)).expect(200);
    const convert = await orgA.agent
      .post(api(`/facture/documents/${refused.id}/convert`))
      .send({ type: 'ORDER' });
    expect(convert.body.code).toBe('FACTURE_CONVERSION_NOT_ALLOWED');
    const cancelled = (
      await orgA.agent
        .post(api(`/facture/documents/${refused.id}/cancel`))
        .send({ reason: 'Client injoignable' })
        .expect(200)
    ).body;
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      number: `DEV-${YEAR}-00002`,
      cancelReason: 'Client injoignable',
    });
    expect(
      (
        await orgA.agent
          .post(api(`/facture/documents/${refused.id}/cancel`))
          .send({ reason: 'Encore' })
      ).status,
    ).toBe(409);
    await expect(
      db.factureDocument.update({ where: { id: refused.id }, data: { status: 'ISSUED' } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    // Numéro annulé jamais réattribué.
    expect((await issued('QUOTE')).number).toBe(`DEV-${YEAR}-00003`);

    const copy = (
      await orgA.agent.post(api(`/facture/documents/${refused.id}/duplicate`)).expect(201)
    ).body;
    expect(copy).toMatchObject({
      type: 'QUOTE',
      status: 'DRAFT',
      number: null,
      sourceDocumentId: null,
      totalTtc: refused.totalTtc,
    });
    await orgA.agent.delete(api(`/facture/documents/${copy.id}`)).expect(204);
    await orgA.agent.get(api(`/facture/documents/${copy.id}`)).expect(404);
    const drafts = (
      await orgA.agent.get(api('/facture/documents?type=QUOTE&status=DRAFT')).expect(200)
    ).body;
    expect(drafts.every((d: { status: string }) => d.status === 'DRAFT')).toBe(true);
  });

  it('rôles : commercial et comptable vendent, le technicien consulte clients et catalogue seulement', async () => {
    const tech = await member('TECHNICIAN');
    const accountant = await member('ACCOUNTANT');
    await tech.get(api('/facture/clients')).expect(200);
    await tech.get(api('/facture/items')).expect(200);
    await tech.get(api('/facture/documents')).expect(403);
    await tech.get(api(`/facture/documents/${quoteId}/pdf`)).expect(403);
    await tech.post(api('/facture/clients')).send({ name: 'Par le technicien' }).expect(403);
    await accountant
      .post(api('/facture/documents'))
      .send({ type: 'INVOICE', clientId, lines: [line()] })
      .expect(201);
    await accountant
      .post(api('/facture/items'))
      .send({ name: 'Par le comptable', unitPrice: 1, vatRate: 18 })
      .expect(403);
  });

  it('essai échu : clients et documents consultables, aucune écriture', async () => {
    const product = await prisma.saasProduct.findUniqueOrThrow({
      where: { code: FACTURE_PRODUCT_CODE },
    });
    await prisma.productTrial.update({
      where: {
        organizationId_productId: { organizationId: orgB.organizationId, productId: product.id },
      },
      data: { endsAt: new Date(Date.now() - DAY) },
    });
    await orgB.agent.get(api('/facture/clients')).expect(200);
    await orgB.agent.get(api('/facture/documents')).expect(200);
    const write = await orgB.agent.post(api('/facture/clients')).send({ name: 'Nouveau' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('identifiants mal formés refusés', async () => {
    await orgA.agent.get(api('/facture/documents/abc')).expect(400);
    await orgA.agent.get(api('/facture/clients/abc')).expect(400);
    await orgA.agent.post(api('/facture/documents/abc/issue')).expect(400);
  });
});
