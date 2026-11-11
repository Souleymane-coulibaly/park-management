import type { INestApplication } from '@nestjs/common';
import { purgeFactureOrganizations } from '@ocall/facture-database';
import { FACTURE_PRODUCT_CODE } from '@ocall/shared';
import { MailService } from '../src/common/mail/mail.service';
import type { FactureContext } from '../src/modules/facture/facture-access';
import { FactureDocumentsService } from '../src/modules/facture/facture-documents.service';
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
 * Ocall Facture — facturation F2 : facture émise figée (échéance, jamais annulée), encaissements
 * partiels plafonnés au reste dû (même en saisies simultanées), annulation d'un encaissement, avoirs
 * plafonnés au TTC, relances par e-mail (fournisseur simulé), tableau de bord, exports CSV, rôles,
 * isolation. Données fictives, bases locales jetables.
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const YEAR = new Date().getUTCFullYear();
const enabled = Boolean(process.env.TEST_FACTURE_DATABASE_URL);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = isoDay(new Date());

(enabled ? describe : describe.skip)('Ocall Facture F2 — facturation (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: FacturePrismaService;
  let mail: MailService;
  let orgA: SignedUpOwner;
  let orgB: SignedUpOwner;
  let planId: string;
  let clientA: string;
  let clientB: string;

  const settings = (name: string) => ({
    legalName: `${name} ${RUN} SARL`,
    tradeName: name,
    address: 'Rue 310, ACI 2000',
    city: 'Bamako',
    email: `compta.${name.toLowerCase().replace(/\W/g, '')}.${RUN}@test.ocallpark.local`,
    nif: '084123456A',
    taxRegime: 'Régime du réel normal',
    defaultVatRate: 18,
    paymentTermsDays: 30,
  });

  /** 2 × 25 000 HT à 18 % : 59 000 TTC. */
  const line = (quantity = 2) => ({
    label: 'Maintenance climatiseur',
    unit: 'unité',
    quantity,
    unitPrice: 25_000,
    vatRate: 18,
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

  async function invoice(agent: Agent, clientId: string, extra: Record<string, unknown> = {}) {
    const draft = await agent
      .post(api('/facture/documents'))
      .send({ type: 'INVOICE', clientId, lines: [line()], ...extra })
      .expect(201);
    return (await agent.post(api(`/facture/documents/${draft.body.id}/issue`)).expect(200)).body;
  }

  const pay = (agent: Agent, id: string, amount: number, over: Record<string, unknown> = {}) =>
    agent
      .post(api(`/facture/documents/${id}/payments`))
      .send({ amount, method: 'CASH', paidAt: TODAY, ...over });

  /** Contexte d'un propriétaire, pour émettre à une date passée (échéance dépassée). */
  async function ownerContext(owner: SignedUpOwner): Promise<FactureContext> {
    const user = await prisma.user.findUniqueOrThrow({ where: { loginId: owner.loginId } });
    return {
      organizationId: owner.organizationId,
      userId: user.id,
      role: 'MANAGER',
      memberId: null,
      isOwner: true,
    } as unknown as FactureContext;
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
          name: `Facture F2 test ${RUN}`,
          monthlyPrice: 50_000,
          setupFee: 200_000,
          isActive: false,
        },
      })
    ).id;
    orgA = await signup(app, 'factureF2A', 'PARK');
    orgB = await signup(app, 'factureF2B', 'PARK');
    await startTrial(orgA.organizationId);
    await startTrial(orgB.organizationId);
    await orgA.agent.put(api('/facture/settings')).send(settings('Froid Services')).expect(200);
    await orgB.agent.put(api('/facture/settings')).send(settings('Kati Clim')).expect(200);
    clientA = (
      await orgA.agent
        .post(api('/facture/clients'))
        .send({ name: 'Hôtel du Fleuve', email: `achats.${RUN}@test.ocallpark.local` })
        .expect(201)
    ).body.id;
    clientB = (
      await orgB.agent
        .post(api('/facture/clients'))
        .send({ name: 'Clinique Lumière', nif: '099887766B' })
        .expect(201)
    ).body.id;
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

  it('facture émise : numéro, échéance, jamais annulée ni supprimée, figée par la base', async () => {
    const inv = await invoice(orgA.agent, clientA);
    expect(inv).toMatchObject({
      type: 'INVOICE',
      status: 'ISSUED',
      number: `FAC-${YEAR}-00001`,
      paymentTermsDays: 30,
      totalTtc: 59_000,
      amountPaid: 0,
      amountCredited: 0,
      balance: 59_000,
      overdue: false,
    });
    expect(isoDay(new Date(inv.dueDate))).toBe(isoDay(new Date(Date.parse(TODAY) + 30 * DAY)));
    // Délai propre à la facture : paiement à réception.
    const now = await invoice(orgA.agent, clientA, { paymentTermsDays: 0 });
    expect(isoDay(new Date(now.dueDate))).toBe(TODAY);

    const cancel = await orgA.agent
      .post(api(`/facture/documents/${inv.id}/cancel`))
      .send({ reason: 'Erreur de prix' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('FACTURE_DOCUMENT_STATUS');
    expect((await orgA.agent.delete(api(`/facture/documents/${inv.id}`))).status).toBe(409);
    await expect(
      db.factureDocument.update({ where: { id: inv.id }, data: { dueDate: new Date() } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    await expect(
      db.factureDocument.update({ where: { id: inv.id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);
    // Encaissement hors facture émise : refusé par la base aussi.
    const quote = await orgA.agent
      .post(api('/facture/documents'))
      .send({ type: 'QUOTE', clientId: clientA, lines: [line()] })
      .expect(201);
    await expect(
      db.factureDocument.update({ where: { id: quote.body.id }, data: { amountPaid: 1n } }),
    ).rejects.toThrow(/FactureDocument_settlement_check/);
    expect((await pay(orgA.agent, quote.body.id, 1_000)).body.code).toBe(
      'FACTURE_PAYMENT_NOT_ALLOWED',
    );

    const pdf = await orgA.agent.get(api(`/facture/documents/${inv.id}/pdf`)).expect(200);
    expect(pdf.headers['content-disposition']).toContain(`FAC-${YEAR}-00001.pdf`);
  });

  it('encaissement en deux fois : payée en partie puis soldée ; plafond, date, annulation', async () => {
    const inv = await invoice(orgA.agent, clientA);
    const first = (await pay(orgA.agent, inv.id, 20_000, { reference: 'Reçu 0012' }).expect(201))
      .body;
    expect(first).toMatchObject({ status: 'PARTIALLY_PAID', amountPaid: 20_000, balance: 39_000 });
    expect(first.payments).toEqual([
      expect.objectContaining({ amount: 20_000, method: 'CASH', reference: 'Reçu 0012' }),
    ]);

    const over = await pay(orgA.agent, inv.id, 39_001);
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({
      code: 'FACTURE_PAYMENT_EXCEEDS_BALANCE',
      details: { balance: 39_000 },
    });
    const tomorrow = isoDay(new Date(Date.parse(TODAY) + DAY));
    expect((await pay(orgA.agent, inv.id, 1_000, { paidAt: tomorrow })).body.code).toBe(
      'FACTURE_PAYMENT_DATE_FUTURE',
    );
    await pay(orgA.agent, inv.id, 0).expect(400);
    await pay(orgA.agent, inv.id, 1_000, { paidAt: '2026-02-30' }).expect(400);
    await pay(orgA.agent, inv.id, 1_000, { method: 'BITCOIN' }).expect(400);

    const paid = (await pay(orgA.agent, inv.id, 39_000, { method: 'MOBILE_MONEY' }).expect(201))
      .body;
    expect(paid).toMatchObject({ status: 'PAID', amountPaid: 59_000, balance: 0 });
    expect((await pay(orgA.agent, inv.id, 1)).body.code).toBe('FACTURE_PAYMENT_NOT_ALLOWED');

    // Erreur de saisie : l'encaissement s'annule (motif conservé), la facture redevient due.
    const second = paid.payments[1].id as string;
    const reopened = (
      await orgA.agent
        .post(api(`/facture/documents/${inv.id}/payments/${second}/cancel`))
        .send({ reason: 'Transaction mobile money refusée' })
        .expect(200)
    ).body;
    expect(reopened).toMatchObject({
      status: 'PARTIALLY_PAID',
      amountPaid: 20_000,
      balance: 39_000,
    });
    expect(reopened.payments[1]).toMatchObject({
      cancelReason: 'Transaction mobile money refusée',
      cancelledAt: expect.any(String),
    });
    const again = await orgA.agent
      .post(api(`/facture/documents/${inv.id}/payments/${second}/cancel`))
      .send({ reason: 'Encore' });
    expect(again.body.code).toBe('FACTURE_PAYMENT_CANCELLED');

    // Encaissement figé par la base : ni modifié, ni supprimé, ni « désannulé ».
    await expect(
      db.facturePayment.update({ where: { id: first.payments[0].id }, data: { amount: 1n } }),
    ).rejects.toThrow(/FACTURE_PAYMENT_FROZEN/);
    await expect(db.facturePayment.delete({ where: { id: second } })).rejects.toThrow(
      /FACTURE_PAYMENT_FROZEN/,
    );
    await expect(
      db.facturePayment.update({
        where: { id: second },
        data: { cancelledAt: null, cancelledByUserId: null, cancelReason: null },
      }),
    ).rejects.toThrow(/FACTURE_PAYMENT_FROZEN/);

    // Saisies simultanées du reste dû : une seule passe.
    const results = await Promise.all([
      pay(orgA.agent, inv.id, 39_000),
      pay(orgA.agent, inv.id, 39_000),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const final = (await orgA.agent.get(api(`/facture/documents/${inv.id}`)).expect(200)).body;
    expect(final).toMatchObject({ status: 'PAID', amountPaid: 59_000, balance: 0 });
  });

  it('avoirs : partiel puis total, plafonnés au TTC, facture annulée par avoir ; trop-perçu', async () => {
    const inv = await invoice(orgA.agent, clientA);
    const [a, b] = await Promise.all([
      orgA.agent.post(api(`/facture/documents/${inv.id}/credit-note`)),
      orgA.agent.post(api(`/facture/documents/${inv.id}/credit-note`)),
    ]);
    // Un seul brouillon d'avoir par facture, même en double clic.
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const note = a.body;
    expect(note).toMatchObject({
      type: 'CREDIT_NOTE',
      status: 'DRAFT',
      creditedInvoiceId: inv.id,
      clientId: clientA,
      totalTtc: 59_000,
      subject: `Avoir sur la facture ${inv.number}`,
    });

    // Le client d'un avoir est celui de la facture ; un avoir ne s'annule pas une fois émis.
    const other = (
      await orgA.agent.post(api('/facture/clients')).send({ name: 'Autre client' }).expect(201)
    ).body.id;
    const moved = await orgA.agent
      .put(api(`/facture/documents/${note.id}`))
      .send({ clientId: other, lines: [line()] });
    expect(moved.body.code).toBe('FACTURE_CREDIT_NOTE_CLIENT');

    // Avoir partiel : une unité sur deux.
    await orgA.agent
      .put(api(`/facture/documents/${note.id}`))
      .send({ clientId: clientA, subject: note.subject, lines: [line(1)] })
      .expect(200);
    const partial = (await orgA.agent.post(api(`/facture/documents/${note.id}/issue`)).expect(200))
      .body;
    expect(partial).toMatchObject({
      status: 'ISSUED',
      number: `AV-${YEAR}-00001`,
      totalTtc: 29_500,
      dueDate: null,
    });
    const pdf = await orgA.agent.get(api(`/facture/documents/${note.id}/pdf`)).expect(200);
    expect(pdf.headers['content-disposition']).toContain(`AV-${YEAR}-00001.pdf`);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${note.id}/cancel`)).send({ reason: 'Non' }))
        .status,
    ).toBe(409);
    await expect(
      db.factureDocument.update({ where: { id: note.id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow(/FACTURE_DOCUMENT_FROZEN/);

    let current = (await orgA.agent.get(api(`/facture/documents/${inv.id}`)).expect(200)).body;
    expect(current).toMatchObject({
      status: 'PARTIALLY_PAID',
      amountCredited: 29_500,
      balance: 29_500,
    });
    expect(current.creditNotes).toEqual([
      expect.objectContaining({ id: note.id, number: `AV-${YEAR}-00001`, totalTtc: 29_500 }),
    ]);

    // Second avoir, total : dépasse le reste à créditer, refusé à l'émission.
    const full = (
      await orgA.agent.post(api(`/facture/documents/${inv.id}/credit-note`)).expect(201)
    ).body;
    const tooMuch = await orgA.agent.post(api(`/facture/documents/${full.id}/issue`));
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body).toMatchObject({
      code: 'FACTURE_CREDIT_EXCEEDS_INVOICE',
      details: { available: 29_500 },
    });
    await orgA.agent
      .put(api(`/facture/documents/${full.id}`))
      .send({ clientId: clientA, lines: [line(1)] })
      .expect(200);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${full.id}/issue`)).expect(200)).body.number,
    ).toBe(`AV-${YEAR}-00002`);
    current = (await orgA.agent.get(api(`/facture/documents/${inv.id}`)).expect(200)).body;
    expect(current).toMatchObject({ status: 'CREDITED', amountCredited: 59_000, balance: 0 });
    expect((await orgA.agent.post(api(`/facture/documents/${inv.id}/credit-note`))).body.code).toBe(
      'FACTURE_CREDIT_NOT_ALLOWED',
    );
    expect((await pay(orgA.agent, inv.id, 1)).body.code).toBe('FACTURE_PAYMENT_NOT_ALLOWED');

    // Avoir après paiement complet : trop-perçu à rembourser (reste dû négatif), facture soldée.
    const paidInv = await invoice(orgA.agent, clientA);
    await pay(orgA.agent, paidInv.id, 59_000).expect(201);
    const refund = (
      await orgA.agent.post(api(`/facture/documents/${paidInv.id}/credit-note`)).expect(201)
    ).body;
    await orgA.agent
      .put(api(`/facture/documents/${refund.id}`))
      .send({ clientId: clientA, lines: [line(1)] })
      .expect(200);
    await orgA.agent.post(api(`/facture/documents/${refund.id}/issue`)).expect(200);
    expect(
      (await orgA.agent.get(api(`/facture/documents/${paidInv.id}`)).expect(200)).body,
    ).toMatchObject({ status: 'PAID', balance: -29_500 });

    // Un avoir naît d'une facture émise seulement.
    const draftInvoice = await orgA.agent
      .post(api('/facture/documents'))
      .send({ type: 'INVOICE', clientId: clientA, lines: [line()] })
      .expect(201);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${draftInvoice.body.id}/credit-note`))).body
        .code,
    ).toBe('FACTURE_CREDIT_NOT_ALLOWED');
    await orgA.agent
      .post(api('/facture/documents'))
      .send({ type: 'CREDIT_NOTE', clientId: clientA, lines: [line()] })
      .expect(400);
  });

  it('audit V1 : avoir contrôlé par taux de TVA ; envoi sans écraser une facture soldée', async () => {
    // Facture : 25 000 HT à 18 % + 25 000 HT à 5 % = 29 500 + 26 250 = 55 750 TTC.
    const mixed = await invoice(orgA.agent, clientA, {
      lines: [line(1), { ...line(1), label: 'Formation', vatRate: 5 }],
    });
    expect(mixed.totalTtc).toBe(55_750);
    const note = (
      await orgA.agent.post(api(`/facture/documents/${mixed.id}/credit-note`)).expect(201)
    ).body;
    const tryIssue = async (lines: Record<string, unknown>[]) => {
      await orgA.agent
        .put(api(`/facture/documents/${note.id}`))
        .send({ clientId: clientA, lines })
        .expect(200);
      return orgA.agent.post(api(`/facture/documents/${note.id}/issue`));
    };
    // Taux absent de la facture (TTC pourtant sous le plafond) : refusé.
    const wrongRate = await tryIssue([{ ...line(1), vatRate: 10 }]);
    expect([wrongRate.status, wrongRate.body.code]).toEqual([409, 'FACTURE_CREDIT_NOTE_VAT']);
    // Base à 5 % dépassée (50 000 > 25 000) alors que le TTC (52 500) reste sous 55 750 : refusé.
    const overBase = await tryIssue([{ ...line(2), vatRate: 5 }]);
    expect([overBase.status, overBase.body.code]).toEqual([409, 'FACTURE_CREDIT_NOTE_VAT']);
    // Dans les bases de chaque taux : émis.
    expect((await tryIssue([{ ...line(1), vatRate: 5 }])).status).toBe(200);

    // Envoi pendant lequel la facture est soldée : le statut « payée » n'est jamais écrasé.
    const inv = await invoice(orgA.agent, clientA);
    const spy = jest.spyOn(mail, 'send').mockImplementationOnce(async () => {
      await pay(orgA.agent, inv.id, 59_000).expect(201);
      return true;
    });
    const sent = (
      await orgA.agent
        .post(api(`/facture/documents/${inv.id}/send`))
        .send({})
        .expect(200)
    ).body;
    spy.mockRestore();
    expect(sent).toMatchObject({ status: 'PAID', sentCount: 1 });
    // Facture émise non réglée : l'envoi la passe bien « envoyée ».
    const other = await invoice(orgA.agent, clientA);
    expect(
      (
        await orgA.agent
          .post(api(`/facture/documents/${other.id}/send`))
          .send({})
          .expect(200)
      ).body,
    ).toMatchObject({ status: 'SENT', sentCount: 1 });
  });

  it('relance : e-mail avec reste dû et facture jointe, comptée seulement si le fournisseur accepte', async () => {
    const inv = await invoice(orgA.agent, clientA);
    await pay(orgA.agent, inv.id, 9_000).expect(201);
    const start = mail.outbox.length;
    const reminded = (
      await orgA.agent
        .post(api(`/facture/documents/${inv.id}/remind`))
        .send({})
        .expect(200)
    ).body;
    expect(reminded).toMatchObject({ reminderCount: 1, lastReminderAt: expect.any(String) });
    const message = mail.outbox[start]!;
    expect(message.to).toEqual([`achats.${RUN}@test.ocallpark.local`]);
    expect(message.subject).toContain(`Relance — facture ${inv.number}`);
    expect(message.text).toMatch(/reste à payer de 50\s000/);
    expect(message.idempotencyKey).toBe(`facture-document/${inv.id}/reminder/1`);
    expect(message.attachments![0]!.filename).toBe(`${inv.number}.pdf`);

    const spy = jest.spyOn(mail, 'send').mockResolvedValueOnce(false);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${inv.id}/remind`)).send({})).status,
    ).toBe(502);
    spy.mockRestore();
    expect(
      (await db.factureDocument.findUniqueOrThrow({ where: { id: inv.id } })).reminderCount,
    ).toBe(1);

    await pay(orgA.agent, inv.id, 50_000).expect(201);
    expect(
      (await orgA.agent.post(api(`/facture/documents/${inv.id}/remind`)).send({})).body.code,
    ).toBe('FACTURE_REMINDER_NOT_ALLOWED');
  });

  it('tableau de bord et exports : facturé net des avoirs, encaissé, reste dû, retards', async () => {
    const documents = app.get(FactureDocumentsService);
    const ctx = await ownerContext(orgB);
    // Facture émise il y a 40 jours, à 30 jours : échue depuis 10 jours.
    const oldDraft = await orgB.agent
      .post(api('/facture/documents'))
      .send({ type: 'INVOICE', clientId: clientB, lines: [line()] })
      .expect(201);
    const late = await documents.issue(ctx, oldDraft.body.id, new Date(Date.now() - 40 * DAY));
    expect(late.overdue).toBe(true);
    // Facture du jour, 118 000 TTC : 10 000 encaissés, avoir de 29 500.
    const current = await invoice(orgB.agent, clientB, { lines: [line(4)] });
    await pay(orgB.agent, current.id, 10_000, {
      method: 'BANK_TRANSFER',
      reference: 'VIR-77',
    }).expect(201);
    const note = (
      await orgB.agent.post(api(`/facture/documents/${current.id}/credit-note`)).expect(201)
    ).body;
    await orgB.agent
      .put(api(`/facture/documents/${note.id}`))
      .send({ clientId: clientB, lines: [line(1)] })
      .expect(200);
    const issuedNote = (
      await orgB.agent.post(api(`/facture/documents/${note.id}/issue`)).expect(200)
    ).body;
    // Devis en attente de réponse.
    const quote = await orgB.agent
      .post(api('/facture/documents'))
      .send({ type: 'QUOTE', clientId: clientB, lines: [line()] })
      .expect(201);
    await orgB.agent.post(api(`/facture/documents/${quote.body.id}/issue`)).expect(200);

    const board = (await orgB.agent.get(api('/facture/dashboard')).expect(200)).body;
    const sameMonth = new Date(Date.now() - 40 * DAY).getUTCMonth() === new Date().getUTCMonth();
    expect(sameMonth).toBe(false);
    expect(board).toMatchObject({
      month: TODAY.slice(0, 7),
      invoiced: { count: 1, creditNotes: 1, netHt: 75_000, netTtc: 88_500 },
      collected: { count: 1, amount: 10_000 },
      outstanding: { count: 2, amount: 59_000 + 78_500 },
      overdue: { count: 1, amount: 59_000 },
      quotes: { count: 1, amountTtc: 59_000 },
    });
    expect(board.overdue.invoices).toEqual([
      expect.objectContaining({ id: late.id, client: 'Clinique Lumière', balance: 59_000 }),
    ]);
    // Isolation : le tableau de bord d'une organisation ignore les autres.
    const boardA = (await orgA.agent.get(api('/facture/dashboard')).expect(200)).body;
    expect(boardA.overdue.invoices.map((i: { id: string }) => i.id)).not.toContain(late.id);

    const from = isoDay(new Date(Date.now() - 60 * DAY));
    const sales = await orgB.agent
      .get(api(`/facture/exports/sales?from=${from}&to=${TODAY}`))
      .expect(200);
    expect(sales.headers['content-type']).toContain('text/csv');
    expect(sales.headers['content-disposition']).toContain(`journal-ventes-${from}-${TODAY}.csv`);
    const csv = sales.text;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Date;Type;Numéro;Facture corrigée;Client;NIF client');
    expect(csv).toContain(`${late.number};;Clinique Lumière;099887766B;50000;9000;59000`);
    expect(csv).toContain(`;Avoir;${issuedNote.number};${current.number};Clinique Lumière;`);
    expect(csv).toContain(';-25000;-4500;-29500;');
    expect(csv).not.toContain(quote.body.id);

    const payments = await orgB.agent
      .get(api(`/facture/exports/payments?from=${from}&to=${TODAY}`))
      .expect(200);
    expect(payments.text).toContain(
      `${TODAY};${current.number};Clinique Lumière;10000;Virement;VIR-77;En vigueur`,
    );
    await orgB.agent.get(api(`/facture/exports/sales?from=2025-01-01&to=${TODAY}`)).expect(400);
    await orgB.agent.get(api(`/facture/exports/sales?from=${TODAY}&to=${from}`)).expect(400);
    await orgB.agent.get(api('/facture/exports/sales?from=hier&to=demain')).expect(400);
    // Isolation : les exports d'une organisation ignorent les autres.
    const salesA = await orgA.agent
      .get(api(`/facture/exports/sales?from=${from}&to=${TODAY}`))
      .expect(200);
    expect(salesA.text).not.toContain('Clinique Lumière');
  });

  it('rôles et isolation : encaissements, avoirs et exports réservés au gérant et au comptable', async () => {
    const sales = await member('SALES');
    // Deux membres seulement : inscription et connexion partagent le même quota anti-abus.
    const accountant = await member('ACCOUNTANT');
    const inv = await invoice(sales, clientA);
    expect(inv.number).toMatch(/^FAC-/);
    await pay(sales, inv.id, 1_000).expect(403);
    await sales.post(api(`/facture/documents/${inv.id}/credit-note`)).expect(403);
    await sales.get(api(`/facture/exports/sales?from=${TODAY}&to=${TODAY}`)).expect(403);
    await sales.get(api('/facture/dashboard')).expect(200);

    await pay(accountant, inv.id, 1_000).expect(201);
    const note = (
      await accountant.post(api(`/facture/documents/${inv.id}/credit-note`)).expect(201)
    ).body;
    // Le brouillon d'avoir ne se modifie, ne s'émet ni ne se supprime par un commercial.
    const edit = await sales
      .put(api(`/facture/documents/${note.id}`))
      .send({ clientId: clientA, lines: [line(1)] });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('FACTURE_FORBIDDEN');
    await sales.post(api(`/facture/documents/${note.id}/issue`)).expect(403);
    await sales.delete(api(`/facture/documents/${note.id}`)).expect(403);
    await accountant.delete(api(`/facture/documents/${note.id}`)).expect(204);
    await accountant.get(api(`/facture/exports/payments?from=${TODAY}&to=${TODAY}`)).expect(200);

    // Isolation : une autre organisation n'encaisse, ne crédite ni ne relance ces factures.
    await pay(orgB.agent, inv.id, 1_000).expect(404);
    await orgB.agent.post(api(`/facture/documents/${inv.id}/credit-note`)).expect(404);
    await orgB.agent
      .post(api(`/facture/documents/${inv.id}/remind`))
      .send({})
      .expect(404);
    const payment = (await orgA.agent.get(api(`/facture/documents/${inv.id}`)).expect(200)).body
      .payments[0].id as string;
    await orgB.agent
      .post(api(`/facture/documents/${inv.id}/payments/${payment}/cancel`))
      .send({ reason: 'Intrusion' })
      .expect(404);
    // Encaissement d'une autre facture de la même organisation : introuvable sur celle-ci.
    const otherInv = await invoice(orgA.agent, clientA);
    await orgA.agent
      .post(api(`/facture/documents/${otherInv.id}/payments/${payment}/cancel`))
      .send({ reason: 'Mauvaise facture' })
      .expect(404);
    await orgA.agent
      .post(api(`/facture/documents/${inv.id}/payments/not-a-uuid/cancel`))
      .expect(400);
  });
});
