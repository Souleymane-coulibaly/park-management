import { join } from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * Socle des documents PDF de la plateforme (School : bulletins et reçus ; Facture : devis, factures,
 * rapports) : A4, polices Noto embarquées (licence OFL), rendu sans navigateur, en mémoire, jamais stocké.
 * Polices enregistrées sous les noms `sans` et `sansBold` ; une application peut en ajouter (arabe pour
 * School).
 */

export const FONTS_DIR = join(__dirname, '..', '..', '..', 'assets', 'fonts');

export const PDF_PAGE = { width: 595.28, height: 841.89, margin: 40 };
export const PDF_CONTENT_WIDTH = PDF_PAGE.width - 2 * PDF_PAGE.margin;

export interface PdfMeta {
  title: string;
  /** Application émettrice, inscrite dans les métadonnées du fichier. */
  creator: string;
  /** Polices supplémentaires : nom → fichier du dossier des polices. */
  extraFonts?: Record<string, string>;
}

/** Document A4 aux polices enregistrées ; `draw` le remplit, le contenu est rendu en mémoire. */
export function renderPdfDocument(
  meta: PdfMeta,
  draw: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PDF_PAGE.margin,
    autoFirstPage: false,
    info: { Title: meta.title, Creator: meta.creator, Producer: meta.creator },
  });
  doc.registerFont('sans', join(FONTS_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont('sansBold', join(FONTS_DIR, 'NotoSans-Bold.ttf'));
  for (const [name, file] of Object.entries(meta.extraFonts ?? {})) {
    doc.registerFont(name, join(FONTS_DIR, file));
  }
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  draw(doc);
  doc.end();
  return done;
}
