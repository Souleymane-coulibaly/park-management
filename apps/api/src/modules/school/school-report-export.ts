import { Workbook } from 'exceljs';
import type { SchoolReportKind } from '@ocall/shared';
import { CONTENT, LINE, MUTED, PAGE, BAND, Writer, renderPdf } from './school-pdf';
import { type TableExport, toCsv } from './school-spreadsheet';

/**
 * Exports des rapports du Sprint 8. Un rapport devient un document neutre (titre, établissement, période,
 * filtres, sections de tableaux) puis un PDF, un classeur XLSX ou un CSV. Les libellés suivent la langue
 * de l'établissement (arabe pour un établissement en arabe, français sinon) ; les contenus arabes (noms de
 * classe, de matière) sont rendus de droite à gauche par le socle PDF existant.
 */

export type ReportLocale = 'FR' | 'AR';

export interface ReportSection {
  heading: string;
  table: TableExport;
}

export interface ReportDocument {
  title: string;
  schoolName: string;
  period: string;
  filters: string[];
  sections: ReportSection[];
}

const L = {
  FR: {
    overview: 'Tableau de bord de direction',
    pedagogy: 'Rapport pédagogique',
    attendance: 'Rapport d’assiduité',
    finance: 'Rapport financier (frais scolaires)',
    school: 'Établissement',
    report: 'Rapport',
    period: 'Période',
    filters: 'Filtres',
    generated: 'Édité le',
    none: 'Aucun',
  },
  AR: {
    overview: 'لوحة قيادة الإدارة',
    pedagogy: 'التقرير التربوي',
    attendance: 'تقرير المواظبة',
    finance: 'التقرير المالي (الرسوم المدرسية)',
    school: 'المؤسسة',
    report: 'التقرير',
    period: 'الفترة',
    filters: 'المرشحات',
    generated: 'تاريخ الإصدار',
    none: 'لا شيء',
  },
} as const;

export function reportTitle(kind: SchoolReportKind, locale: ReportLocale): string {
  return L[locale][kind];
}

export function reportLabel(key: keyof (typeof L)['FR'], locale: ReportLocale): string {
  return L[locale][key];
}

/** Lignes d'en-tête communes : établissement, rapport, période, filtres. */
function metaRows(doc: ReportDocument, locale: ReportLocale): (string | number)[][] {
  return [
    [L[locale].report, doc.title],
    [L[locale].period, doc.period],
    [L[locale].filters, doc.filters.length ? doc.filters.join(' · ') : L[locale].none],
  ];
}

/** CSV : en-tête du rapport, puis chaque section (titre, colonnes, lignes) séparée d'une ligne vide. */
export function reportCsv(doc: ReportDocument, locale: ReportLocale): Buffer {
  const rows: (string | number)[][] = [...metaRows(doc, locale)];
  for (const s of doc.sections) {
    rows.push([], [s.heading], s.table.headers, ...s.table.rows);
  }
  return toCsv({ headers: [L[locale].school, doc.schoolName], rows });
}

/** XLSX : une feuille « Rapport » (en-tête) puis une feuille par section, colonnes en gras. */
export async function reportXlsx(doc: ReportDocument, locale: ReportLocale): Promise<Buffer> {
  const workbook = new Workbook();
  const cover = workbook.addWorksheet(sheetName(L[locale].report, 0));
  cover.addRow([L[locale].school, doc.schoolName]).font = { bold: true };
  for (const r of metaRows(doc, locale)) cover.addRow(r);
  cover.getColumn(1).width = 18;
  cover.getColumn(2).width = 60;
  doc.sections.forEach((s, i) => {
    const sheet = workbook.addWorksheet(sheetName(s.heading, i + 1));
    if (locale === 'AR') sheet.views = [{ rightToLeft: true }];
    sheet.addRow(s.table.headers).font = { bold: true };
    for (const row of s.table.rows) sheet.addRow(row);
    s.table.headers.forEach((h, c) => {
      sheet.getColumn(c + 1).width = Math.min(40, Math.max(12, h.length + 2));
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Nom de feuille Excel : 31 caractères au plus, sans caractères interdits, unique par position. */
function sheetName(name: string, index: number): string {
  const clean = name.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Feuille';
  return `${index + 1}. ${clean}`.slice(0, 31);
}

/** PDF A4 : en-tête, puis chaque section en tableau à colonnes égales, paginé, en-tête répété. */
export function reportPdf(
  doc: ReportDocument,
  locale: ReportLocale,
  generatedOn: string,
): Promise<Buffer> {
  const align = locale === 'AR' ? 'right' : 'left';
  return renderPdf(doc.title, (pdf) => {
    const w = new Writer(pdf);
    let y = PAGE.margin;
    const newPage = () => {
      pdf.addPage();
      y = PAGE.margin;
    };
    newPage();
    y += w.text(doc.schoolName, PAGE.margin, y, CONTENT, { size: 14, bold: true, align }) + 4;
    y += w.text(doc.title, PAGE.margin, y, CONTENT, { size: 12, bold: true, align }) + 4;
    for (const [label, value] of metaRows(doc, locale).slice(1)) {
      y +=
        w.text(`${label} : ${value}`, PAGE.margin, y, CONTENT, { size: 9, color: MUTED, align }) +
        2;
    }
    y += w.text(`${L[locale].generated} ${generatedOn}`, PAGE.margin, y, CONTENT, {
      size: 8,
      color: MUTED,
      align,
    });
    y += 10;
    const bottom = PAGE.height - PAGE.margin;
    for (const section of doc.sections) {
      const cols = Math.max(1, section.table.headers.length);
      const colWidth = CONTENT / cols;
      const cellHeight = (cells: (string | number)[], bold: boolean) =>
        Math.max(14, ...cells.map((c) => w.height(String(c), colWidth - 6, { size: 8, bold }) + 6));
      const drawRow = (cells: (string | number)[], bold: boolean, shaded: boolean) => {
        const h = cellHeight(cells, bold);
        if (y + h > bottom) {
          newPage();
          drawHeader();
        }
        if (shaded) pdf.rect(PAGE.margin, y, CONTENT, h).fill(BAND);
        const ordered = locale === 'AR' ? [...cells].reverse() : cells;
        ordered.forEach((c, i) => {
          w.text(String(c), PAGE.margin + i * colWidth + 3, y + 3, colWidth - 6, {
            size: 8,
            bold,
            align: typeof c === 'number' ? 'right' : align,
          });
        });
        pdf
          .moveTo(PAGE.margin, y + h)
          .lineTo(PAGE.margin + CONTENT, y + h)
          .strokeColor(LINE)
          .lineWidth(0.5)
          .stroke();
        y += h;
      };
      const drawHeader = () => drawRow(section.table.headers, true, true);
      const headingHeight = w.height(section.heading, CONTENT, { size: 10, bold: true }) + 6;
      if (y + headingHeight + 40 > bottom) newPage();
      y += w.text(section.heading, PAGE.margin, y, CONTENT, { size: 10, bold: true, align }) + 6;
      drawHeader();
      if (section.table.rows.length === 0) drawRow([L[locale].none], false, false);
      for (const row of section.table.rows) drawRow(row, false, false);
      y += 12;
    }
  });
}
