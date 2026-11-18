import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { Test } from 'supertest';
import { OCALL_INVOICE_REQUIRED_FIELDS } from '@ocall/shared';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  type InternalAccount,
  RUN,
  type SignedUpOwner,
  cleanup,
  createTestApp,
  internalAccount,
  signup,
} from './helpers';

/**
 * Commercialisation J2 : identité légale de l'éditeur Ocall, factures et reçus d'abonnement en PDF.
 *
 * - Rien n'est inventé : identité vide = pages « à compléter », factures provisoires.
 * - Seul le propriétaire (ou un administrateur) modifie l'identité ; la facturation la lit.
 * - Facture définitive seulement si les mentions obligatoires sont renseignées à l'émission ; l'identité
 *   est alors figée sur la facture et ne change plus.
 * - Espace client : uniquement les documents de son organisation ; reçu après confirmation seulement.
 *
 * L'identité est une ligne unique de la plateforme : sauvegardée puis rétablie (bases de test jetables).
 */
const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

const IDENTITY = {
  legalName: `Société fictive de test ${RUN}`,
  legalForm: 'SARL (fictive)',
  address: 'Rue fictive 1',
  city: 'Ville fictive',
  country: 'Mali',
  rccm: 'RCCM-FICTIF-1',
  nif: 'NIF-FICTIF-1',
  taxRegime: 'Mention fiscale fictive de test',
  bankDetails: 'Banque fictive — IBAN fictif',
};

/** Textes écrits dans le PDF pendant la requête (même processus que l'API de test). */
async function pdf(request: Test) {
  const texts: string[] = [];
  const real = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
    this: PDFKit.PDFDocument,
    ...args: unknown[]
  ) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return (real as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    const res = await request.buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    return { res, body: res.body as Buffer, text: texts.join('\n') };
  } finally {
    spy.mockRestore();
  }
}

describe('Commercialisation J2 — identité légale Ocall, factures et reçus PDF', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: InternalAccount;
  let billing: InternalAccount;
  let client: SignedUpOwner;
  let other: SignedUpOwner;
  let saved: Record<string, unknown> | null = null;
  let provisionalId: string;
  let definitiveId: string;

  async function issue(organizationId: string) {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
    const res = await owner.agent.post(api('/platform/invoices')).send({
      subscriptionId: sub.id,
      lines: [{ kind: 'MONTHLY', months: 1 }],
      idempotencyKey: randomUUID(),
    });
    if (res.status !== 201) throw new Error(`facture ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; number: string; total: number; definitive: boolean };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await internalAccount(app, prisma, `j2owner-${RUN}`, 'PLATFORM_OWNER');
    billing = await internalAccount(app, prisma, `j2billing-${RUN}`, 'BILLING_MANAGER');
    client = await signup(app, 'j2client', 'PARK');
    other = await signup(app, 'j2other', 'PARK');
    saved = await prisma.platformLegalIdentity.findUnique({ where: { id: 'ocall' } });
    await prisma.platformLegalIdentity.deleteMany({ where: { id: 'ocall' } });
  }, 300_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.platformLegalIdentity.deleteMany({ where: { id: 'ocall' } });
        if (saved) await prisma.platformLegalIdentity.create({ data: saved as never });
        await cleanup(prisma);
      }
    } finally {
      await app?.close();
    }
  });

  it('identité vide : rien d’inventé, toutes les mentions obligatoires manquent', async () => {
    const pub = (await client.agent.get(api('/public/suite/legal-identity')).expect(200)).body;
    expect(Object.values(pub).every((v) => v === null)).toBe(true);
    expect(pub).not.toHaveProperty('bankDetails');
    const view = (await billing.agent.get(api('/platform/legal-identity')).expect(200)).body;
    expect(view.invoicesDefinitive).toBe(false);
    expect(view.missingForInvoices).toEqual([...OCALL_INVOICE_REQUIRED_FIELDS]);
  });

  it('modification réservée au propriétaire, journalisée sans les valeurs', async () => {
    await billing.agent
      .put(api('/platform/legal-identity'))
      .send({ legalName: 'Tentative' })
      .expect(403);
    await client.agent.put(api('/platform/legal-identity')).send({ legalName: 'X' }).expect(403);
    const view = (
      await owner.agent
        .put(api('/platform/legal-identity'))
        .send({ legalName: IDENTITY.legalName, bankDetails: IDENTITY.bankDetails, phone: '  ' })
        .expect(200)
    ).body;
    expect(view.identity).toMatchObject({ legalName: IDENTITY.legalName, phone: null });
    expect(view.invoicesDefinitive).toBe(false);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'platform.legal_identity_updated', actorUserId: owner.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.metadata).toEqual({ fields: ['legalName', 'bankDetails'] });
    expect(JSON.stringify(log.metadata)).not.toContain('fictive');
    // Les coordonnées bancaires ne sont jamais publiées.
    const pub = (await client.agent.get(api('/public/suite/legal-identity')).expect(200)).body;
    expect(pub.legalName).toBe(IDENTITY.legalName);
    expect(JSON.stringify(pub)).not.toContain('IBAN');
  });

  it('identité incomplète : la facture émise est provisoire, et son PDF le dit', async () => {
    const invoice = await issue(client.organizationId);
    provisionalId = invoice.id;
    expect(invoice.definitive).toBe(false);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.issuerSnapshot).toBeNull();
    const { res, body, text } = await pdf(
      owner.agent.get(api(`/platform/invoices/${invoice.id}/pdf`)),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`Facture-${invoice.number}.pdf`);
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(text).toContain('FACTURE PROVISOIRE');
    expect(text).toContain('PROVISOIRE');
    expect(body.toString('latin1')).toContain(`Facture provisoire ${invoice.number}`);
  });

  it('identité complète : facture définitive, identité figée à l’émission', async () => {
    const view = (await owner.agent.put(api('/platform/legal-identity')).send(IDENTITY).expect(200))
      .body;
    expect(view.invoicesDefinitive).toBe(true);
    expect(view.missingForInvoices).toEqual([]);
    const invoice = await issue(client.organizationId);
    definitiveId = invoice.id;
    expect(invoice.definitive).toBe(true);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.issuerSnapshot).toMatchObject(IDENTITY);

    // Changement ultérieur de l'identité : la facture déjà émise ne change pas.
    await owner.agent
      .put(api('/platform/legal-identity'))
      .send({ legalName: `Nouveau nom fictif ${RUN}` })
      .expect(200);
    const { res, text } = await pdf(owner.agent.get(api(`/platform/invoices/${invoice.id}/pdf`)));
    expect(res.status).toBe(200);
    expect(text).toContain(IDENTITY.legalName);
    expect(text).not.toContain('Nouveau nom fictif');
    expect(text).toContain('NIF NIF-FICTIF-1');
    expect(text).toContain(IDENTITY.taxRegime);
    expect(text).not.toContain('PROVISOIRE');
    // Aucune TVA calculée n'est affirmée sur une facture d'abonnement Ocall.
    expect(text).not.toMatch(/TTC|TVA \d/);

    // La facture provisoire reste provisoire.
    const before = await pdf(owner.agent.get(api(`/platform/invoices/${provisionalId}/pdf`)));
    expect(before.text).toContain('FACTURE PROVISOIRE');
  });

  it('espace client : ses factures uniquement, avec l’état définitif', async () => {
    const list = (await client.agent.get(api('/billing/invoices')).expect(200)).body as {
      id: string;
      definitive: boolean;
      receipts: unknown[];
    }[];
    expect(list.find((i) => i.id === definitiveId)).toMatchObject({
      definitive: true,
      receipts: [],
    });
    expect(list.find((i) => i.id === provisionalId)).toMatchObject({ definitive: false });
    const own = await pdf(client.agent.get(api(`/billing/invoices/${definitiveId}/pdf`)));
    expect(own.res.status).toBe(200);
    expect(own.body.subarray(0, 5).toString()).toBe('%PDF-');
    const foreign = await other.agent.get(api(`/billing/invoices/${definitiveId}/pdf`));
    expect(foreign.status).toBe(404);
    // Un client n'accède jamais aux routes de la plateforme.
    await client.agent.get(api(`/platform/invoices/${definitiveId}/pdf`)).expect(403);
  });

  it('reçu : disponible après confirmation seulement, à l’identité de la facture', async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: definitiveId } });
    const declared = (
      await billing.agent
        .post(api('/platform/subscription-payments'))
        .send({
          organizationId: client.organizationId,
          invoiceId: invoice.id,
          currency: 'XOF',
          method: 'MANUAL_TRANSFER',
          amount: invoice.total,
          reference: `VIR-J2-${RUN}`,
          paidAt: today(),
          periodStart: today(),
          periodEnd: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
        })
        .expect(201)
    ).body as { id: string };
    const early = await client.agent.get(api(`/billing/payments/${declared.id}/receipt`));
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('RECEIPT_NOT_AVAILABLE');
    await owner.agent
      .post(api(`/platform/subscription-payments/${declared.id}/confirm`))
      .expect(200);

    const receipt = await pdf(client.agent.get(api(`/billing/payments/${declared.id}/receipt`)));
    expect(receipt.res.status).toBe(200);
    expect(receipt.res.headers['content-type']).toBe('application/pdf');
    expect(receipt.text).toContain('REÇU DE PAIEMENT');
    expect(receipt.text).toContain(IDENTITY.legalName);
    expect(receipt.text).toContain(invoice.number);
    expect(receipt.text).toContain(`VIR-J2-${RUN}`);
    expect(receipt.text).not.toContain('PROVISOIRE');
    await other.agent.get(api(`/billing/payments/${declared.id}/receipt`)).expect(404);
    const platform = await pdf(
      billing.agent.get(api(`/platform/subscription-payments/${declared.id}/receipt`)),
    );
    expect(platform.res.status).toBe(200);
    const list = (await client.agent.get(api('/billing/invoices')).expect(200)).body as {
      id: string;
      status: string;
      receipts: { id: string; amount: number }[];
    }[];
    expect(list.find((i) => i.id === definitiveId)).toMatchObject({
      status: 'PAID',
      receipts: [{ id: declared.id, amount: invoice.total }],
    });
  });
});
