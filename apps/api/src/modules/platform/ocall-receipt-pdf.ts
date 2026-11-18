import { formatXof, numberToFrenchWords } from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import {
  FACTURE_INK,
  FACTURE_MUTED,
  type FactureLetterheadIdentity,
  drawFooter,
  drawLetterhead,
  tint,
} from '../../common/pdf/letterhead';

export interface OcallReceiptDocument {
  number: string;
  client: { name: string; code: string };
  amount: number;
  method: string;
  reference: string | null;
  paidAt: Date;
  confirmedAt: Date | null;
  invoiceNumber: string | null;
  product: string;
  periodStart: Date;
  periodEnd: Date;
  refundedAt: Date | null;
  /** Reçu provisoire : avertissement et filigrane. */
  provisional: { notice: string; watermark: string } | null;
}

const dateFr = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

/**
 * Reçu d'un règlement d'abonnement Ocall confirmé, à la charte des documents Ocall Facture (en-tête,
 * pied de page et couleurs communs) : client, facture réglée, période couverte, montant en chiffres et
 * en lettres. Une page.
 */
export function renderOcallReceiptPdf(
  issuer: FactureLetterheadIdentity,
  accent: string,
  receipt: OcallReceiptDocument,
): Promise<Buffer> {
  const title = `${receipt.provisional ? 'Reçu provisoire' : 'Reçu'} ${receipt.number}`;
  return renderPdfDocument({ title, creator: 'Ocall Suite' }, (doc) => {
    const left = PDF_PAGE.margin;
    doc.addPage();
    let y = drawLetterhead(doc, issuer, [], accent);

    doc.font('sansBold').fontSize(18).fillColor(accent);
    doc.text('REÇU DE PAIEMENT', left, y, { characterSpacing: 0.6 });
    doc.font('sans').fontSize(10).fillColor(FACTURE_MUTED);
    doc.text(`N° ${receipt.number}`, left, doc.y + 1);
    if (receipt.provisional) {
      doc.font('sansBold').fontSize(9).fillColor('#b4472e');
      doc.text(receipt.provisional.notice, left, doc.y + 2, { width: PDF_CONTENT_WIDTH });
    }
    y = doc.y + 14;

    const rows: [string, string][] = [
      ['Reçu de', `${receipt.client.name} (client ${receipt.client.code})`],
      ['Objet', `Abonnement ${receipt.product}`],
      ['Facture réglée', receipt.invoiceNumber ?? '—'],
      ['Période couverte', `du ${dateFr(receipt.periodStart)} au ${dateFr(receipt.periodEnd)}`],
      ['Date du règlement', dateFr(receipt.paidAt)],
      ['Mode de règlement', receipt.method],
      ['Référence', receipt.reference ?? '—'],
      ['Confirmé le', receipt.confirmedAt ? dateFr(receipt.confirmedAt) : '—'],
    ];
    for (const [name, value] of rows) {
      doc.font('sans').fontSize(9).fillColor(FACTURE_MUTED);
      doc.text(name, left, y, { width: 150 });
      doc.font('sansBold').fontSize(9.5).fillColor(FACTURE_INK);
      doc.text(value, left + 150, y, { width: PDF_CONTENT_WIDTH - 150 });
      y = Math.max(doc.y, y + 12) + 6;
    }

    y += 8;
    doc.roundedRect(left, y, PDF_CONTENT_WIDTH, 40, 6).fill(accent);
    doc.font('sansBold').fontSize(9).fillColor('#ffffff');
    doc.text('MONTANT REÇU', left + 14, y + 15, { characterSpacing: 0.8, lineBreak: false });
    doc.font('sansBold').fontSize(15).fillColor('#ffffff');
    doc.text(formatXof(receipt.amount), left, y + 11, {
      width: PDF_CONTENT_WIDTH - 14,
      align: 'right',
      lineBreak: false,
    });
    y += 52;
    const words = `Arrêté le présent reçu à la somme de ${numberToFrenchWords(receipt.amount)} franc${receipt.amount > 1 ? 's' : ''} CFA.`;
    doc.font('sans').fontSize(9);
    const wordsHeight = doc.heightOfString(words, { width: PDF_CONTENT_WIDTH - 24 }) + 16;
    doc.roundedRect(left, y, PDF_CONTENT_WIDTH, wordsHeight, 6).fill(tint(accent, 0.92));
    doc.font('sans').fontSize(9).fillColor(FACTURE_INK);
    doc.text(words, left + 12, y + 8, { width: PDF_CONTENT_WIDTH - 24 });
    y += wordsHeight + 12;

    if (receipt.refundedAt) {
      doc.font('sansBold').fontSize(10).fillColor('#b4472e');
      doc.text(`Règlement remboursé le ${dateFr(receipt.refundedAt)}.`, left, y);
    }

    drawFooter(doc, issuer, [], { index: 1, total: 1 });
    if (receipt.provisional) {
      doc.save();
      doc.rotate(-30, { origin: [PDF_PAGE.width / 2, PDF_PAGE.height / 2] });
      doc.font('sansBold').fontSize(64).fillColor('#b4472e').opacity(0.07);
      doc.text(receipt.provisional.watermark, 0, PDF_PAGE.height / 2 - 36, {
        width: PDF_PAGE.width,
        align: 'center',
        lineBreak: false,
      });
      doc.restore();
    }
  });
}
