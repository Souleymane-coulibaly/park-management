import { factureLegalMissing } from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';

/**
 * En-tête et pied des documents Ocall Facture (devis, factures, pro forma, bons de commande, rapports) :
 * identité légale du vendeur et mentions imprimées sur chaque document. Le socle F0 rend un aperçu de
 * cet en-tête ; les documents des sprints suivants le réutilisent.
 */

export const FACTURE_INK = '#1d2a33';
export const FACTURE_MUTED = '#5a6670';
export const FACTURE_LINE = '#cfd6dc';

export interface FactureLetterheadIdentity {
  legalName: string;
  tradeName: string | null;
  address: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  taxRegime: string | null;
  bankDetails: string | null;
  legalFooter: string | null;
}

/** Dessine l'en-tête (logo, identité, mentions) ; renvoie l'ordonnée sous l'en-tête. */
export function drawLetterhead(
  doc: PDFKit.PDFDocument,
  identity: FactureLetterheadIdentity,
  logo: Buffer | null,
): number {
  const left = PDF_PAGE.margin;
  let y = PDF_PAGE.margin;
  let textLeft = left;
  if (logo) {
    try {
      doc.image(logo, left, y, { fit: [120, 60] });
      textLeft = left + 135;
    } catch {
      // Logo illisible : en-tête sans logo, jamais d'échec du document.
    }
  }
  const width = PDF_PAGE.width - PDF_PAGE.margin - textLeft;
  doc.font('sansBold').fontSize(14).fillColor(FACTURE_INK);
  doc.text(identity.legalName, textLeft, y, { width });
  y = doc.y + 2;
  doc.font('sans').fontSize(9).fillColor(FACTURE_MUTED);
  const lines = [
    identity.tradeName ? `Nom commercial : ${identity.tradeName}` : null,
    `${identity.address}, ${identity.city}${identity.country === 'ML' ? ' — Mali' : ''}`,
    [identity.phone, identity.email].filter(Boolean).join(' · ') || null,
    identity.nif ? `NIF : ${identity.nif}` : null,
    identity.rccm ? `RCCM : ${identity.rccm}` : null,
    identity.taxRegime ? `Régime d’imposition : ${identity.taxRegime}` : null,
  ].filter((l): l is string => Boolean(l));
  for (const line of lines) {
    doc.text(line, textLeft, y, { width });
    y = doc.y + 1;
  }
  y = Math.max(y, PDF_PAGE.margin + 64) + 10;
  doc
    .moveTo(left, y)
    .lineTo(PDF_PAGE.width - PDF_PAGE.margin, y)
    .strokeColor(FACTURE_LINE)
    .lineWidth(1)
    .stroke();
  return y + 14;
}

/** Pied de page : coordonnées bancaires et mentions complémentaires. */
export function drawFooter(doc: PDFKit.PDFDocument, identity: FactureLetterheadIdentity): void {
  const parts = [identity.bankDetails, identity.legalFooter].filter((p): p is string =>
    Boolean(p?.trim()),
  );
  if (parts.length === 0) return;
  const text = parts.join('\n');
  doc.font('sans').fontSize(8).fillColor(FACTURE_MUTED);
  const height = doc.heightOfString(text, { width: PDF_CONTENT_WIDTH });
  doc.text(text, PDF_PAGE.margin, PDF_PAGE.height - PDF_PAGE.margin - height, {
    width: PDF_CONTENT_WIDTH,
    align: 'center',
    lineBreak: true,
  });
}

/** Aperçu de l'en-tête et du pied, avec la liste des mentions encore manquantes pour facturer. */
export function renderLetterheadPreview(
  identity: FactureLetterheadIdentity,
  logo: Buffer | null,
): Promise<Buffer> {
  return renderPdfDocument({ title: 'Aperçu de l’en-tête', creator: 'Ocall Facture' }, (doc) => {
    doc.addPage();
    let y = drawLetterhead(doc, identity, logo);
    doc.font('sansBold').fontSize(12).fillColor(FACTURE_INK);
    doc.text('Aperçu de l’en-tête de vos documents', PDF_PAGE.margin, y, {
      width: PDF_CONTENT_WIDTH,
    });
    y = doc.y + 8;
    const missing = factureLegalMissing(identity);
    doc.font('sans').fontSize(10).fillColor(FACTURE_MUTED);
    doc.text(
      missing.length === 0
        ? 'Toutes les mentions exigées pour émettre une facture sont renseignées.'
        : `Mentions à compléter avant d’émettre une facture : ${missing.join(', ')}.`,
      PDF_PAGE.margin,
      y,
      { width: PDF_CONTENT_WIDTH },
    );
    drawFooter(doc, identity);
  });
}
