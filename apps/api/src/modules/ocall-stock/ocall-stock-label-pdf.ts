import bwipjs from 'bwip-js';
import {
  STOCK_LABEL_SIZES,
  type StockBarcodeType,
  type StockLabelField,
  type StockLabelFormat,
} from '@ocall/shared';
import { renderPdfDocument } from '../../common/pdf/pdf-document';

const MM = 72 / 25.4;

/** Symbologie imprimée : code du fabricant tel quel, sinon Code 128 (code interne ou référence). */
export type LabelSymbology = 'ean13' | 'ean8' | 'upca' | 'code128';

export function symbologyFor(type: StockBarcodeType | null): LabelSymbology {
  if (type === 'EAN13') return 'ean13';
  if (type === 'EAN8') return 'ean8';
  if (type === 'UPCA') return 'upca';
  return 'code128';
}

/** Code-barres en PNG (texte lisible sous les barres), haute résolution pour l'impression thermique. */
export function renderBarcodePng(symbology: LabelSymbology, text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: symbology,
    text,
    scale: 4,
    height: 10,
    includetext: true,
    textxalign: 'center',
    textsize: 9,
    // Fond blanc et zone de silence autour des barres : exigés par les lecteurs (et par l'impression).
    backgroundcolor: 'FFFFFF',
    paddingwidth: 10,
    paddingheight: 2,
  });
}

/** QR code en PNG : il contient le code lu par Ocall Stock (code-barres ou référence). */
export function renderQrPng(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'qrcode',
    text,
    scale: 4,
    backgroundcolor: 'FFFFFF',
    paddingwidth: 4,
    paddingheight: 4,
  });
}

export interface LabelContent {
  storeName: string;
  productName: string;
  variantName: string | null;
  reference: string;
  /** Code imprimé en barres et en QR : code-barres de la variante, sinon sa référence. */
  code: string;
  symbology: LabelSymbology;
  price: string;
  copies: number;
}

/**
 * Étiquettes à la taille exacte du format (une étiquette par page, adapté aux imprimantes d'étiquettes et
 * à l'impression sur planche) ; seuls les éléments choisis sont imprimés.
 */
export async function renderLabelsPdf(
  format: StockLabelFormat,
  fields: readonly StockLabelField[],
  labels: readonly LabelContent[],
): Promise<Buffer> {
  const show = new Set(fields);
  const { widthMm, heightMm } = STOCK_LABEL_SIZES[format];
  const W = widthMm * MM;
  const H = heightMm * MM;
  const pad = 1.5 * MM;
  // Images préparées avant le rendu (une par code, réutilisée pour toutes les copies).
  const bars = new Map<string, Buffer>();
  const qrs = new Map<string, Buffer>();
  for (const l of labels) {
    if (show.has('barcode') && !bars.has(`${l.symbology}:${l.code}`)) {
      bars.set(`${l.symbology}:${l.code}`, await renderBarcodePng(l.symbology, l.code));
    }
    if (show.has('qrCode') && !qrs.has(l.code)) qrs.set(l.code, await renderQrPng(l.code));
  }
  return renderPdfDocument({ title: 'Étiquettes', creator: 'Ocall Stock' }, (doc) => {
    for (const l of labels) {
      for (let copy = 0; copy < l.copies; copy++) {
        doc.addPage({ size: [W, H], margin: 0 });
        const barH = show.has('barcode') ? Math.min(11 * MM, H * 0.38) : 0;
        const qrSize = show.has('qrCode')
          ? Math.min(show.has('barcode') ? H - barH - 2 * pad : H - 2 * pad, 16 * MM)
          : 0;
        const textW = W - 2 * pad - (qrSize ? qrSize + pad : 0);
        let y = pad;
        const line = (text: string, size: number, bold = false, lines = 1) => {
          if (!text) return;
          doc
            .font(bold ? 'sansBold' : 'sans')
            .fontSize(size)
            .fillColor('#000000');
          const height = size * 1.15 * lines;
          doc.text(text, pad, y, { width: textW, height, ellipsis: true, lineGap: 0 });
          y += Math.min(doc.heightOfString(text, { width: textW }), height);
        };
        if (show.has('storeName')) line(l.storeName, 5.5, true);
        if (show.has('productName')) line(l.productName, format === '60x40' ? 8 : 7, true, 2);
        if (show.has('variant') && l.variantName) line(l.variantName, 6);
        if (show.has('reference')) line(`Réf. ${l.reference}`, 5.5);
        if (show.has('price')) {
          const size = format === '60x40' ? 12 : 10;
          doc.font('sansBold').fontSize(size).fillColor('#000000');
          const priceY = H - pad - barH - size * 1.2 - (barH ? 0.5 * MM : 0);
          doc.text(l.price, pad, Math.max(y, priceY), {
            width: textW,
            align: 'left',
            lineBreak: false,
          });
        }
        if (qrSize) {
          doc.image(qrs.get(l.code)!, W - pad - qrSize, pad, { width: qrSize, height: qrSize });
        }
        if (barH) {
          doc.image(bars.get(`${l.symbology}:${l.code}`)!, pad, H - pad - barH, {
            fit: [W - 2 * pad, barH],
            align: 'center',
            valign: 'bottom',
          });
        }
      }
    }
  });
}
