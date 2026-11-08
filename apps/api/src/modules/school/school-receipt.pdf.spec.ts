import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SchoolLocale } from '@ocall/shared';
import PDFDocument from 'pdfkit';
import { PAGE } from './school-pdf';
import { type ReceiptView, renderReceipt } from './school-receipt.pdf';

/** Données fictives uniquement. */
function view(locale: SchoolLocale, patch: Partial<ReceiptView> = {}): ReceiptView {
  return {
    locale,
    school: {
      name: 'École Les Palmiers',
      nameAr: 'مدرسة النخيل',
      address: '12 rue des Écoles, Dakar',
      phone: '+221 33 000 00 00',
      email: null,
    },
    receiptNumber: 'REC-2026-000042',
    paidAt: '2026-11-04T09:30:00.000Z',
    timezone: 'Africa/Dakar',
    student: {
      matricule: 'PAL-2026-000123',
      lastName: 'Diallo',
      firstName: 'Awa',
      lastNameAr: 'ديالو',
      firstNameAr: 'عوا',
    },
    classLabel: 'CM1 A',
    yearLabel: '2026-2027',
    lines: [
      { label: 'Scolarité (1/9)', labelAr: 'رسوم الدراسة', category: 'TUITION', amount: 15_000 },
      { label: 'Cantine (1/9)', labelAr: null, category: 'CANTEEN', amount: 5_000 },
    ],
    amount: 20_000,
    currency: 'XOF',
    method: 'CASH',
    reference: null,
    verification: 'NOT_APPLICABLE',
    balanceAfter: 115_000,
    cancelled: null,
    ...patch,
  };
}

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('Ocall School — reçu de paiement PDF', () => {
  it.each(['FR', 'AR', 'BILINGUAL'] as const)('reçu valide en %s', async (locale) => {
    const pdf = await renderReceipt(view(locale));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
    const raw = pdf.toString('latin1');
    if (locale === 'FR') expect(raw).not.toMatch(/NotoNaskhArabic/);
    else expect(raw).toMatch(/NotoNaskhArabic/);
    if (process.env.SCHOOL_PDF_OUT) {
      writeFileSync(join(process.env.SCHOOL_PDF_OUT, `recu-${locale}.pdf`), pdf);
    }
  });

  it('mobile money déclaré, référence et annulation : une page, sans champ arabe exigé', async () => {
    const pdf = await renderReceipt(
      view('AR', {
        method: 'MOBILE_MONEY',
        verification: 'DECLARED_UNVERIFIED',
        reference: 'MM-2026-11-0042',
        cancelled: { at: '2026-11-05T10:00:00.000Z' },
        school: { name: 'École sans arabe', nameAr: null, address: null, phone: null, email: null },
        student: { ...view('AR').student, lastNameAr: null, firstNameAr: null },
        balanceAfter: null,
      }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
    if (process.env.SCHOOL_PDF_OUT) {
      writeFileSync(join(process.env.SCHOOL_PDF_OUT, 'recu-annule.pdf'), pdf);
    }
  });

  type Drawn = { page: true } | { text: string; y: number };

  /** Rend un reçu en journalisant, dans l'ordre, les pages créées et les textes dessinés (y). */
  async function traced(v: ReceiptView): Promise<{ pdf: Buffer; events: Drawn[] }> {
    const events: Drawn[] = [];
    const realAddPage = PDFDocument.prototype.addPage;
    const realText = PDFDocument.prototype.text;
    const pageSpy = jest.spyOn(PDFDocument.prototype, 'addPage').mockImplementation(function (
      this: PDFKit.PDFDocument,
      ...args
    ) {
      events.push({ page: true });
      return realAddPage.apply(this, args);
    });
    const textSpy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
      this: PDFKit.PDFDocument,
      ...args: unknown[]
    ) {
      if (typeof args[0] === 'string' && typeof args[2] === 'number') {
        events.push({ text: args[0], y: args[2] });
      }
      return (realText as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
    });
    try {
      return { pdf: await renderReceipt(v), events };
    } finally {
      pageSpy.mockRestore();
      textSpy.mockRestore();
    }
  }

  const texts = (events: Drawn[]) =>
    events.filter((e): e is { text: string; y: number } => 'text' in e);

  it.each(['FR', 'BILINGUAL'] as const)(
    'reçu de 60 échéances en %s : paginé, rien hors page, total et mentions sur la dernière page',
    async (locale) => {
      const lines = Array.from({ length: 60 }, (_, i) => ({
        label: `Scolarité (${i + 1}/60)`,
        labelAr: 'رسوم الدراسة',
        category: 'TUITION',
        amount: 1_000,
      }));
      const { pdf, events } = await traced(
        view(locale, {
          lines,
          amount: 60_000,
          method: 'MOBILE_MONEY',
          verification: 'DECLARED_UNVERIFIED',
          reference: 'MM-2026-11-0099',
          cancelled: { at: '2026-11-05T10:00:00.000Z' },
        }),
      );
      const count = pages(pdf);
      expect(count).toBeGreaterThan(1);
      expect(events.filter((e) => 'page' in e)).toHaveLength(count);
      const drawn = texts(events);
      // Aucun texte sous la marge basse (sauts automatiques de pdfkit exclus).
      for (const t of drawn) expect(t.y).toBeLessThan(PAGE.height - PAGE.margin);
      // Numéro du reçu rappelé sur chaque page de suite.
      expect(drawn.filter((t) => t.text.includes('(suite)'))).toHaveLength(count - 1);
      // Les 60 lignes, le total et les deux mentions sont dessinés, ces derniers après le dernier saut.
      const lastPage = events.map((e) => 'page' in e).lastIndexOf(true);
      const after = (needle: string) =>
        events.findIndex((e) => 'text' in e && e.text.includes(needle)) > lastPage;
      expect(drawn.filter((t) => /^Scolarité \(\d+\/60\)$/.test(t.text))).toHaveLength(60);
      expect(after('Montant payé')).toBe(true);
      expect(after('non vérifié')).toBe(true);
      expect(after('Encaissement annulé le')).toBe(true);
      if (process.env.SCHOOL_PDF_OUT) {
        writeFileSync(join(process.env.SCHOOL_PDF_OUT, `recu-long-${locale}.pdf`), pdf);
      }
    },
  );

  it('textes à retours à la ligne multiples : aplatis, aucun bloc hors page', async () => {
    // Libellé de 119 caractères dont 59 retours à la ligne, accepté par la validation.
    const tall = Array.from({ length: 60 }, () => 'A').join('\n');
    const { pdf, events } = await traced(
      view('BILINGUAL', {
        school: {
          name: 'École\nLes\nPalmiers',
          nameAr: 'مدرسة\nالنخيل',
          address: '12 rue\n\ndes Écoles',
          phone: null,
          email: null,
        },
        lines: Array.from({ length: 12 }, () => ({
          label: tall,
          labelAr: tall,
          category: 'TUITION',
          amount: 1_000,
        })),
        amount: 12_000,
        reference: 'REF\n0001',
      }),
    );
    const drawn = texts(events);
    expect(drawn.some((t) => /[\r\n]/.test(t.text))).toBe(false);
    for (const t of drawn) expect(t.y).toBeLessThan(PAGE.height - PAGE.margin);
    expect(events.filter((e) => 'page' in e)).toHaveLength(pages(pdf));
    expect(drawn.some((t) => t.text === 'École Les Palmiers')).toBe(true);
  });
});
