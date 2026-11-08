import PDFDocument from 'pdfkit';
import { renderPdf, Writer } from './school-pdf';

describe('Ocall School — moteur PDF : texte arabe dans sa colonne', () => {
  it('aucun morceau dessiné ne dépasse la largeur, ponctuation et mots longs compris', async () => {
    const texts = [
      'المرجع ABC-2026-0042. تم الدفع',
      'رقم (15) و (16). ملاحظة: REF-0001, REF-0002.',
      `ع${'W'.repeat(79)}`,
      'مدرسة النخيل — 12 rue des Écoles, Dakar.',
    ];
    const overflow: string[] = [];
    await renderPdf('Essai', (doc) => {
      doc.addPage({ size: 'A4', margin: 40 });
      const w = new Writer(doc);
      const realText = PDFDocument.prototype.text;
      let column = { left: 0, right: 0 };
      const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        const [text, x] = args as [string, number];
        const right = x + this.widthOfString(text);
        if (x < column.left - 0.01 || right > column.right + 0.01) {
          overflow.push(
            `${text} [${x.toFixed(1)} → ${right.toFixed(1)}] hors ${column.left}–${column.right}`,
          );
        }
        return (realText as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
      });
      try {
        for (const width of [60, 90, 120, 160, 220]) {
          for (const text of texts) {
            column = { left: 100, right: 100 + width };
            w.text(text, 100, 100, width, { size: 9 });
          }
        }
      } finally {
        spy.mockRestore();
      }
    });
    expect(overflow).toEqual([]);
  });
});
