import {
  FACTURE_DOCUMENT_TYPE_LABELS,
  type FactureDocumentType,
  type FactureVatBucket,
  factureAmountInWords,
  formatVatRate,
  formatXof,
} from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import {
  FACTURE_INK,
  FACTURE_LINE,
  FACTURE_MUTED,
  FACTURE_ZEBRA,
  type FactureLetterheadIdentity,
  type FactureLogos,
  drawFooter,
  drawImage,
  drawLetterhead,
  footerHeight,
  tint,
} from './facture-pdf';

/** Identité du client imprimée (copiée à l'émission, ou lue en direct sur un brouillon). */
export interface FactureClientIdentity {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  nif: string | null;
  rccm: string | null;
  rib: string | null;
  description: string | null;
}

export interface FactureSellerIdentity extends FactureLetterheadIdentity {
  accentColor: string;
}

export interface FacturePdfLine {
  reference: string | null;
  label: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatRate: number;
  totalHt: number;
}

export interface FacturePdfDocument {
  type: FactureDocumentType;
  /** Numéro définitif ; null pour un brouillon (aperçu sans valeur). */
  number: string | null;
  issueDate: Date | null;
  /** Heure d'émission (affichée à l'heure du Mali, UTC). */
  issuedAt: Date | null;
  validUntil: Date | null;
  /** Facture émise : échéance (date d'émission + délai de paiement). */
  dueDate: Date | null;
  /** Facture : délai de paiement en jours (imprimé sur le brouillon, avant l'échéance). */
  paymentTermsDays: number | null;
  subject: string | null;
  clientReference: string | null;
  /** Vendeur : membre qui a émis (ou créé) le document, nom et identifiant de connexion. */
  salesperson: { name: string; loginId: string } | null;
  notes: string | null;
  terms: string | null;
  vatExemptionReason: string | null;
  /** Document d'origine (conversion) ou, pour un avoir, facture corrigée. */
  sourceNumber: string | null;
  grossHt: number;
  totalDiscount: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  vat: FactureVatBucket[];
  lines: FacturePdfLine[];
}

const dateFr = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
const timeFr = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const amount = (n: number) => formatXof(n).replace(' FCFA', '');
const quantity = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Colonnes du tableau des lignes. */
const COLUMNS = [
  { key: 'ref', title: 'Réf.', width: 56, align: 'left' as const },
  { key: 'label', title: 'Désignation', width: 151, align: 'left' as const },
  { key: 'qty', title: 'Qté', width: 56, align: 'right' as const },
  { key: 'price', title: 'P.U. HT', width: 66, align: 'right' as const },
  { key: 'discount', title: 'Rem.', width: 36, align: 'right' as const },
  { key: 'vat', title: 'TVA', width: 40, align: 'right' as const },
  { key: 'total', title: 'Montant HT', width: PDF_CONTENT_WIDTH - 405, align: 'right' as const },
];

/**
 * PDF d'un document commercial Ocall Facture, à la charte de l'entreprise (couleur, logos, cachet) :
 * en-tête, bloc client « Doit », informations du document, lignes, totaux (sous-total, remise, TVA par
 * taux, net à payer), montant arrêté en toutes lettres, cases de signature, conditions, pied de page
 * numéroté. Un brouillon porte un filigrane et aucun numéro.
 */
export function renderFactureDocumentPdf(
  seller: FactureSellerIdentity,
  client: FactureClientIdentity,
  document: FacturePdfDocument,
  logos: FactureLogos,
): Promise<Buffer> {
  const label = FACTURE_DOCUMENT_TYPE_LABELS[document.type];
  const title = document.number ? `${label} ${document.number}` : `${label} — brouillon`;
  return renderPdfDocument({ title, creator: 'Ocall Facture', bufferPages: true }, (doc) => {
    const left = PDF_PAGE.margin;
    const right = PDF_PAGE.width - PDF_PAGE.margin;
    const accent = seller.accentColor;
    const soft = tint(accent, 0.92);
    const bottom = PDF_PAGE.height - PDF_PAGE.margin - footerHeight(doc, seller, logos.footer) - 8;
    let y = 0;

    const newPage = () => {
      doc.addPage();
      doc.rect(0, 0, PDF_PAGE.width, 6).fill(accent);
      y = PDF_PAGE.margin;
    };
    /** Saute à la page suivante si `height` ne tient plus avant le pied. */
    const ensure = (height: number) => {
      if (y + height > bottom) newPage();
    };

    doc.addPage();
    y = drawLetterhead(doc, seller, logos.header, accent);

    // ── Titre et numéro ──
    doc.font('sansBold').fontSize(18).fillColor(accent);
    doc.text(label.toUpperCase(), left, y, { width: PDF_CONTENT_WIDTH, characterSpacing: 0.6 });
    y = doc.y + 1;
    if (document.subject) {
      doc.font('sansBold').fontSize(12).fillColor(FACTURE_INK);
      doc.text(document.subject, left, y, { width: PDF_CONTENT_WIDTH });
      y = doc.y + 2;
    }
    if (document.number) {
      doc.font('sans').fontSize(10).fillColor(FACTURE_MUTED);
      doc.text(`N° ${document.number}`, left, y);
    } else {
      doc.font('sansBold').fontSize(9).fillColor('#b4472e');
      doc.text('BROUILLON — SANS VALEUR', left, y, { characterSpacing: 0.5 });
    }
    y = doc.y + 10;

    // ── Bloc client « Doit » et informations du document ──
    const gap = 14;
    const half = (PDF_CONTENT_WIDTH - gap) / 2;
    const panelTop = y;
    const pad = 11;
    // Client : hauteur mesurée avant le fond.
    const clientLines = [
      client.contactName ? `À l’attention de ${client.contactName}` : null,
      [client.address, client.city].filter(Boolean).join(', ') || null,
      [client.phone ? `Tél. ${client.phone}` : null, client.email].filter(Boolean).join('  ·  ') ||
        null,
      [client.nif ? `NIF ${client.nif}` : null, client.rccm ? `RCCM ${client.rccm}` : null]
        .filter(Boolean)
        .join('  ·  ') || null,
      client.rib ? `RIB ${client.rib}` : null,
    ].filter((l): l is string => Boolean(l));
    const inner = half - 2 * pad;
    doc.font('sansBold').fontSize(11.5);
    let clientHeight = 14 + doc.heightOfString(client.name, { width: inner });
    if (client.description) {
      doc.font('sans').fontSize(8.5);
      clientHeight += doc.heightOfString(client.description, { width: inner }) + 1;
    }
    doc.font('sans').fontSize(8.5);
    if (clientLines.length) {
      clientHeight += doc.heightOfString(clientLines.join('\n'), { width: inner }) + 4;
    }
    const meta: [string, string][] = [
      [
        'Date et heure',
        document.issuedAt
          ? `${dateFr(document.issuedAt)} à ${timeFr(document.issuedAt)}`
          : document.issueDate
            ? dateFr(document.issueDate)
            : '—',
      ],
      ...(document.validUntil
        ? ([['Valable jusqu’au', dateFr(document.validUntil)]] as [string, string][])
        : []),
      ...(document.dueDate
        ? ([['Échéance', dateFr(document.dueDate)]] as [string, string][])
        : document.paymentTermsDays !== null && document.type === 'INVOICE'
          ? ([
              [
                'Paiement',
                document.paymentTermsDays === 0
                  ? 'À réception'
                  : `À ${document.paymentTermsDays} jours`,
              ],
            ] as [string, string][])
          : []),
      ...(document.clientReference
        ? ([['Votre référence', document.clientReference]] as [string, string][])
        : []),
      ...(document.salesperson
        ? ([['Vendeur', `${document.salesperson.name} (${document.salesperson.loginId})`]] as [
            string,
            string,
          ][])
        : []),
      ...(document.sourceNumber
        ? ([
            [
              document.type === 'CREDIT_NOTE' ? 'Facture corrigée' : 'Document d’origine',
              document.sourceNumber,
            ],
          ] as [string, string][])
        : []),
    ];
    const metaRows = Math.ceil(meta.length / 2);
    const metaHeight = metaRows * 27;
    const panelHeight = Math.max(clientHeight, metaHeight) + 2 * pad;

    doc.roundedRect(left, panelTop, half, panelHeight, 8).fill(soft);
    doc.font('sansBold').fontSize(7.5).fillColor(accent);
    // Un avoir est en faveur du client ; les autres documents lui sont adressés comme débiteur.
    doc.text(
      document.type === 'CREDIT_NOTE' ? 'EN FAVEUR DE' : 'DOIT',
      left + pad,
      panelTop + pad,
      {
        width: inner,
        characterSpacing: 1.2,
      },
    );
    doc.font('sansBold').fontSize(11.5).fillColor(FACTURE_INK);
    doc.text(client.name, left + pad, doc.y + 3, { width: inner });
    if (client.description) {
      doc.font('sans').fontSize(8.5).fillColor(accent);
      doc.text(client.description, left + pad, doc.y + 1, { width: inner });
    }
    if (clientLines.length) {
      doc.font('sans').fontSize(8.5).fillColor(FACTURE_MUTED);
      doc.text(clientLines.join('\n'), left + pad, doc.y + 4, { width: inner, lineGap: 1 });
    }

    const metaLeft = left + half + gap;
    doc
      .roundedRect(metaLeft, panelTop, half, panelHeight, 8)
      .lineWidth(0.8)
      .strokeColor(FACTURE_LINE)
      .stroke();
    const cell = (half - 2 * pad) / 2;
    meta.forEach(([name, value], i) => {
      const cx = metaLeft + pad + (i % 2) * cell;
      const cy = panelTop + pad + Math.floor(i / 2) * 27;
      doc.font('sans').fontSize(7).fillColor(FACTURE_MUTED);
      doc.text(name.toUpperCase(), cx, cy, { width: cell - 6, characterSpacing: 0.6 });
      doc.font('sansBold').fontSize(9.5).fillColor(FACTURE_INK);
      doc.text(value, cx, cy + 10, { width: cell - 6, lineBreak: false, ellipsis: true });
    });
    y = panelTop + panelHeight + 12;

    // ── Lignes ──
    const header = () => {
      doc.roundedRect(left, y, PDF_CONTENT_WIDTH, 22, 5).fill(accent);
      let x = left;
      doc.font('sansBold').fontSize(7.5).fillColor('#ffffff');
      for (const c of COLUMNS) {
        doc.text(c.title.toUpperCase(), x + 6, y + 7.5, {
          width: c.width - 12,
          align: c.align,
          lineBreak: false,
          characterSpacing: 0.4,
        });
        x += c.width;
      }
      y += 26;
    };
    header();
    const labelWidth = COLUMNS[1]!.width - 12;
    document.lines.forEach((line, index) => {
      doc.font('sansBold').fontSize(9);
      let height = doc.heightOfString(line.label, { width: labelWidth });
      if (line.description) {
        doc.font('sans').fontSize(7.5);
        height += doc.heightOfString(line.description, { width: labelWidth }) + 1;
      }
      height = Math.max(height, 11) + 8;
      if (y + height > bottom) {
        newPage();
        header();
      }
      if (index % 2 === 1) doc.rect(left, y - 2, PDF_CONTENT_WIDTH, height).fill(FACTURE_ZEBRA);
      const cells: Record<string, string> = {
        ref: line.reference ?? '',
        qty: `${quantity(line.quantity)} ${line.unit}`,
        price: amount(line.unitPrice),
        discount: line.discountPercent ? `${line.discountPercent} %` : '—',
        vat: `${line.vatRate} %`,
        total: amount(line.totalHt),
      };
      let x = left;
      for (const c of COLUMNS) {
        if (c.key === 'label') {
          doc.font('sansBold').fontSize(9).fillColor(FACTURE_INK);
          doc.text(line.label, x + 6, y + 3, { width: labelWidth });
          if (line.description) {
            doc.font('sans').fontSize(7.5).fillColor(FACTURE_MUTED);
            doc.text(line.description, x + 6, doc.y + 1, { width: labelWidth });
          }
        } else {
          const strong = c.key === 'total' || c.key === 'ref';
          doc
            .font(strong ? 'sansBold' : 'sans')
            .fontSize(c.key === 'ref' || c.key === 'qty' ? 8 : 9)
            .fillColor(c.key === 'ref' ? accent : FACTURE_INK);
          doc.text(cells[c.key]!, x + 6, y + 3, {
            width: c.width - 12,
            align: c.align,
            lineBreak: c.key === 'ref' || c.key === 'qty',
          });
        }
        x += c.width;
      }
      y += height;
    });
    doc.moveTo(left, y).lineTo(right, y).strokeColor(FACTURE_LINE).lineWidth(0.8).stroke();
    y += 16;

    // ── Totaux (à droite) et montant en lettres (à gauche) ──
    const rows: [string, string][] = [
      ['Sous-total HT', amount(document.grossHt)],
      ...(document.totalDiscount > 0
        ? ([
            ['Remise', `− ${amount(document.totalDiscount)}`],
            ['Total HT', amount(document.totalHt)],
          ] as [string, string][])
        : []),
      ...document.vat.map((b): [string, string] => [
        b.rate === 0 ? `TVA ${formatVatRate(0)}` : `TVA ${b.rate} % (base ${amount(b.base)})`,
        amount(b.amount),
      ]),
    ];
    const totalsWidth = 228;
    const totalsLeft = right - totalsWidth;
    const totalsHeight = rows.length * 17 + 40;
    const words = factureAmountInWords(document.type, document.totalTtc);
    const wordsWidth = totalsLeft - left - 18;
    doc.font('sans').fontSize(9);
    const wordsHeight = doc.heightOfString(words, { width: wordsWidth - 24 }) + 34;
    ensure(Math.max(totalsHeight, wordsHeight));
    const blockTop = y;
    for (const [name, value] of rows) {
      doc.font('sans').fontSize(9).fillColor(FACTURE_MUTED);
      doc.text(name, totalsLeft, y, { width: totalsWidth * 0.62, lineBreak: false });
      doc.font('sans').fontSize(9).fillColor(FACTURE_INK);
      doc.text(value, totalsLeft, y, { width: totalsWidth, align: 'right', lineBreak: false });
      y += 17;
    }
    y += 4;
    doc.roundedRect(totalsLeft, y, totalsWidth, 32, 6).fill(accent);
    doc.font('sansBold').fontSize(8).fillColor('#ffffff');
    doc.text(
      document.type === 'CREDIT_NOTE' ? 'TOTAL DE L’AVOIR' : 'NET À PAYER',
      totalsLeft + 12,
      y + 11.5,
      { characterSpacing: 0.8, lineBreak: false },
    );
    doc.font('sansBold').fontSize(13).fillColor('#ffffff');
    doc.text(formatXof(document.totalTtc), totalsLeft, y + 9, {
      width: totalsWidth - 12,
      align: 'right',
      lineBreak: false,
    });
    y += 32;

    doc.roundedRect(left, blockTop, wordsWidth, wordsHeight, 6).fill(soft);
    doc.font('sansBold').fontSize(7).fillColor(accent);
    doc.text('MONTANT EN LETTRES', left + 12, blockTop + 10, { characterSpacing: 1 });
    doc.font('sans').fontSize(9).fillColor(FACTURE_INK);
    doc.text(words, left + 12, blockTop + 22, { width: wordsWidth - 24 });

    // ── Exonération, conditions, notes : sous le montant en lettres si la place le permet ──
    const paragraphs: [string, string][] = [];
    if (document.vat.some((b) => b.rate === 0)) {
      paragraphs.push(['Exonération de TVA', document.vatExemptionReason ?? 'Motif à préciser.']);
    }
    if (document.terms) paragraphs.push(['Conditions', document.terms]);
    if (document.notes) paragraphs.push(['Notes', document.notes]);
    const measure = (width: number) =>
      paragraphs.reduce((sum, [, text]) => {
        doc.font('sans').fontSize(8);
        return sum + doc.heightOfString(text, { width }) + 22;
      }, 0);
    const inColumn = blockTop + wordsHeight + 12 + measure(wordsWidth) <= bottom - 80;
    const paraWidth = inColumn ? wordsWidth : PDF_CONTENT_WIDTH;
    let py = inColumn ? blockTop + wordsHeight + 14 : Math.max(y, blockTop + wordsHeight) + 16;
    let floor = Math.max(y, blockTop + wordsHeight);
    for (const [heading, text] of paragraphs) {
      doc.font('sans').fontSize(8);
      const needed = doc.heightOfString(text, { width: paraWidth }) + 22;
      if (!inColumn && py + needed > bottom) {
        newPage();
        py = y;
        floor = y;
      }
      doc.font('sansBold').fontSize(7).fillColor(accent);
      doc.text(heading.toUpperCase(), left, py, { characterSpacing: 1 });
      doc.font('sans').fontSize(8).fillColor(FACTURE_MUTED);
      doc.text(text, left, doc.y + 3, { width: paraWidth });
      py = doc.y + 10;
    }
    y = Math.max(floor, py) + 14;

    // ── Signatures ──
    ensure(74);
    const boxWidth = (PDF_CONTENT_WIDTH - gap) / 2;
    const boxes: [number, string, string][] = [
      [left, 'BON POUR ACCORD', 'Date, signature et cachet du client'],
      [left + boxWidth + gap, 'LE FOURNISSEUR', seller.legalName],
    ];
    for (const [bx, heading, hint] of boxes) {
      doc.roundedRect(bx, y, boxWidth, 68, 6).lineWidth(0.8).dash(3, { space: 3 });
      doc.strokeColor(FACTURE_LINE).stroke().undash();
      doc.font('sansBold').fontSize(7.5).fillColor(accent);
      doc.text(heading, bx + 12, y + 10, { characterSpacing: 1 });
      doc.font('sans').fontSize(7.5).fillColor(FACTURE_MUTED);
      doc.text(hint, bx + 12, y + 22, { width: boxWidth - 24 });
    }
    if (logos.stamp) {
      drawImage(doc, logos.stamp, left + boxWidth + gap + boxWidth / 2 - 30, y + 4, [110, 60]);
    }
    y += 68 + 12;

    // ── Pied de chaque page, filigrane des brouillons ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, seller, logos.footer, { index: i + 1, total: range.count });
      if (!document.number) {
        doc.save();
        doc.rotate(-30, { origin: [PDF_PAGE.width / 2, PDF_PAGE.height / 2] });
        doc.font('sansBold').fontSize(64).fillColor('#b4472e').opacity(0.07);
        doc.text('BROUILLON', 0, PDF_PAGE.height / 2 - 36, {
          width: PDF_PAGE.width,
          align: 'center',
          lineBreak: false,
        });
        doc.restore();
      }
    }
  });
}
