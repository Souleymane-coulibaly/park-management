import { formatFactureMinutes } from '@ocall/shared';
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

/** Contenu du rapport d'intervention imprimé. */
export interface FactureInterventionReport {
  number: string;
  statusLabel: string;
  title: string;
  description: string | null;
  client: { name: string; phone: string | null; address: string | null; city: string | null };
  siteAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  equipment: {
    name: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    location: string | null;
  } | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  technicians: string[];
  time: { date: Date; technician: string; minutes: number; note: string | null }[];
  parts: { reference: string | null; label: string; unit: string; quantity: number }[];
  workSummary: string | null;
  recommendations: string | null;
  photos: { caption: string | null; image: Buffer }[];
  signature: { name: string; at: Date; image: Buffer | null; hash: string } | null;
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
const dateTimeFr = (d: Date) => `${dateFr(d)} à ${timeFr(d)}`;
const quantity = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/**
 * Rapport d'intervention PDF, à la charte des documents Ocall Facture : en-tête, client et lieu,
 * informations (créneau, équipement, techniciens), demande, travaux réalisés, recommandations, temps
 * passé, pièces posées (sans prix : document technique), photos, signature du client et empreinte du
 * rapport signé, pied numéroté. Un rapport non signé porte la mention « non signé ».
 */
export function renderFactureInterventionReport(
  seller: FactureLetterheadIdentity & { accentColor: string },
  report: FactureInterventionReport,
  logos: FactureLogos,
): Promise<Buffer> {
  const title = `Rapport d’intervention ${report.number}`;
  return renderPdfDocument({ title, creator: 'Ocall Facture', bufferPages: true }, (doc) => {
    const left = PDF_PAGE.margin;
    const accent = seller.accentColor;
    const soft = tint(accent, 0.92);
    const bottom = PDF_PAGE.height - PDF_PAGE.margin - footerHeight(doc, seller, logos.footer) - 8;
    const gap = 14;
    const half = (PDF_CONTENT_WIDTH - gap) / 2;
    let y = 0;

    const newPage = () => {
      doc.addPage();
      doc.rect(0, 0, PDF_PAGE.width, 6).fill(accent);
      y = PDF_PAGE.margin;
    };
    const ensure = (height: number) => {
      if (y + height > bottom) newPage();
    };
    const heading = (text: string) => {
      ensure(40);
      doc.font('sansBold').fontSize(7.5).fillColor(accent);
      doc.text(text.toUpperCase(), left, y, { characterSpacing: 1.1 });
      y = doc.y + 4;
    };
    const paragraph = (text: string) => {
      doc.font('sans').fontSize(9);
      const height = doc.heightOfString(text, { width: PDF_CONTENT_WIDTH });
      ensure(Math.min(height, 120) + 6);
      doc.fillColor(FACTURE_INK).text(text, left, y, { width: PDF_CONTENT_WIDTH, lineGap: 1.5 });
      y = doc.y + 12;
    };

    doc.addPage();
    y = drawLetterhead(doc, seller, logos.header, accent);

    // ── Titre ──
    doc.font('sansBold').fontSize(18).fillColor(accent);
    doc.text('RAPPORT D’INTERVENTION', left, y, {
      width: PDF_CONTENT_WIDTH,
      characterSpacing: 0.6,
    });
    y = doc.y + 1;
    doc.font('sansBold').fontSize(12).fillColor(FACTURE_INK);
    doc.text(report.title, left, y, { width: PDF_CONTENT_WIDTH });
    y = doc.y + 2;
    doc.font('sans').fontSize(10).fillColor(FACTURE_MUTED);
    doc.text(`N° ${report.number}  ·  ${report.statusLabel}`, left, y);
    y = doc.y + 10;

    // ── Client et lieu / informations ──
    const pad = 11;
    const inner = half - 2 * pad;
    const clientLines = [
      report.siteAddress ? `Lieu : ${report.siteAddress}` : null,
      report.contactName || report.contactPhone
        ? `Contact : ${[report.contactName, report.contactPhone].filter(Boolean).join(' — ')}`
        : null,
      report.client.phone ? `Tél. ${report.client.phone}` : null,
    ].filter((l): l is string => Boolean(l));
    const equipment = report.equipment
      ? [
          report.equipment.name,
          [report.equipment.brand, report.equipment.model].filter(Boolean).join(' ') || null,
          report.equipment.serialNumber ? `N° de série ${report.equipment.serialNumber}` : null,
          report.equipment.location,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
    const meta: [string, string][] = [
      ['Créneau prévu', `${dateTimeFr(report.scheduledStart)} → ${timeFr(report.scheduledEnd)}`],
      ...(report.startedAt
        ? ([['Début', dateTimeFr(report.startedAt)]] as [string, string][])
        : []),
      ...(report.completedAt
        ? ([['Fin des travaux', dateTimeFr(report.completedAt)]] as [string, string][])
        : []),
      ['Technicien(s)', report.technicians.join(', ') || '—'],
      ...(equipment ? ([['Équipement', equipment]] as [string, string][]) : []),
    ];
    doc.font('sansBold').fontSize(11.5);
    let clientHeight = 14 + doc.heightOfString(report.client.name, { width: inner });
    doc.font('sans').fontSize(8.5);
    if (clientLines.length) {
      clientHeight += doc.heightOfString(clientLines.join('\n'), { width: inner }) + 4;
    }
    const metaHeight = meta.reduce((sum, [, value]) => {
      doc.font('sansBold').fontSize(9);
      return sum + 12 + doc.heightOfString(value, { width: inner });
    }, 0);
    const panelHeight = Math.max(clientHeight, metaHeight) + 2 * pad;
    const top = y;
    doc.roundedRect(left, top, half, panelHeight, 8).fill(soft);
    doc.font('sansBold').fontSize(7.5).fillColor(accent);
    doc.text('CLIENT', left + pad, top + pad, { width: inner, characterSpacing: 1.2 });
    doc.font('sansBold').fontSize(11.5).fillColor(FACTURE_INK);
    doc.text(report.client.name, left + pad, doc.y + 3, { width: inner });
    if (clientLines.length) {
      doc.font('sans').fontSize(8.5).fillColor(FACTURE_MUTED);
      doc.text(clientLines.join('\n'), left + pad, doc.y + 4, { width: inner, lineGap: 1 });
    }
    const metaLeft = left + half + gap;
    doc
      .roundedRect(metaLeft, top, half, panelHeight, 8)
      .lineWidth(0.8)
      .strokeColor(FACTURE_LINE)
      .stroke();
    let my = top + pad;
    for (const [label, value] of meta) {
      doc.font('sans').fontSize(7).fillColor(FACTURE_MUTED);
      doc.text(label.toUpperCase(), metaLeft + pad, my, { characterSpacing: 0.6 });
      doc.font('sansBold').fontSize(9).fillColor(FACTURE_INK);
      doc.text(value, metaLeft + pad, doc.y + 1, { width: inner });
      my = doc.y + 4;
    }
    y = top + panelHeight + 16;

    // ── Demande, travaux, recommandations ──
    if (report.description) {
      heading('Demande');
      paragraph(report.description);
    }
    heading('Travaux réalisés');
    paragraph(report.workSummary ?? 'Travaux non terminés.');
    if (report.recommendations) {
      heading('Recommandations');
      paragraph(report.recommendations);
    }

    // ── Tableaux : temps et pièces ──
    const table = (
      columns: { title: string; width: number; align: 'left' | 'right' }[],
      rows: string[][],
      footer?: string[],
    ) => {
      const row = (cells: string[], bold: boolean, fill?: string) => {
        doc.font(bold ? 'sansBold' : 'sans').fontSize(8.5);
        const height =
          Math.max(
            ...cells.map((c, i) => doc.heightOfString(c, { width: columns[i]!.width - 10 })),
          ) + 10;
        ensure(height);
        if (fill) doc.rect(left, y, PDF_CONTENT_WIDTH, height).fill(fill);
        let x = left;
        cells.forEach((cell, i) => {
          doc
            .font(bold ? 'sansBold' : 'sans')
            .fontSize(8.5)
            .fillColor(FACTURE_INK);
          doc.text(cell, x + 5, y + 5, { width: columns[i]!.width - 10, align: columns[i]!.align });
          x += columns[i]!.width;
        });
        y += height;
      };
      row(
        columns.map((c) => c.title),
        true,
        soft,
      );
      rows.forEach((cells, i) => row(cells, false, i % 2 === 1 ? FACTURE_ZEBRA : undefined));
      if (footer) row(footer, true);
      y += 14;
    };

    if (report.time.length > 0) {
      heading('Temps passé');
      const total = report.time.reduce((sum, t) => sum + t.minutes, 0);
      table(
        [
          { title: 'Date', width: 72, align: 'left' },
          { title: 'Technicien', width: 150, align: 'left' },
          { title: 'Note', width: PDF_CONTENT_WIDTH - 292, align: 'left' },
          { title: 'Durée', width: 70, align: 'right' },
        ],
        report.time.map((t) => [
          dateFr(t.date),
          t.technician,
          t.note ?? '',
          formatFactureMinutes(t.minutes),
        ]),
        ['', '', 'Total', formatFactureMinutes(total)],
      );
    }
    if (report.parts.length > 0) {
      heading('Pièces et fournitures');
      table(
        [
          { title: 'Réf.', width: 80, align: 'left' },
          { title: 'Désignation', width: PDF_CONTENT_WIDTH - 230, align: 'left' },
          { title: 'Qté', width: 80, align: 'right' },
          { title: 'Unité', width: 70, align: 'left' },
        ],
        report.parts.map((p) => [p.reference ?? '', p.label, quantity(p.quantity), p.unit]),
      );
    }

    // ── Photos : deux par ligne ──
    if (report.photos.length > 0) {
      heading('Photos');
      const cell = half;
      const height = 150;
      for (let i = 0; i < report.photos.length; i += 2) {
        ensure(height + 18);
        report.photos.slice(i, i + 2).forEach((photo, j) => {
          const x = left + j * (cell + gap);
          drawImage(doc, photo.image, x, y, [cell, height]);
          if (photo.caption) {
            doc.font('sans').fontSize(7.5).fillColor(FACTURE_MUTED);
            doc.text(photo.caption, x, y + height + 3, { width: cell, align: 'center' });
          }
        });
        y += height + 20;
      }
    }

    // ── Signature du client ──
    ensure(120);
    doc.roundedRect(left, y, PDF_CONTENT_WIDTH, 104, 6).lineWidth(0.8).dash(3, { space: 3 });
    doc.strokeColor(FACTURE_LINE).stroke().undash();
    doc.font('sansBold').fontSize(7.5).fillColor(accent);
    doc.text('SIGNATURE DU CLIENT', left + 12, y + 10, { characterSpacing: 1 });
    if (report.signature) {
      const s = report.signature;
      doc.font('sans').fontSize(8.5).fillColor(FACTURE_INK);
      doc.text(`Signé par ${s.name}, le ${dateTimeFr(s.at)} (heure du Mali).`, left + 12, y + 24, {
        width: half,
      });
      doc.font('sans').fontSize(6.5).fillColor(FACTURE_MUTED);
      doc.text(`Empreinte SHA-256 du rapport signé :\n${s.hash}`, left + 12, y + 60, {
        width: half,
      });
      if (s.image) drawImage(doc, s.image, left + half + gap, y + 8, [half - 12, 88]);
    } else {
      doc.font('sansBold').fontSize(9).fillColor('#b4472e');
      doc.text('RAPPORT NON SIGNÉ', left + 12, y + 26, { characterSpacing: 0.5 });
    }
    y += 104 + 12;

    // ── Pied de chaque page ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, seller, logos.footer, { index: i + 1, total: range.count });
    }
  });
}
