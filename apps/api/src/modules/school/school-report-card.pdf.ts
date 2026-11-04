import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { SchoolLocale } from '@ocall/shared';
import { hasArabic, visualOrderRtl, visualRuns, words, wrapWords } from './school-rtl-text';

/**
 * Bulletin scolaire PDF (Sprint 4), première version. Rendu sans navigateur, à la demande, jamais stocké.
 * Français : bulletin français. Arabe : bulletin arabe de droite à gauche, le français servant de repli
 * pour un libellé sans traduction. Bilingue : libellés et contenus dans les deux langues. Aucun champ
 * arabe n'est exigé.
 */

const FONTS_DIR = join(__dirname, '..', '..', '..', 'assets', 'fonts');
const FONT_FILES = {
  sans: 'NotoSans-Regular.ttf',
  sansBold: 'NotoSans-Bold.ttf',
  naskh: 'NotoNaskhArabic-Regular.ttf',
  naskhBold: 'NotoNaskhArabic-Bold.ttf',
} as const;

export interface ReportCardSubjectLine {
  name: string;
  nameAr: string | null;
  coefficient: number;
  average: number | null;
  classAverage: number | null;
  appreciation: string | null;
  appreciationAr: string | null;
}

export interface ReportCardView {
  locale: SchoolLocale;
  school: {
    name: string;
    nameAr: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  yearLabel: string;
  period: { label: string; labelAr: string | null };
  student: {
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
    matricule: string;
    birthDate: string | null;
  };
  class: { name: string; nameAr: string | null; size: number };
  scale: number;
  decimals: number;
  subjects: ReportCardSubjectLine[];
  generalAverage: number | null;
  classAverage: number | null;
  rankingEnabled: boolean;
  rank: number | null;
  tied: boolean;
  rankedCount: number;
  directionComment: string | null;
  directionCommentAr: string | null;
  /** Date d'édition, AAAA-MM-JJ. */
  issuedOn: string;
  /** Résultats non validés par la direction : mention « Provisoire » sur chaque page. */
  provisional: boolean;
}

const LABELS = {
  fr: {
    title: 'Bulletin scolaire',
    year: 'Année scolaire',
    student: 'Élève',
    matricule: 'Matricule',
    birthDate: 'Né(e) le',
    class: 'Classe',
    size: 'Effectif',
    subject: 'Matière',
    coefficient: 'Coef.',
    average: 'Moyenne',
    classAverage: 'Moy. classe',
    appreciation: 'Appréciation',
    general: 'Moyenne générale',
    classGeneral: 'Moyenne de la classe',
    rank: 'Rang',
    tied: 'ex æquo',
    direction: 'Appréciation de la direction',
    issued: 'Édité le',
    provisional: 'PROVISOIRE',
    page: 'Page',
  },
  ar: {
    title: 'كشف النقاط',
    year: 'السنة الدراسية',
    student: 'التلميذ',
    matricule: 'الرقم التسلسلي',
    birthDate: 'تاريخ الميلاد',
    class: 'القسم',
    size: 'عدد التلاميذ',
    subject: 'المادة',
    coefficient: 'المعامل',
    average: 'المعدل',
    classAverage: 'معدل القسم',
    appreciation: 'الملاحظة',
    general: 'المعدل العام',
    classGeneral: 'معدل القسم العام',
    rank: 'الرتبة',
    tied: 'مكرر',
    direction: 'ملاحظة الإدارة',
    issued: 'حُرّر في',
    provisional: 'مؤقت',
    page: 'الصفحة',
  },
} as const;
type LabelKey = keyof (typeof LABELS)['fr'];

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const CONTENT = PAGE.width - 2 * PAGE.margin;
const INK = '#1f2a24';
const MUTED = '#5b665f';
const LINE = '#c9d1cb';
const BAND = '#eef3ef';

type Align = 'left' | 'right' | 'center';
interface TextOptions {
  size?: number;
  bold?: boolean;
  align?: Align;
  color?: string;
  /** Garde l'alignement demandé même pour une ligne arabe (bloc d'identité). */
  keepAlign?: boolean;
}

/** Texte positionné ; l'arabe passe par la mise en ordre droite-à-gauche, le reste par pdfkit. */
class Writer {
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

  private measureWord(word: string, size: number, bold?: boolean) {
    return visualRuns(word, true).reduce((s, r) => s + this.measureRun(r, size, bold), 0);
  }
}

/** Libellés et contenus selon la langue de l'établissement. */
class Content {
  readonly rtl: boolean;
  readonly bilingual: boolean;

  constructor(private readonly locale: SchoolLocale) {
    this.rtl = locale === 'AR';
    this.bilingual = locale === 'BILINGUAL';
  }

  /** Libellé : une ou deux lignes. */
  label(key: LabelKey): string[] {
    if (this.rtl) return [LABELS.ar[key]];
    return this.bilingual ? [LABELS.fr[key], LABELS.ar[key]] : [LABELS.fr[key]];
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

interface Column {
  key: 'subject' | 'coefficient' | 'average' | 'classAverage' | 'appreciation';
  width: number;
  align: Align;
}

const COLUMNS: Column[] = [
  { key: 'subject', width: 150, align: 'left' },
  { key: 'coefficient', width: 42, align: 'center' },
  { key: 'average', width: 58, align: 'center' },
  { key: 'classAverage', width: 58, align: 'center' },
  { key: 'appreciation', width: CONTENT - 150 - 42 - 58 - 58, align: 'left' },
];

/** Un ou plusieurs bulletins dans un même document, une page (ou plus) par élève. */
export function renderReportCards(views: readonly ReportCardView[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    autoFirstPage: false,
    info: { Title: 'Bulletin scolaire', Creator: 'Ocall School', Producer: 'Ocall School' },
  });
  doc.registerFont('sans', join(FONTS_DIR, FONT_FILES.sans));
  doc.registerFont('sansBold', join(FONTS_DIR, FONT_FILES.sansBold));
  doc.registerFont('naskh', join(FONTS_DIR, FONT_FILES.naskh));
  doc.registerFont('naskhBold', join(FONTS_DIR, FONT_FILES.naskhBold));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const view of views) new ReportCard(doc, view).render();
  doc.end();
  return done;
}

class ReportCard {
  private readonly w: Writer;
  private readonly c: Content;
  private y = PAGE.margin;
  private page = 0;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly v: ReportCardView,
  ) {
    this.w = new Writer(doc);
    this.c = new Content(v.locale);
  }

  render() {
    this.newPage();
    this.header();
    this.identity();
    this.table();
    this.summary();
    this.direction();
  }

  /** Abscisse miroir en arabe : la mise en page entière se lit de droite à gauche. */
  private x(left: number, width: number): number {
    return this.c.rtl ? PAGE.margin + CONTENT - (left - PAGE.margin) - width : left;
  }

  private align(a: Align): Align {
    if (!this.c.rtl || a === 'center') return a;
    return a === 'left' ? 'right' : 'left';
  }

  /** Lignes l'une sous l'autre ; en mise en page française, une ligne arabe s'aligne à droite. */
  private lines(texts: string[], left: number, width: number, opts: TextOptions = {}): number {
    let h = 0;
    for (const t of texts) {
      const base = opts.align ?? 'left';
      const align =
        !this.c.rtl && !opts.keepAlign && base === 'left' && hasArabic(t)
          ? 'right'
          : this.align(base);
      h += this.w.text(t, this.x(left, width), this.y + h, width, { ...opts, align });
    }
    return h;
  }

  private heightOf(texts: string[], width: number, opts: TextOptions = {}): number {
    return texts.reduce((h, t) => h + this.w.height(t, width, opts), 0);
  }

  private newPage() {
    this.doc.addPage({ size: 'A4', margin: PAGE.margin });
    this.page += 1;
    this.y = PAGE.margin;
    if (this.v.provisional) this.watermark();
    this.footer();
  }

  private ensure(height: number) {
    if (this.y + height > PAGE.height - PAGE.margin - 30) {
      this.newPage();
      this.tableHeader();
    }
  }

  private watermark() {
    const text = this.c.rtl ? LABELS.ar.provisional : LABELS.fr.provisional;
    this.doc.save();
    this.doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
    this.w.text(text, PAGE.margin, PAGE.height / 2 - 30, CONTENT, {
      size: 64,
      bold: true,
      align: 'center',
      color: '#e4e9e5',
    });
    this.doc.restore();
  }

  private footer() {
    const y = PAGE.height - PAGE.margin - 12;
    // Pied de page dans la langue de l'interface : français, sauf pour un établissement en Arabe.
    const issued = `${this.c.label('issued')[0]} ${this.c.date(this.v.issuedOn)}`;
    const page = `${this.c.rtl ? LABELS.ar.page : LABELS.fr.page} ${this.page}`;
    this.doc.save();
    const savedY = this.y;
    this.y = y;
    this.lines([issued], PAGE.margin, CONTENT / 2, { size: 7.5, color: MUTED });
    this.lines([page], PAGE.margin + CONTENT / 2, CONTENT / 2, {
      size: 7.5,
      color: MUTED,
      align: 'right',
    });
    this.y = savedY;
    this.doc.restore();
  }

  private header() {
    const v = this.v;
    const names = this.c.pick(v.school.name, v.school.nameAr);
    let h = this.lines(names, PAGE.margin, CONTENT, { size: 14, bold: true, align: 'center' });
    const contact = [v.school.address, v.school.phone, v.school.email].filter(Boolean).join(' · ');
    if (contact) {
      this.y += h;
      h = this.lines([contact], PAGE.margin, CONTENT, { size: 8, color: MUTED, align: 'center' });
    }
    this.y += h + 10;
    // Une langue par ligne : une chaîne mêlant français et arabe se lirait dans le sens arabe.
    h = this.lines(this.c.label('title'), PAGE.margin, CONTENT, {
      size: 13,
      bold: true,
      align: 'center',
    });
    this.y += h;
    const periods = this.c.pick(v.period.label, v.period.labelAr);
    const years = this.c.label('year');
    const lines = years.map(
      (year, i) => `${periods[i] ?? periods[0] ?? ''} · ${year} ${v.yearLabel}`,
    );
    h = this.lines(lines, PAGE.margin, CONTENT, { size: 9.5, align: 'center' });
    this.y += h + 12;
  }

  private identity() {
    const v = this.v;
    const s = v.student;
    const name = this.c.pick(`${s.lastName} ${s.firstName}`, this.arabicName());
    const half = CONTENT / 2 - 8;
    const left: [LabelKey, string[]][] = [
      ['student', name],
      ['matricule', [s.matricule]],
    ];
    if (s.birthDate) left.push(['birthDate', [this.c.date(s.birthDate)]]);
    const right: [LabelKey, string[]][] = [
      ['class', this.c.pick(v.class.name, v.class.nameAr)],
      ['size', [String(v.class.size)]],
    ];
    const top = this.y;
    const leftH = this.fields(left, PAGE.margin, half);
    this.y = top;
    const rightH = this.fields(right, PAGE.margin + half + 16, half);
    const height = Math.max(leftH, rightH) + 10;
    this.doc
      .roundedRect(PAGE.margin - 6, top - 6, CONTENT + 12, height, 4)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    this.y = top + height + 8;
  }

  private arabicName(): string | null {
    const s = this.v.student;
    if (!s.lastNameAr && !s.firstNameAr) return null;
    return [s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ');
  }

  /** Champs « libellé : valeur », libellé sur 38 % de la largeur. */
  private fields(entries: [LabelKey, string[]][], left: number, width: number): number {
    const labelW = width * 0.38;
    let total = 0;
    for (const [key, values] of entries) {
      const labelH = this.lines(this.c.label(key), left, labelW, {
        size: 8.5,
        color: MUTED,
        keepAlign: true,
      });
      const valueH = this.lines(values, left + labelW, width - labelW, {
        size: 9.5,
        bold: true,
        keepAlign: true,
      });
      const h = Math.max(labelH, valueH) + 3;
      this.y += h;
      total += h;
    }
    return total;
  }

  private tableHeader() {
    const height =
      Math.max(
        ...COLUMNS.map((col) => this.heightOf(this.c.label(col.key), col.width - 8, { size: 8 })),
      ) + 8;
    this.doc.rect(PAGE.margin, this.y, CONTENT, height).fill(BAND);
    let left = PAGE.margin;
    for (const col of COLUMNS) {
      const saved = this.y;
      this.y += 4;
      this.lines(this.c.label(col.key), left + 4, col.width - 8, {
        size: 8,
        bold: true,
        align: col.align,
      });
      this.y = saved;
      left += col.width;
    }
    this.y += height;
  }

  private table() {
    this.tableHeader();
    const decimals = this.v.decimals;
    for (const line of this.v.subjects) {
      const cells: Record<Column['key'], string[]> = {
        subject: this.c.pick(line.name, line.nameAr),
        coefficient: [this.c.number(line.coefficient, line.coefficient % 1 === 0 ? 0 : 2)],
        average: [this.c.number(line.average, decimals)],
        classAverage: [this.c.number(line.classAverage, decimals)],
        appreciation: this.c.pick(line.appreciation, line.appreciationAr),
      };
      const height =
        Math.max(
          ...COLUMNS.map((col) => this.heightOf(cells[col.key], col.width - 8, { size: 8.5 })),
          10,
        ) + 8;
      this.ensure(height);
      let left = PAGE.margin;
      for (const col of COLUMNS) {
        const saved = this.y;
        this.y += 4;
        this.lines(cells[col.key], left + 4, col.width - 8, {
          size: 8.5,
          bold: col.key === 'average',
          align: col.align,
        });
        this.y = saved;
        left += col.width;
      }
      this.y += height;
      this.doc
        .moveTo(PAGE.margin, this.y)
        .lineTo(PAGE.margin + CONTENT, this.y)
        .lineWidth(0.4)
        .strokeColor(LINE)
        .stroke();
    }
    this.y += 10;
  }

  private summary() {
    const v = this.v;
    const scale = this.c.number(v.scale, 0);
    const entries: [LabelKey, string][] = [
      ['general', `${this.c.number(v.generalAverage, v.decimals)} / ${scale}`],
      ['classGeneral', `${this.c.number(v.classAverage, v.decimals)} / ${scale}`],
    ];
    if (v.rankingEnabled) {
      const tied = v.tied ? ` (${this.c.rtl ? LABELS.ar.tied : LABELS.fr.tied})` : '';
      entries.push(['rank', v.rank === null ? '–' : `${v.rank} / ${v.rankedCount}${tied}`]);
    }
    const width = CONTENT / entries.length;
    const heights = entries.map(([key]) =>
      this.heightOf(this.c.label(key), width - 12, { size: 8 }),
    );
    const height = Math.max(...heights) + 30;
    this.ensure(height);
    const top = this.y;
    this.doc.roundedRect(PAGE.margin, top, CONTENT, height, 4).fill(BAND);
    entries.forEach(([key, value], i) => {
      const left = PAGE.margin + i * width;
      this.y = top + 6;
      const h = this.lines(this.c.label(key), left + 6, width - 12, {
        size: 8,
        color: MUTED,
        align: 'center',
      });
      this.y = top + 8 + h;
      this.lines([value], left + 6, width - 12, { size: 12, bold: true, align: 'center' });
    });
    this.y = top + height + 12;
  }

  private direction() {
    const texts = this.c.pick(this.v.directionComment, this.v.directionCommentAr);
    const labelH = this.heightOf(this.c.label('direction'), CONTENT, { size: 9 });
    const textH = Math.max(this.heightOf(texts, CONTENT - 12, { size: 9.5 }), 28);
    this.ensure(labelH + textH + 16);
    this.y += this.lines(this.c.label('direction'), PAGE.margin, CONTENT, { size: 9, bold: true });
    const top = this.y + 2;
    this.doc
      .roundedRect(PAGE.margin, top, CONTENT, textH + 12, 4)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    this.y = top + 6;
    this.lines(texts, PAGE.margin + 6, CONTENT - 12, { size: 9.5 });
    this.y = top + textH + 18;
  }
}
