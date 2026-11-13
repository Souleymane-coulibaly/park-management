/**
 * Ocall Stock — caisse (S4) : montants d'une vente, remises plafonnées, paiements (mixtes, monnaie rendue),
 * remboursements des retours et ticket de caisse 58 / 80 mm. Mêmes calculs pour l'écran de caisse et pour
 * le serveur, qui seul fait foi (prix relus dans le catalogue, totaux recalculés).
 *
 * Les montants sont des entiers dans l'unité de la devise (FCFA) ; les prix de vente sont TTC.
 */
import { type PaperWidth, type ReceiptLine, charsPerLine, columns, wrap } from './hardware/escpos';
import { formatStockMoney } from './stock';
import { formatStockQuantity } from './stock-warehouse';

// ─── Numéros et libellés ───

export const stockSaleNumber = (n: number) => `VTE-${String(n).padStart(6, '0')}`;
export const stockSaleReturnNumber = (n: number) => `RET-${String(n).padStart(6, '0')}`;
export const stockCashSessionNumber = (n: number) => `SES-${String(n).padStart(6, '0')}`;

export const STOCK_PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const;
export type StockPaymentMethod = (typeof STOCK_PAYMENT_METHODS)[number];

/**
 * Mobile money et carte sont saisis à la main (aucun prestataire intégré) : la caisse enregistre ce que le
 * caissier déclare, jamais une confirmation simulée.
 */
export const STOCK_PAYMENT_METHOD_LABELS: Record<StockPaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte (terminal)',
  OTHER: 'Autre',
};

/** Paniers en attente par caisse, lignes par vente. */
export const STOCK_MAX_HELD_CARTS = 20;
export const STOCK_MAX_SALE_LINES = 200;
export const STOCK_DEFAULT_MAX_DISCOUNT_PERCENT = 10;

// ─── Montants ───

export interface StockLineAmounts {
  /** Montant TTC avant remise. */
  gross: number;
  /** Montant TTC après remise. */
  total: number;
  /** TVA comprise dans le montant TTC. */
  vat: number;
}

/** Montants d'une ligne : quantité × prix TTC, moins la remise ; TVA extraite du TTC. */
export function stockLineAmounts(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  discount = 0,
): StockLineAmounts {
  const gross = Math.round(quantity * unitPrice);
  const total = gross - discount;
  const vat = Math.round((total * vatRate) / (100 + vatRate));
  return { gross, total, vat };
}

/** Remise la plus forte sur une ligne pour un membre soumis au plafond. */
export function stockDiscountCap(gross: number, maxPercent: number): number {
  return Math.floor((gross * maxPercent) / 100);
}

/** Pourquoi une remise est refusée, ou null si elle est acceptée. */
export function stockDiscountError(
  discount: number,
  gross: number,
  rules: { canDiscount: boolean; unlimited: boolean; maxPercent: number },
): string | null {
  if (discount === 0) return null;
  if (!Number.isInteger(discount) || discount < 0) return 'Remise invalide.';
  if (!rules.canDiscount) return 'Vous ne pouvez pas accorder de remise.';
  if (discount > gross) return 'La remise dépasse le montant de la ligne.';
  if (!rules.unlimited && discount > stockDiscountCap(gross, rules.maxPercent)) {
    return `Remise limitée à ${rules.maxPercent} % du montant de la ligne.`;
  }
  return null;
}

export interface StockSaleTotals {
  gross: number;
  discount: number;
  total: number;
  vat: number;
}

export function stockSaleTotals(
  lines: readonly { quantity: number; unitPrice: number; vatRate: number; discount?: number }[],
): StockSaleTotals {
  const t = { gross: 0, discount: 0, total: 0, vat: 0 };
  for (const l of lines) {
    const a = stockLineAmounts(l.quantity, l.unitPrice, l.vatRate, l.discount ?? 0);
    t.gross += a.gross;
    t.discount += l.discount ?? 0;
    t.total += a.total;
    t.vat += a.vat;
  }
  return t;
}

// ─── Paiements ───

export interface StockPaymentInput {
  method: StockPaymentMethod;
  /** Part du total réglée par ce moyen. */
  amount: number;
  /** Espèces : somme remise par le client (au moins le montant). */
  tendered?: number | null;
  reference?: string | null;
}

/**
 * Contrôle des paiements d'une vente : montants entiers positifs dont la somme égale le total ; un seul
 * règlement en espèces, seul à pouvoir rendre la monnaie. Renvoie la monnaie à rendre, ou l'erreur.
 */
export function stockCheckPayments(
  total: number,
  payments: readonly StockPaymentInput[],
): { change: number; error: null } | { change: 0; error: string } {
  if (total > 0 && payments.length === 0) return { change: 0, error: 'Ajoutez un paiement.' };
  let sum = 0;
  let change = 0;
  let cash = 0;
  for (const p of payments) {
    if (!Number.isInteger(p.amount) || p.amount <= 0)
      return { change: 0, error: 'Montant de paiement invalide.' };
    sum += p.amount;
    if (p.method === 'CASH') {
      cash += 1;
      if (p.tendered !== undefined && p.tendered !== null) {
        if (!Number.isInteger(p.tendered) || p.tendered < p.amount)
          return { change: 0, error: 'Somme remise inférieure au montant en espèces.' };
        change += p.tendered - p.amount;
      }
    } else if (p.tendered !== undefined && p.tendered !== null) {
      return { change: 0, error: 'La monnaie ne se rend qu’en espèces.' };
    }
  }
  if (cash > 1) return { change: 0, error: 'Un seul paiement en espèces par vente.' };
  if (sum !== total)
    return {
      change: 0,
      error:
        sum < total
          ? 'Paiements inférieurs au total.'
          : 'Paiements supérieurs au total (rendez la monnaie en espèces).',
    };
  return { change, error: null };
}

// ─── Retours ───

/**
 * Remboursement d'une quantité retournée : au prorata du montant payé de la ligne (remise comprise) ; le
 * dernier retour de la ligne rembourse exactement le reste, sans écart d'arrondi.
 */
export function stockRefundAmount(
  line: { quantity: number; total: number; returnedQuantity: number; refundedAmount: number },
  quantity: number,
): number {
  const remaining = line.total - line.refundedAmount;
  if (Math.abs(line.returnedQuantity + quantity - line.quantity) < 1e-9) return remaining;
  return Math.min(remaining, Math.round((line.total * quantity) / line.quantity));
}

// ─── Ticket de caisse ───

export interface StockReceiptData {
  storeName: string;
  address?: string | null;
  phone?: string | null;
  footer?: string | null;
  currency: string;
  timezone: string;
  saleLabel: string;
  /** Date ISO de la vente. */
  date: string;
  registerName: string;
  cashierName: string;
  customerName?: string | null;
  lines: {
    label: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    vatRate: number;
    vatAmount: number;
  }[];
  grossTotal: number;
  discountTotal: number;
  total: number;
  payments: {
    method: StockPaymentMethod;
    amount: number;
    tendered?: number | null;
    reference?: string | null;
  }[];
  changeGiven: number;
  /** Réimpression : mention DUPLICATA. */
  duplicate: boolean;
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

/**
 * Ticket de caisse : une seule mise en page pour l'aperçu à l'écran, l'impression thermique (ESC/POS) et
 * le PDF. QR code de la référence de vente en pied de ticket.
 */
export function layoutStockReceipt(data: StockReceiptData, paperWidth: PaperWidth): ReceiptLine[] {
  const w = charsPerLine(paperWidth);
  const money = (n: number) => formatStockMoney(n, data.currency);
  const sep: ReceiptLine = { text: '-'.repeat(w) };
  const out: ReceiptLine[] = [];
  if (data.duplicate) out.push({ text: '*** DUPLICATA ***', align: 'center', bold: true });
  for (const t of wrap(data.storeName, Math.floor(w / 2)))
    out.push({ text: t, align: 'center', bold: true, large: true });
  for (const t of data.address ? wrap(data.address, w) : []) out.push({ text: t, align: 'center' });
  if (data.phone) out.push({ text: `Tél. ${data.phone}`.slice(0, w), align: 'center' });
  out.push(sep);
  out.push({ text: columns(data.saleLabel, formatDate(data.date, data.timezone), w) });
  out.push({ text: `Caisse : ${data.registerName}`.slice(0, w) });
  out.push({ text: `Caissier : ${data.cashierName}`.slice(0, w) });
  if (data.customerName) out.push({ text: `Client : ${data.customerName}`.slice(0, w) });
  out.push(sep);
  for (const l of data.lines) {
    for (const t of wrap(l.label, w)) out.push({ text: t });
    out.push({
      text: columns(
        `  ${formatStockQuantity(l.quantity)} x ${money(l.unitPrice)}`,
        money(l.total + l.discount),
        w,
      ),
    });
    if (l.discount > 0) out.push({ text: columns('  Remise', `-${money(l.discount)}`, w) });
  }
  out.push(sep);
  if (data.discountTotal > 0) {
    out.push({ text: columns('Sous-total', money(data.grossTotal), w) });
    out.push({ text: columns('Remises', `-${money(data.discountTotal)}`, w) });
  }
  out.push({
    text: columns('TOTAL TTC', money(data.total), Math.floor(w / 2)),
    bold: true,
    large: true,
  });
  const vatByRate = new Map<number, number>();
  for (const l of data.lines)
    vatByRate.set(l.vatRate, (vatByRate.get(l.vatRate) ?? 0) + l.vatAmount);
  for (const [rate, amount] of [...vatByRate].sort((a, b) => a[0] - b[0])) {
    if (amount > 0) out.push({ text: columns(`dont TVA ${rate} %`, money(amount), w) });
  }
  out.push(sep);
  for (const p of data.payments) {
    out.push({
      text: columns(STOCK_PAYMENT_METHOD_LABELS[p.method], money(p.tendered ?? p.amount), w),
    });
    if (p.reference) out.push({ text: `  Réf. ${p.reference}`.slice(0, w) });
  }
  if (data.changeGiven > 0)
    out.push({ text: columns('Monnaie rendue', money(data.changeGiven), w) });
  out.push(sep);
  out.push({ text: data.saleLabel, qr: data.saleLabel });
  for (const t of data.footer ? wrap(data.footer, w) : ['Merci de votre visite !'])
    out.push({ text: t, align: 'center' });
  out.push({ text: 'Prix TTC', align: 'center' });
  return out;
}
