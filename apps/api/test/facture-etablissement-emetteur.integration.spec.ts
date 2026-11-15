import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE, STOCK_PRODUCT_CODE } from '@ocall/shared';
import { FacturePrismaService } from '../src/modules/facture/facture-prisma.service';
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
 * Ocall Suite S2 — Facture : établissement émetteur facultatif, pris dans le référentiel commun des sites
 * (aucun référentiel Facture). Choix limité aux établissements actifs de l'organisation, figé à l'émission
 * (copie imprimée, garantie aussi par la base), numérotation unique par organisation, documents déjà émis
 * inchangés, avoir et vente en caisse Stock (boutique de la vente), droits Facture inchangés, isolation.
 * Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const YEAR = new Date().getUTCFullYear();
const enabled = Boolean(
  process.env.TEST_STOCK_DATABASE_URL && process.env.TEST_FACTURE_DATABASE_URL,
);
const key = () => randomUUID().replace(/-/g, '');

(enabled ? describe : describe.skip)('Ocall Facture — établissement émetteur (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let factureDb: FacturePrismaService;
  let stockDb: OcallStockPrismaService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let a: Agent;
  const plans = new Map<string, string>();
  let clientA: string;
  let kayes: string; // établissement actif, avec adresse
  let closed: string; // établissement désactivé
  let foreign: string; // établissement de l'organisation B
  let legacyInvoice: { id: string; number: string };
  let kayesInvoice: { id: string; number: string };

  const settings = {
    legalName: `Quincaillerie ${RUN} SARL`,
    tradeName: 'Quincaillerie du Fleuve',
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    nif: '084123456A',
    defaultVatRate: 18,
    paymentTermsDays: 30,
  };
  const line = {
    label: 'Peinture blanche 5 L',
    unit: 'unité',
    quantity: 1,
    unitPrice: 10_000,
    vatRate: 18,
  };

  async function startTrial(code: string, organizationId: string) {
    const product = await prisma.saasProduct.findUniqueOrThrow({ where: { code } });
    let planId = plans.get(code);
    if (!planId) {
      planId = (
        await prisma.subscriptionPlan.create({
          data: {
            productId: product.id,
            name: `FE ${code} ${RUN}`,
            monthlyPrice: 50_000,
            setupFee: 0,
            isActive: false,
          },
        })
      ).id;
      plans.set(code, planId);
    }
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

  async function establishment(agent: Agent, name: string, extra: Record<string, unknown> = {}) {
    return (
      await agent
        .post(api('/establishments'))
        .send({ name, businessType: 'NONE', ...extra })
        .expect(201)
    ).body.id as string;
  }

  const create = (body: Record<string, unknown>, agent: Agent = a) =>
    agent
      .post(api('/facture/documents'))
      .send({ type: 'INVOICE', clientId: clientA, lines: [line], ...body });
  const put = (id: string, body: Record<string, unknown>, agent: Agent = a) =>
    agent.put(api(`/facture/documents/${id}`)).send({ clientId: clientA, lines: [line], ...body });
  const issue = (id: string) => a.post(api(`/facture/documents/${id}/issue`));
  const get = async (id: string) => (await a.get(api(`/facture/documents/${id}`)).expect(200)).body;

  async function factureMember(role: string, lastName: string) {
    const res = await a
      .post(api('/facture/members'))
      .send({ firstName: 'Membre', lastName, role })
      .expect(201);
    const session = await login(app, res.body.member.loginId, res.body.temporaryPassword);
    await session.agent
      .post(api('/auth/change-password'))
      .send({ currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    factureDb = app.get(FacturePrismaService);
    stockDb = app.get(OcallStockPrismaService);
    orgA = await signup(app, 'factureEtabA', 'PARK');
    orgB = await signup(app, 'factureEtabB', 'PARK');
    a = orgA.agent;
    await startTrial(FACTURE_PRODUCT_CODE, orgA.organizationId);
    await startTrial(STOCK_PRODUCT_CODE, orgA.organizationId);
    await startTrial(FACTURE_PRODUCT_CODE, orgB.organizationId);
    await a.put(api('/facture/settings')).send(settings).expect(200);
    clientA = (
      await a.post(api('/facture/clients')).send({ kind: 'COMPANY', name: 'BTP Sahel' }).expect(201)
    ).body.id;
    // Document émis avant tout établissement : il doit rester tel quel.
    const legacy = (await create({}).expect(201)).body;
    legacyInvoice = { id: legacy.id, number: (await issue(legacy.id).expect(200)).body.number };
    kayes = await establishment(a, 'Agence Kayes', {
      city: 'Kayes',
      address: 'Rue 12, Plateau',
      phone: '+223 21 52 00 00',
    });
    closed = await establishment(a, 'Agence Ségou');
    await a
      .patch(api(`/establishments/${closed}`))
      .send({ isActive: false })
      .expect(200);
    foreign = await establishment(orgB.agent, 'Agence B');
  }, 300_000);

  afterAll(async () => {
    try {
      const orgs = [orgA?.organizationId, orgB?.organizationId].filter(Boolean) as string[];
      if (factureDb && orgs.length) await purgeFactureOrganizations(factureDb, orgs);
      if (stockDb && orgs.length) {
        const { purgeStockOrganizations } = await import('@ocall/stock-database');
        await purgeStockOrganizations(stockDb, orgs);
      }
      if (prisma) {
        await cleanup(prisma);
        if (plans.size) {
          await prisma.subscriptionPlan.deleteMany({ where: { id: { in: [...plans.values()] } } });
        }
      }
    } finally {
      await app?.close();
    }
  });

  it('choix : établissements de l’organisation seulement, actifs ; un autre est introuvable', async () => {
    const choices = (await a.get(api('/facture/establishments')).expect(200)).body as {
      id: string;
      isActive: boolean;
    }[];
    const ids = choices.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([kayes, closed]));
    expect(ids).not.toContain(foreign);
    expect(choices.find((c) => c.id === closed)?.isActive).toBe(false);
    // Les actifs d'abord.
    expect(choices.findIndex((c) => !c.isActive)).toBeGreaterThan(
      choices.findIndex((c) => c.id === kayes),
    );

    const other = await create({ establishmentId: foreign }).expect(404);
    expect(other.body.code).toBe('FACTURE_ESTABLISHMENT_NOT_FOUND');
    const inactive = await create({ establishmentId: closed }).expect(409);
    expect(inactive.body.code).toBe('FACTURE_ESTABLISHMENT_INACTIVE');
    const missing = await create({ establishmentId: randomUUID() }).expect(404);
    expect(missing.body.code).toBe('FACTURE_ESTABLISHMENT_NOT_FOUND');
    await create({ establishmentId: 'pas-un-uuid' }).expect(400);
    // Aucun document créé par ces refus (seul le document émis existe).
    expect(
      await factureDb.factureDocument.count({ where: { organizationId: orgA.organizationId } }),
    ).toBe(1);
  });

  it('brouillon : choisi, inchangé si absent, retiré par null ; figé et imprimé à l’émission', async () => {
    const draft = (await create({ establishmentId: kayes }).expect(201)).body;
    expect(draft.establishmentId).toBe(kayes);
    expect(draft.establishment).toMatchObject({ id: kayes, name: 'Agence Kayes', isActive: true });

    // Modification sans le champ : établissement conservé.
    expect((await put(draft.id, { subject: 'Commande 1' }).expect(200)).body.establishmentId).toBe(
      kayes,
    );
    expect(
      (await put(draft.id, { establishmentId: null }).expect(200)).body.establishment,
    ).toBeNull();
    const inactive = await put(draft.id, { establishmentId: closed }).expect(409);
    expect(inactive.body.code).toBe('FACTURE_ESTABLISHMENT_INACTIVE');
    await put(draft.id, { establishmentId: foreign }).expect(404);
    await put(draft.id, { establishmentId: kayes }).expect(200);

    // Numérotation : unique pour toute l'organisation, à la suite du document émis sans établissement.
    const issued = (await issue(draft.id).expect(200)).body;
    expect(legacyInvoice.number).toBe(`FAC-${YEAR}-00001`);
    expect(issued.number).toBe(`FAC-${YEAR}-00002`);
    expect(issued.establishment).toEqual({
      id: kayes,
      name: 'Agence Kayes',
      address: 'Rue 12, Plateau',
      city: 'Kayes',
      phone: '+223 21 52 00 00',
      isActive: null,
    });
    kayesInvoice = { id: issued.id, number: issued.number };

    // Le lieu change ensuite : le document émis garde la copie figée.
    await a
      .patch(api(`/establishments/${kayes}`))
      .send({ name: 'Agence Kayes Centre' })
      .expect(200);
    expect((await get(issued.id)).establishment.name).toBe('Agence Kayes');
    const pdf = await a.get(api(`/facture/documents/${issued.id}/pdf`)).expect(200);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');

    // Garantie en base : l'établissement d'un document émis ne change plus.
    await expect(
      factureDb.factureDocument.update({
        where: { organizationId_id: { organizationId: orgA.organizationId, id: issued.id } },
        data: { establishmentId: null },
      }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    // Un brouillon se modifie librement.
    const free = (await create({}).expect(201)).body;
    await factureDb.factureDocument.update({
      where: { organizationId_id: { organizationId: orgA.organizationId, id: free.id } },
      data: { establishmentId: kayes },
    });
    await a.delete(api(`/facture/documents/${free.id}`)).expect(204);
  });

  it('documents déjà émis : aucun établissement, contenu inchangé', async () => {
    const legacy = await get(legacyInvoice.id);
    expect(legacy).toMatchObject({
      establishmentId: null,
      establishment: null,
      number: legacyInvoice.number,
    });
    const row = await factureDb.factureDocument.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgA.organizationId, id: legacyInvoice.id } },
      select: { sellerSnapshot: true },
    });
    expect(row.sellerSnapshot).not.toHaveProperty('establishment');
  });

  it('établissement désactivé avant l’émission : refus clair, aucun numéro consommé', async () => {
    const segou = await establishment(a, 'Agence Mopti');
    const draft = (await create({ establishmentId: segou }).expect(201)).body;
    await a
      .patch(api(`/establishments/${segou}`))
      .send({ isActive: false })
      .expect(200);
    // Le brouillon montre l'établissement désactivé.
    expect((await get(draft.id)).establishment).toMatchObject({ id: segou, isActive: false });
    const refused = await issue(draft.id).expect(409);
    expect(refused.body.code).toBe('FACTURE_ESTABLISHMENT_INACTIVE');
    expect((await get(draft.id)).status).toBe('DRAFT');
    // Retiré, il s'émet avec le numéro suivant (aucun trou).
    await put(draft.id, { establishmentId: null }).expect(200);
    expect((await issue(draft.id).expect(200)).body.number).toBe(`FAC-${YEAR}-00003`);
  });

  it('avoir : établissement de la facture corrigée, non modifiable, même désactivé depuis', async () => {
    const note = (
      await a.post(api(`/facture/documents/${kayesInvoice.id}/credit-note`)).expect(201)
    ).body;
    expect(note.establishmentId).toBe(kayes);
    const locked = await put(note.id, { establishmentId: null }).expect(409);
    expect(locked.body.code).toBe('FACTURE_ESTABLISHMENT_LOCKED');
    // Sans le champ (écran : champ verrouillé), la modification passe.
    await put(note.id, { subject: 'Avoir partiel' }).expect(200);
    const second = await establishment(a, 'Agence Sikasso');
    const relock = await put(note.id, { establishmentId: second }).expect(409);
    expect(relock.body.code).toBe('FACTURE_ESTABLISHMENT_LOCKED');
    // L'avoir s'émet avec la copie figée sur la facture, quel que soit l'état actuel du lieu.
    const issued = (await issue(note.id).expect(200)).body;
    expect(issued.number).toBe(`AV-${YEAR}-00001`);
    expect(issued.establishment).toMatchObject({ id: kayes, name: 'Agence Kayes' });
  });

  it('liste : filtre par établissement et nom actuel du lieu', async () => {
    const all = (await a.get(api('/facture/documents')).expect(200)).body as {
      id: string;
      establishmentName: string | null;
    }[];
    expect(all.find((d) => d.id === kayesInvoice.id)?.establishmentName).toBe(
      'Agence Kayes Centre',
    );
    expect(all.find((d) => d.id === legacyInvoice.id)?.establishmentName).toBeNull();
    const filtered = (await a.get(api(`/facture/documents?establishmentId=${kayes}`)).expect(200))
      .body as { id: string }[];
    expect(filtered.map((d) => d.id)).toContain(kayesInvoice.id);
    expect(filtered.map((d) => d.id)).not.toContain(legacyInvoice.id);
    // Un établissement d'une autre organisation ne révèle rien.
    expect(
      (await a.get(api(`/facture/documents?establishmentId=${foreign}`)).expect(200)).body,
    ).toEqual([]);
  });

  it('droits Facture inchangés : rôle sans documents, consultation seule, autre organisation', async () => {
    const tech = await factureMember('TECHNICIAN', 'Technicien');
    await tech.get(api('/facture/establishments')).expect(403);
    await tech
      .put(api(`/facture/documents/${kayesInvoice.id}`))
      .send({ clientId: clientA, lines: [line] })
      .expect(403);
    // Organisation B : ne voit ni les établissements ni les documents de A.
    const choicesB = (await orgB.agent.get(api('/facture/establishments')).expect(200)).body as {
      id: string;
    }[];
    expect(choicesB.map((c) => c.id)).toContain(foreign);
    expect(choicesB.map((c) => c.id)).not.toContain(kayes);
    await orgB.agent.get(api(`/facture/documents/${kayesInvoice.id}`)).expect(404);
  });

  it('vente en caisse Stock : établissement de la boutique repris, non modifiable', async () => {
    const shop = (
      await a
        .post(api('/ocall-stock/sites'))
        .send({ code: 'KAY', name: 'Boutique Kayes', kind: 'STORE', establishmentId: kayes })
        .expect(201)
    ).body;
    expect(shop.establishmentId).toBe(kayes);
    const unlinked = (
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

    async function sale(site: { locations: { id: string }[] }, code: string) {
      const register = (
        await a
          .post(api('/ocall-stock/registers'))
          .send({ code, name: `Caisse ${code}`, locationId: site.locations[0]!.id })
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
            idempotencyKey: key(),
            registerId: register,
            lines: [{ variantId: variant, quantity: 1 }],
            payments: [{ method: 'CASH', amount: 5_900 }],
          })
          .expect(201)
      ).body;
    }

    const fromShop = await sale(shop, 'CK1');
    const invoice = (
      await a
        .post(api('/facture/stock/sales/invoice'))
        .send({ sale: fromShop.id, clientId: clientA })
        .expect(201)
    ).body;
    expect(invoice.establishmentId).toBe(kayes);
    expect(invoice.establishment).toMatchObject({ id: kayes, name: 'Agence Kayes Centre' });
    const locked = await put(invoice.id, {
      establishmentId: null,
      lines: invoice.lines.map((l: Record<string, unknown>) => ({
        itemId: l.itemId,
        label: l.label,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
      })),
    }).expect(409);
    expect(locked.body.code).toBe('FACTURE_ESTABLISHMENT_LOCKED');
    const issued = (await issue(invoice.id).expect(200)).body;
    expect(issued.establishment).toMatchObject({ id: kayes, name: 'Agence Kayes Centre' });

    // Boutique sans établissement : facture de l'organisation, comme avant.
    const fromFree = await sale(unlinked, 'CL1');
    const plain = (
      await a
        .post(api('/facture/stock/sales/invoice'))
        .send({ sale: fromFree.id, clientId: clientA })
        .expect(201)
    ).body;
    expect(plain.establishmentId).toBeNull();
  });
});
