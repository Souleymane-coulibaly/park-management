import PDFDocument from 'pdfkit';
import {
  type PaperWidth,
  type ReceiptLine,
  charsPerLine,
  normalizeForPrinter,
} from '@ocall/shared';
import { renderQrPng } from './ocall-stock-label-pdf';

const MM = 72 / 25.4;
const MARGIN = 4 * MM;
const QR_SIZE = 26 * MM;

/**
 * Ticket de caisse en PDF (export, envoi au client) : exactement les lignes du ticket thermique, sur une
 * page de la largeur du rouleau (58 ou 80 mm), en police à chasse fixe pour garder les colonnes alignées.
 */
export async function renderStockReceiptPdf(
  lines: readonly ReceiptLine[],
  paperWidth: PaperWidth,
  title: string,
): Promise<Buffer> {
  const width = paperWidth * MM;
  const chars = charsPerLine(paperWidth);
  // Courier : chaque caractère occupe 0,6 fois la taille de la police.
  const size = (width - 2 * MARGIN) / (chars * 0.6);
  const lineHeight = size * 1.25;
  const qrs = new Map<number, Buffer>();
  for (const [i, l] of lines.entries()) if (l.qr) qrs.set(i, await renderQrPng(l.qr));
  const height =
    2 * MARGIN +
    lines.reduce(
      (h, l) => h + (l.qr ? QR_SIZE + lineHeight : l.large ? 2 * lineHeight : lineHeight),
      0,
    );

  const doc = new PDFDocument({
    size: [width, height],
    margin: MARGIN,
    info: { Title: title, Creator: 'Ocall Stock', Producer: 'Ocall Stock' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let y = MARGIN;
  for (const [i, l] of lines.entries()) {
    const qr = qrs.get(i);
    if (qr) {
      doc.image(qr, (width - QR_SIZE) / 2, y, { width: QR_SIZE, height: QR_SIZE });
      y += QR_SIZE + lineHeight;
      continue;
    }
    const fontSize = l.large ? size * 2 : size;
    doc
      .font(l.bold || l.large ? 'Courier-Bold' : 'Courier')
      .fontSize(fontSize)
      .text(normalizeForPrinter(l.text), MARGIN, y, {
        width: width - 2 * MARGIN,
        align: l.align ?? 'left',
        lineBreak: false,
      });
    y += l.large ? 2 * lineHeight : lineHeight;
  }
  doc.end();
  return done;
}
