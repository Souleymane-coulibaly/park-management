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

export interface TicketPrintData {
  organizationName: string;
  establishmentName: string;
  timezone: string;
  saleNumber: number;
  tickets: {
    id: string;
    visitorName: string;
    categoryName: string;
    pricePaid: number;
    validFrom: string;
    validUntil: string;
    /** Contenu du QR code (préfixe + jeton), jamais de donnée personnelle. */
    qr: string;
  }[];
  duplicate: boolean;
}

function formatDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Billets d'entrée : un billet par visiteur, chacun avec son QR code, séparés par une coupe.
 * La date affichée est le dernier jour de validité (fin de journée, fuseau de l'établissement).
 */
export function layoutTickets(data: TicketPrintData, paperWidth: PaperWidth): ReceiptLine[] {
  const w = charsPerLine(paperWidth);
  const out: ReceiptLine[] = [];
  data.tickets.forEach((t, index) => {
    if (data.duplicate) out.push({ text: '*** DUPLICATA ***', align: 'center', bold: true });
    for (const line of wrap(data.organizationName, Math.floor(w / 2)))
      out.push({ text: line, align: 'center', bold: true, large: true });
    for (const line of wrap(data.establishmentName, w)) out.push({ text: line, align: 'center' });
    out.push(separator(w));
    out.push({ text: 'BILLET D’ENTRÉE', align: 'center', bold: true });
    for (const line of wrap(t.visitorName, Math.floor(w / 2)))
      out.push({ text: line, align: 'center', large: true });
    out.push({ text: columns(t.categoryName, formatXof(t.pricePaid), w) });
    const from = formatDay(t.validFrom, data.timezone);
    const until = formatDay(t.validUntil, data.timezone);
    out.push({
      text: from === until ? `Valable le ${until}` : `Valable du ${from} au ${until}`,
      align: 'center',
    });
    out.push({ text: `[QR ${t.id.slice(0, 8).toUpperCase()}]`, qr: t.qr });
    out.push({
      text: `Réf. ${t.id.slice(0, 8).toUpperCase()} · Vente n° ${formatSaleNumber(data.saleNumber)}`,
      align: 'center',
    });
    out.push({
      text: `Billet ${index + 1}/${data.tickets.length} — une seule entrée`,
      align: 'center',
      cut: true,
    });
  });
  return out;
}

export interface KitchenTicketData {
  establishmentName: string;
  timezone: string;
  saleNumber: number;
  /** Libellé du canal (Sur place, À emporter…). */
  channelLabel: string;
  /** Table ou zone, si la commande en a une. */
  location: string | null;
  /** Date ISO de l'envoi en cuisine. */
  sentAt: string;
  notes: string | null;
  lines: { productName: string; variantName: string; quantity: number; notes: string | null }[];
  duplicate: boolean;
}

/**
 * Ticket cuisine : articles, quantités, variantes et instructions, en gros caractères.
 * Il ne contient AUCUN prix ni information de paiement.
 */
export function layoutKitchenTicket(
  data: KitchenTicketData,
  paperWidth: PaperWidth,
): ReceiptLine[] {
  const w = charsPerLine(paperWidth);
  const half = Math.floor(w / 2);
  const out: ReceiptLine[] = [];
  if (data.duplicate) out.push({ text: '*** RÉIMPRESSION ***', align: 'center', bold: true });
  out.push({ text: 'CUISINE', align: 'center', bold: true, large: true });
  out.push({
    text: `N° ${formatSaleNumber(data.saleNumber)}`,
    align: 'center',
    bold: true,
    large: true,
  });
  for (const t of wrap(data.establishmentName, w)) out.push({ text: t, align: 'center' });
  out.push(separator(w));
  out.push({ text: columns(data.channelLabel, formatDate(data.sentAt, data.timezone), w) });
  if (data.location) {
    for (const t of wrap(data.location, half)) out.push({ text: t, bold: true, large: true });
  }
  out.push(separator(w));
  for (const l of data.lines) {
    for (const t of wrap(`${l.quantity} x ${l.productName}`, half))
      out.push({ text: t, bold: true, large: true });
    if (l.variantName) for (const t of wrap(`  ${l.variantName}`, w)) out.push({ text: t });
    if (l.notes) for (const t of wrap(`  >> ${l.notes}`, w)) out.push({ text: t, bold: true });
  }
  if (data.notes) {
    out.push(separator(w));
    out.push({ text: 'Instructions :', bold: true });
    for (const t of wrap(data.notes, w)) out.push({ text: t });
  }
  out.push(separator(w));
  return out;
}
