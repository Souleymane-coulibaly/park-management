import {
  type SchoolCurrency,
  type SchoolLocale,
  type SchoolPaymentMethod,
  type SchoolPaymentVerification,
  formatAmount,
} from '@ocall/shared';
import {
  BAND,
  CONTENT,
  LINE,
  MUTED,
  PAGE,
  PdfContent,
  type TextOptions,
  Writer,
  renderPdf,
} from './school-pdf';
import { hasArabic } from './school-rtl-text';

/**
 * Reçu de paiement PDF (Sprint 5). Produit à la demande depuis l'encaissement et ses copies figées
 * (libellés des échéances, solde après paiement, classe à cette date) : un reçu émis reste identique
 * même si la tarification change. Français, Arabe (droite à gauche) ou Bilingue. Un mobile money saisi
 * à la main porte la mention « déclaré, non vérifié auprès de l'opérateur » ; un encaissement annulé
 * porte « ANNULÉ ».
 *
 * Pagination explicite : un encaissement couvrant de nombreuses échéances se poursuit sur d'autres pages,
 * avec le numéro du reçu, l'en-tête du tableau, le filigrane et le pied de page répétés ; le total, les
 * mentions « non vérifié » et « annulé » forment un bloc jamais coupé.
 */

export interface ReceiptView {
  locale: SchoolLocale;
  school: {
    name: string;
    nameAr: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  receiptNumber: string;
  /** Date et heure ISO du paiement. */
  paidAt: string;
  timezone: string;
  student: {
    matricule: string;
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
  };
  classLabel: string | null;
  yearLabel: string;
  lines: { label: string; labelAr: string | null; category: string; amount: number }[];
  amount: number;
  currency: SchoolCurrency;
  method: SchoolPaymentMethod;
  reference: string | null;
  verification: SchoolPaymentVerification;
  balanceAfter: number | null;
  cancelled: { at: string } | null;
}

const LABELS = {
  fr: {
    title: 'Reçu de paiement',
    number: 'Reçu n°',
    date: 'Date du paiement',
    student: 'Élève',
    matricule: 'Matricule',
    class: 'Classe',
    year: 'Année scolaire',
    item: 'Frais réglés',
    amount: 'Montant',
    total: 'Montant payé',
    method: 'Moyen de paiement',
    reference: 'Référence',
    balance: 'Solde restant',
    cash: 'Espèces',
    transfer: 'Virement bancaire',
    mobile: 'Mobile money',
    unverified: 'Paiement mobile money déclaré : non vérifié auprès de l’opérateur.',
    cancelled: 'ANNULÉ',
    cancelledOn: 'Encaissement annulé le',
    continued: 'suite',
    issued: 'Document produit par Ocall School',
  },
  ar: {
    title: 'وصل دفع',
    number: 'رقم الوصل',
    date: 'تاريخ الدفع',
    student: 'التلميذ',
    matricule: 'الرقم التسلسلي',
    class: 'القسم',
    year: 'السنة الدراسية',
    item: 'المصاريف المدفوعة',
    amount: 'المبلغ',
    total: 'المبلغ المدفوع',
    method: 'وسيلة الدفع',
    reference: 'المرجع',
    balance: 'المبلغ المتبقي',
    cash: 'نقدا',
    transfer: 'تحويل بنكي',
    mobile: 'الدفع عبر الهاتف',
    unverified: 'دفع عبر الهاتف مُصرَّح به: لم يتم التحقق منه لدى المشغّل.',
    cancelled: 'ملغى',
    cancelledOn: 'أُلغي التحصيل في',
    continued: 'تابع',
    issued: 'وثيقة صادرة عن أوكال سكول',
  },
} as const;
type LabelKey = keyof (typeof LABELS)['fr'];

const METHOD_KEY: Record<SchoolPaymentMethod, LabelKey> = {
  CASH: 'cash',
  BANK_TRANSFER: 'transfer',
  MOBILE_MONEY: 'mobile',
};

export function renderReceipt(view: ReceiptView): Promise<Buffer> {
  // Chaque texte du reçu tient sur une ligne logique : retours à la ligne et espaces répétés ramenés à un
  // espace. Avec les longueurs bornées par la validation, aucun bloc ne dépasse alors une page.
  const flat = JSON.parse(JSON.stringify(view), (_key, value: unknown) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
  ) as ReceiptView;
  return renderPdf('Reçu de paiement', (doc) => new Receipt(doc, flat).render());
}

/** Date et heure locales de l'établissement, JJ/MM/AAAA HH:MM. */
function localDateTime(iso: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
    return parts.replace(',', '');
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

class Receipt {
  private readonly w: Writer;
  private readonly c: PdfContent<LabelKey>;
  private y = PAGE.margin;
  /** Limite basse du contenu, au-dessus du pied de page. */
  private readonly bottom = PAGE.height - PAGE.margin - 30;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly v: ReceiptView,
  ) {
    this.w = new Writer(doc);
    this.c = new PdfContent(v.locale, LABELS);
  }

  render() {
    this.page();
    this.header();
    this.facts();
    this.table();
    this.summary();
  }

  /** Nouvelle page : filigrane d'annulation et pied de page sur chacune. */
  private page() {
    this.doc.addPage({ size: 'A4', margin: PAGE.margin });
    this.y = PAGE.margin;
    if (this.v.cancelled) this.watermark();
    this.footer();
  }

  /** Page suivante si `height` ne tient plus : numéro du reçu rappelé en tête. */
  private ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.page();
    this.y += this.lines(
      [`${this.c.primary('number')} ${this.v.receiptNumber} (${this.c.primary('continued')})`],
      PAGE.margin,
      CONTENT,
      { size: 9, bold: true, color: MUTED, align: 'center' },
    );
    this.y += 10;
    return true;
  }

  private heightOf(texts: string[], width: number, opts: TextOptions = {}): number {
    return texts.reduce((h, t) => h + this.w.height(t, width, opts), 0);
  }

  private money(minor: number) {
    return formatAmount(minor, this.v.currency);
  }

  private x(left: number, width: number) {
    return this.c.rtl ? PAGE.margin + CONTENT - (left - PAGE.margin) - width : left;
  }

  private lines(texts: string[], left: number, width: number, opts: TextOptions = {}): number {
    let h = 0;
    for (const t of texts) {
      const base = opts.align ?? 'left';
      const align =
        base === 'center'
          ? 'center'
          : this.c.rtl
            ? base === 'left'
              ? 'right'
              : 'left'
            : !opts.keepAlign && base === 'left' && hasArabic(t)
              ? 'right'
              : base;
      h += this.w.text(t, this.x(left, width), this.y + h, width, { ...opts, align });
    }
    return h;
  }

  private watermark() {
    this.doc.save();
    this.doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
    this.w.text(this.c.primary('cancelled'), PAGE.margin, PAGE.height / 2 - 30, CONTENT, {
      size: 72,
      bold: true,
      align: 'center',
      color: '#f1d9d2',
    });
    this.doc.restore();
  }

  private header() {
    const v = this.v;
    this.y += this.lines(this.c.pick(v.school.name, v.school.nameAr), PAGE.margin, CONTENT, {
      size: 14,
      bold: true,
      align: 'center',
    });
    const contact = [v.school.address, v.school.phone, v.school.email].filter(Boolean).join(' · ');
    if (contact) {
      this.y += this.lines([contact], PAGE.margin, CONTENT, {
        size: 8,
        color: MUTED,
        align: 'center',
      });
    }
    this.y += 12;
    this.y += this.lines(this.c.label('title'), PAGE.margin, CONTENT, {
      size: 13,
      bold: true,
      align: 'center',
    });
    this.y += this.lines([`${this.c.primary('number')} ${v.receiptNumber}`], PAGE.margin, CONTENT, {
      size: 10,
      bold: true,
      align: 'center',
    });
    this.y += 12;
  }

  private facts() {
    const v = this.v;
    const s = v.student;
    const arabicName = [s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ') || null;
    const entries: [LabelKey, string[]][] = [
      ['date', [localDateTime(v.paidAt, v.timezone)]],
      ['student', this.c.pick(`${s.lastName} ${s.firstName}`, arabicName)],
      ['matricule', [s.matricule]],
      ['class', v.classLabel ? [v.classLabel] : ['–']],
      ['year', [v.yearLabel]],
    ];
    const top = this.y;
    const labelW = CONTENT * 0.32;
    for (const [key, values] of entries) {
      const lh = this.lines(this.c.label(key), PAGE.margin + 6, labelW, {
        size: 8.5,
        color: MUTED,
        keepAlign: true,
      });
      const vh = this.lines(values, PAGE.margin + 6 + labelW, CONTENT - labelW - 12, {
        size: 9.5,
        bold: true,
        keepAlign: true,
      });
      this.y += Math.max(lh, vh) + 3;
    }
    this.doc
      .roundedRect(PAGE.margin, top - 6, CONTENT, this.y - top + 8, 4)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    this.y += 14;
  }

  private static readonly AMOUNT_W = 120;
  private static readonly ITEM_W = CONTENT - Receipt.AMOUNT_W;

  private tableHeadHeight() {
    return (
      Math.max(
        this.heightOf(this.c.label('item'), Receipt.ITEM_W - 8, { size: 8 }),
        this.heightOf(this.c.label('amount'), Receipt.AMOUNT_W - 8, { size: 8 }),
      ) + 8
    );
  }

  private tableHead() {
    const amountW = Receipt.AMOUNT_W;
    const itemW = Receipt.ITEM_W;
    const headH = this.tableHeadHeight();
    this.doc.rect(PAGE.margin, this.y, CONTENT, headH).fill(BAND);
    const saved = this.y;
    this.y += 4;
    this.lines(this.c.label('item'), PAGE.margin + 4, itemW - 8, { size: 8, bold: true });
    this.lines(this.c.label('amount'), PAGE.margin + itemW + 4, amountW - 8, {
      size: 8,
      bold: true,
      align: 'right',
    });
    this.y = saved + headH;
  }

  private table() {
    const amountW = Receipt.AMOUNT_W;
    const itemW = Receipt.ITEM_W;
    // En-tête jamais seul en bas de page : il part avec au moins une ligne.
    this.ensure(this.tableHeadHeight() + 30);
    this.tableHead();
    for (const line of this.v.lines) {
      const labels = this.c.pick(line.label, line.labelAr);
      const h = Math.max(this.heightOf(labels, itemW - 8, { size: 9 }), 10) + 8;
      if (this.ensure(h)) this.tableHead();
      const top = this.y;
      this.y += 4;
      this.lines(labels, PAGE.margin + 4, itemW - 8, { size: 9 });
      this.lines([this.money(line.amount)], PAGE.margin + itemW + 4, amountW - 8, {
        size: 9,
        align: 'right',
      });
      this.y = top + h;
      this.doc
        .moveTo(PAGE.margin, this.y)
        .lineTo(PAGE.margin + CONTENT, this.y)
        .lineWidth(0.4)
        .strokeColor(LINE)
        .stroke();
    }
    this.y += 12;
  }

  private summary() {
    const v = this.v;
    const entries: [LabelKey, string, boolean][] = [
      ['total', this.money(v.amount), true],
      ['method', this.c.primary(METHOD_KEY[v.method]), false],
    ];
    if (v.reference) entries.push(['reference', v.reference, false]);
    if (v.balanceAfter !== null) entries.push(['balance', this.money(v.balanceAfter), true]);
    const labelW = CONTENT * 0.5;
    const notices: [string[], TextOptions][] = [];
    if (v.verification === 'DECLARED_UNVERIFIED') {
      notices.push([this.c.label('unverified'), { size: 9, bold: true, color: '#8a4b2a' }]);
    }
    if (v.cancelled) {
      notices.push([
        [`${this.c.primary('cancelledOn')} ${localDateTime(v.cancelled.at, v.timezone)}`],
        { size: 10, bold: true, color: '#8a2a2a' },
      ]);
    }
    const height =
      entries.reduce(
        (h, [key, value, strong]) =>
          h +
          Math.max(
            this.heightOf(this.c.label(key), labelW, { size: 9 }),
            this.heightOf([value], CONTENT - labelW, { size: strong ? 11 : 9.5, bold: strong }),
          ) +
          4,
        0,
      ) + notices.reduce((h, [texts, o]) => h + 6 + this.heightOf(texts, CONTENT, o), 0);
    this.ensure(height);
    for (const [key, value, strong] of entries) {
      const lh = this.lines(this.c.label(key), PAGE.margin, labelW, {
        size: 9,
        color: MUTED,
        keepAlign: true,
      });
      const vh = this.lines([value], PAGE.margin + labelW, CONTENT - labelW, {
        size: strong ? 11 : 9.5,
        bold: strong,
        align: 'right',
      });
      this.y += Math.max(lh, vh) + 4;
    }
    for (const [texts, o] of notices) {
      this.y += 6;
      this.y += this.lines(texts, PAGE.margin, CONTENT, o);
    }
  }

  private footer() {
    const y = this.y;
    this.y = PAGE.height - PAGE.margin - 12;
    this.lines([this.c.primary('issued')], PAGE.margin, CONTENT, {
      size: 7.5,
      color: MUTED,
      align: 'center',
    });
    this.y = y;
  }
}
