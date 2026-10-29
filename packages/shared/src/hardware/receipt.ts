/**
 * Mise en page des tickets. La même fonction produit l'aperçu à l'écran et le contenu imprimé,
 * pour que le ticket papier corresponde exactement à ce que l'utilisateur voit.
 */
import { formatSaleNumber } from '../pos';
import { formatXof } from '../subscription';
import { type PaperWidth, type ReceiptLine, charsPerLine, columns, wrap } from './escpos';

export interface ReceiptData {
  organizationName: string;
  establishmentName: string;
  saleNumber: number;
  /** Date ISO de la vente, affichée dans le fuseau de l'établissement. */
  date: string;
  timezone: string;
  cashierName: string;
  lines: {
    productName: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  total: number;
  payment: {
    method: 'CASH' | 'WAVE';
    amount: number;
    amountTendered: number | null;
    changeGiven: number | null;
  } | null;
  /** Réimpression : le ticket porte la mention DUPLICATA. */
  duplicate: boolean;
}

function separator(width: number): ReceiptLine {
  return { text: '-'.repeat(width) };
}

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function layoutReceipt(data: ReceiptData, paperWidth: PaperWidth): ReceiptLine[] {
  const w = charsPerLine(paperWidth);
  const out: ReceiptLine[] = [];
  if (data.duplicate) out.push({ text: '*** DUPLICATA ***', align: 'center', bold: true });
  for (const t of wrap(data.organizationName, Math.floor(w / 2)))
    out.push({ text: t, align: 'center', bold: true, large: true });
  for (const t of wrap(data.establishmentName, w)) out.push({ text: t, align: 'center' });
  out.push(separator(w));
  out.push({
    text: columns(
      `Ticket n° ${formatSaleNumber(data.saleNumber)}`,
      formatDate(data.date, data.timezone),
      w,
    ),
  });
  out.push({ text: `Caissier : ${data.cashierName}`.slice(0, w) });
  out.push(separator(w));
  for (const l of data.lines) {
    for (const t of wrap(`${l.productName} (${l.variantName})`, w)) out.push({ text: t });
    out.push({
      text: columns(`  ${l.quantity} x ${formatXof(l.unitPrice)}`, formatXof(l.lineTotal), w),
    });
  }
  out.push(separator(w));
  out.push({
    text: columns('TOTAL', formatXof(data.total), Math.floor(w / 2)),
    bold: true,
    large: true,
  });
  if (data.payment) {
    const label = data.payment.method === 'CASH' ? 'Espèces' : 'Wave';
    out.push({
      text: columns(
        `Payé (${label})`,
        formatXof(data.payment.amountTendered ?? data.payment.amount),
        w,
      ),
    });
    if (data.payment.changeGiven !== null)
      out.push({ text: columns('Monnaie rendue', formatXof(data.payment.changeGiven), w) });
  }
  out.push(separator(w));
  out.push({ text: 'Merci de votre visite !', align: 'center' });
  out.push({ text: 'Montants en FCFA, TTC', align: 'center' });
  return out;
}

export function layoutTestPage(
  terminalName: string,
  establishmentName: string,
  paperWidth: PaperWidth,
  date: Date,
): ReceiptLine[] {
  const w = charsPerLine(paperWidth);
  return [
    { text: 'TEST D’IMPRESSION', align: 'center', bold: true, large: true },
    { text: 'Ocall Park', align: 'center' },
    separator(w),
    { text: `Poste : ${terminalName}`.slice(0, w) },
    { text: `Établissement : ${establishmentName}`.slice(0, w) },
    { text: `Papier : ${paperWidth} mm (${w} caractères)` },
    { text: `Date : ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` },
    separator(w),
    { text: 'Accents : é è ê à ç ù ô î €' },
    { text: columns('Aligné à gauche', 'à droite', w) },
    { text: '1234567890'.repeat(Math.ceil(w / 10)).slice(0, w) },
    separator(w),
    { text: 'Impression réussie si ce ticket est lisible.', align: 'center' },
  ];
}

/** Aperçu texte brut (affichage à l'écran, journal du mode simulation). */
export function previewLines(lines: readonly ReceiptLine[], paperWidth: PaperWidth): string[] {
  const w = charsPerLine(paperWidth);
  return lines.map((l) => {
    const width = l.large ? Math.floor(w / 2) : w;
    const text = l.text.slice(0, width);
    if (l.align === 'center')
      return text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);
    if (l.align === 'right') return text.padStart(width);
    return text;
  });
}
