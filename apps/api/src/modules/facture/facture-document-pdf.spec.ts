import PDFDocument from 'pdfkit';
import {
  type FactureClientIdentity,
  type FactureEstablishmentIdentity,
  type FacturePdfDocument,
  type FactureSellerIdentity,
  renderFactureDocumentPdf,
} from './facture-document-pdf';
import { NO_FACTURE_LOGOS } from './facture-pdf';

/**
 * Ocall Facture — PDF d'un document, Suite S2 (établissement émetteur facultatif) : l'établissement est
 * imprimé dans les informations du document et en entier sous elles ; sans établissement, le PDF reste celui
 * d'avant (aucune mention). La raison sociale et le NIF imprimés restent ceux de l'organisation.
 */
const seller: FactureSellerIdentity = {
  legalName: 'Quincaillerie du Fleuve SARL',
  tradeName: 'Quincaillerie du Fleuve',
  description: null,
  address: 'Rue 310, ACI 2000',
  city: 'Bamako',
  country: 'ML',
  phone: '+223 70 00 00 00',
  email: null,
  nif: '084123456A',
  rccm: null,
  taxRegime: null,
  bankDetails: null,
  legalFooter: null,
  accentColor: '#1f6f4a',
};

const client: FactureClientIdentity = {
  name: 'BTP Sahel',
  contactName: null,
  email: null,
  phone: null,
  address: null,
  city: 'Bamako',
  country: 'ML',
  nif: null,
  rccm: null,
  rib: null,
  description: null,
};

const kayes: FactureEstablishmentIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Agence Kayes',
  address: 'Rue 12, Plateau',
  city: 'Kayes',
  phone: '+223 21 52 00 00',
};

const document = (establishment: FactureEstablishmentIdentity | null): FacturePdfDocument => ({
  type: 'INVOICE',
  number: 'FAC-2026-00001',
  issueDate: new Date('2026-11-15T00:00:00Z'),
  issuedAt: new Date('2026-11-15T09:30:00Z'),
  validUntil: null,
  dueDate: new Date('2026-12-15T00:00:00Z'),
  paymentTermsDays: 30,
  subject: 'Fourniture',
  clientReference: null,
  salesperson: null,
  establishment,
  notes: null,
  terms: null,
  vatExemptionReason: null,
  sourceNumber: null,
  grossHt: 10_000,
  totalDiscount: 0,
  totalHt: 10_000,
  totalVat: 1_800,
  totalTtc: 11_800,
  vat: [{ rate: 18, base: 10_000, amount: 1_800 }],
  lines: [
    {
      reference: null,
      label: 'Peinture blanche 5 L',
      description: null,
      unit: 'unité',
      quantity: 1,
      unitPrice: 10_000,
      discountPercent: 0,
      vatRate: 18,
      totalHt: 10_000,
    },
  ],
});

/** Textes dessinés dans le PDF (le rendu réel continue). */
async function drawnTexts(doc: FacturePdfDocument) {
  const texts: string[] = [];
  const realText = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
    this: PDFKit.PDFDocument,
    ...args: unknown[]
  ) {
    if (typeof args[0] === 'string') texts.push(args[0]);
    return (realText as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  try {
    const body = await renderFactureDocumentPdf(seller, client, doc, NO_FACTURE_LOGOS);
    return { body, texts };
  } finally {
    spy.mockRestore();
  }
}

describe('Ocall Facture — PDF : établissement émetteur', () => {
  it('imprime l’établissement émetteur, l’identité légale restant celle de l’organisation', async () => {
    const { body, texts } = await drawnTexts(document(kayes));
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(texts).toContain('ÉTABLISSEMENT');
    expect(texts).toContain('Agence Kayes');
    expect(texts).toContain(
      'Établissement émetteur : Agence Kayes — Rue 12, Plateau, Kayes — Tél. +223 21 52 00 00',
    );
    expect(texts.join('\n')).toContain('Quincaillerie du Fleuve');
    expect(texts.join('\n')).toContain('084123456A');
  });

  it('établissement sans adresse ni téléphone : son nom seul', async () => {
    const { texts } = await drawnTexts(
      document({ ...kayes, address: null, city: null, phone: null }),
    );
    expect(texts).toContain('Établissement émetteur : Agence Kayes');
  });

  it('sans établissement : aucune mention (documents existants inchangés)', async () => {
    const { body, texts } = await drawnTexts(document(null));
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(texts.some((t) => /établissement/i.test(t))).toBe(false);
  });
});
