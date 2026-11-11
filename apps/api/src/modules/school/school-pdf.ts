import type { SchoolLocale } from '@ocall/shared';
import { PDF_CONTENT_WIDTH, PDF_PAGE, renderPdfDocument } from '../../common/pdf/pdf-document';
import {
  detachPunctuation,
  hasArabic,
  visualOrderRtl,
  visualRuns,
  words,
  wrapWords,
} from './school-rtl-text';

/**
 * Documents PDF d'Ocall School (bulletins au Sprint 4, reçus au Sprint 5), sur le socle PDF commun
 * (`common/pdf`) : polices embarquées (Noto Sans, plus Noto Naskh Arabic pour School, licence OFL), mise
 * en page A4, texte arabe de droite à gauche, libellés et contenus selon la langue de l'établissement.
 * Rendu sans navigateur, en mémoire, jamais stocké.
 */

export const PAGE = PDF_PAGE;
export const CONTENT = PDF_CONTENT_WIDTH;
export const INK = '#1f2a24';
export const MUTED = '#5b665f';
export const LINE = '#c9d1cb';
export const BAND = '#eef3ef';

export type Align = 'left' | 'right' | 'center';
export interface TextOptions {
  size?: number;
  bold?: boolean;
  align?: Align;
  color?: string;
  /** Garde l'alignement demandé même pour une ligne arabe (bloc d'identité). */
  keepAlign?: boolean;
}

/** Document A4 aux polices enregistrées (dont l'arabe) ; `draw` le remplit, rendu en mémoire. */
export function renderPdf(title: string, draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return renderPdfDocument(
    {
      title,
      creator: 'Ocall School',
      extraFonts: { naskh: 'NotoNaskhArabic-Regular.ttf', naskhBold: 'NotoNaskhArabic-Bold.ttf' },
    },
    draw,
  );
}

/** Texte positionné ; l'arabe passe par la mise en ordre droite-à-gauche, le reste par pdfkit. */
export class Writer {
  constructor(private readonly doc: PDFKit.PDFDocument) {}

  /** Hauteur occupée par un texte dans une largeur, sans le dessiner. */
  height(text: string, width: number, opts: TextOptions = {}): number {
    return this.write(text, 0, 0, width, opts, false);
  }

  text(text: string, x: number, y: number, width: number, opts: TextOptions = {}): number {
    return this.write(text, x, y, width, opts, true);
  }

  private write(
    text: string,
    x: number,
    y: number,
    width: number,
    opts: TextOptions,
    draw: boolean,
  ): number {
    const size = opts.size ?? 9;
    if (!text) return 0;
    if (!hasArabic(text)) {
      this.doc.font(opts.bold ? 'sansBold' : 'sans').fontSize(size);
      const h = this.doc.heightOfString(text, { width, lineGap: 1 });
      if (draw) {
        this.doc
          .fillColor(opts.color ?? INK)
          .text(text, x, y, { width, align: opts.align ?? 'left', lineGap: 1 });
      }
      return h;
    }
    const lineHeight = size * 1.75;
    const space = this.measureRun({ kind: 'neutral', text: ' ' }, size, opts.bold);
    const lines = wrapWords(words(text), (w) => this.measureWord(w, size, opts.bold), space, width);
    if (draw) {
      lines.forEach((line, index) => {
        const placed = visualOrderRtl(line);
        const pieces = placed.map((p) => visualRuns(p.word, p.rtl));
        const total =
          pieces.reduce(
            (sum, runs) => sum + runs.reduce((s, r) => s + this.measureRun(r, size, opts.bold), 0),
            0,
          ) +
          space * (pieces.length - 1);
        const align = opts.align ?? 'right';
        let cursor =
          align === 'left' ? x : align === 'center' ? x + (width - total) / 2 : x + width - total;
        const top = y + index * lineHeight;
        pieces.forEach((runs) => {
          for (const run of runs) {
            this.useFont(run.kind, size, opts.bold);
            this.doc
              .fillColor(opts.color ?? INK)
              .text(run.text, cursor, top + (run.kind === 'arabic' ? 0 : size * 0.3), {
                lineBreak: false,
              });
            cursor += this.measureRun(run, size, opts.bold);
          }
          cursor += space;
        });
      });
    }
    return lines.length * lineHeight;
  }

  private useFont(kind: string, size: number, bold?: boolean) {
    const arabic = kind === 'arabic';
    this.doc
      .font(arabic ? (bold ? 'naskhBold' : 'naskh') : bold ? 'sansBold' : 'sans')
      .fontSize(size);
  }

  private measureRun(run: { kind: string; text: string }, size: number, bold?: boolean) {
    this.useFont(run.kind, size, bold);
    return this.doc.widthOfString(run.text);
  }

  /**
   * Largeur d'un mot telle qu'il sera dessiné : la ponctuation détachée devient un morceau à part, séparé
   * par un espace (voir `write`) ; la coupure en lignes réserve donc exactement cette largeur.
   */
  private measureWord(word: string, size: number, bold?: boolean) {
    const pieces = detachPunctuation(word);
    const space = this.measureRun({ kind: 'neutral', text: ' ' }, size, bold);
    return (
      pieces.reduce(
        (sum, piece) =>
          sum + visualRuns(piece, true).reduce((s, r) => s + this.measureRun(r, size, bold), 0),
        0,
      ) +
      space * (pieces.length - 1)
    );
  }
}

/** Libellés et contenus d'un document selon la langue de l'établissement. */
export class PdfContent<K extends string> {
  readonly rtl: boolean;
  readonly bilingual: boolean;

  constructor(
    private readonly locale: SchoolLocale,
    private readonly labels: { fr: Record<K, string>; ar: Record<K, string> },
  ) {
    this.rtl = locale === 'AR';
    this.bilingual = locale === 'BILINGUAL';
  }

  /** Libellé : une ou deux lignes. */
  label(key: K): string[] {
    if (this.rtl) return [this.labels.ar[key]];
    return this.bilingual ? [this.labels.fr[key], this.labels.ar[key]] : [this.labels.fr[key]];
  }

  /** Libellé dans la langue de l'interface : français, sauf pour un établissement en Arabe. */
  primary(key: K): string {
    return this.rtl ? this.labels.ar[key] : this.labels.fr[key];
  }

  /** Contenu : français seul, arabe (repli français) ou les deux. */
  pick(fr: string | null, ar: string | null): string[] {
    const french = fr?.trim() || null;
    const arabic = ar?.trim() || null;
    if (this.locale === 'FR') return french ? [french] : [];
    if (this.rtl) return arabic ? [arabic] : french ? [french] : [];
    return [french, arabic].filter((v): v is string => Boolean(v));
  }

  number(value: number | null, decimals: number): string {
    if (value === null) return '–';
    return value.toLocaleString('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  date(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
}
