/**
 * Ocall Stock — codes-barres. Les codes GTIN (EAN-13, EAN-8, UPC-A) sont attribués par GS1 au fabricant :
 * Ocall Stock en vérifie le format et la clé de contrôle, mais n'en invente jamais. Un article sans GTIN
 * reçoit un code interne (préfixe de l'organisation et 8 chiffres), imprimé en Code 128 ou en QR code.
 */

export const STOCK_BARCODE_TYPES = ['EAN13', 'EAN8', 'UPCA', 'INTERNAL'] as const;
export type StockBarcodeType = (typeof STOCK_BARCODE_TYPES)[number];

export const STOCK_BARCODE_TYPE_LABELS: Record<StockBarcodeType, string> = {
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  UPCA: 'UPC-A',
  INTERNAL: 'Code interne',
};

const GTIN_LENGTH: Record<Exclude<StockBarcodeType, 'INTERNAL'>, number> = {
  EAN13: 13,
  EAN8: 8,
  UPCA: 12,
};

/** Clé de contrôle GS1 d'un numéro sans sa clé : pondération 3, 1, 3… depuis la droite. */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error('GTIN : chiffres uniquement.');
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    total += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (total % 10)) % 10;
}

/** Vrai si le code a la longueur du type et une clé de contrôle exacte. */
export function isValidGtin(type: Exclude<StockBarcodeType, 'INTERNAL'>, code: string): boolean {
  if (!/^\d+$/.test(code) || code.length !== GTIN_LENGTH[type]) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Code interne : préfixe de 2 à 4 lettres puis 8 chiffres (OC00000123). */
export const STOCK_INTERNAL_CODE_PATTERN = /^[A-Z]{2,4}\d{8}$/;

export function stockInternalCode(prefix: string, value: number): string {
  return `${prefix}${String(value).padStart(8, '0')}`;
}

/**
 * Nettoie une lecture de scanner : espaces et caractères de contrôle (préfixes ou suffixes ajoutés par
 * certains lecteurs) retirés. Retourne une chaîne vide si rien d'exploitable.
 */
export function normalizeScannedCode(raw: string): string {
  return raw.replace(/[\p{Cc}\p{Cf}\s]+/gu, '').slice(0, 64);
}

/**
 * Type probable d'un code numérique lu : EAN-13 (13 chiffres), UPC-A (12), EAN-8 (8), si la clé de
 * contrôle est exacte ; code interne s'il en a le format ; sinon null (référence ou code inconnu).
 */
export function detectBarcodeType(code: string): StockBarcodeType | null {
  if (STOCK_INTERNAL_CODE_PATTERN.test(code)) return 'INTERNAL';
  if (code.length === 13 && isValidGtin('EAN13', code)) return 'EAN13';
  if (code.length === 12 && isValidGtin('UPCA', code)) return 'UPCA';
  if (code.length === 8 && isValidGtin('EAN8', code)) return 'EAN8';
  return null;
}

/** Motif de refus d'un code saisi pour un type donné, sinon null. */
export function barcodeProblem(type: StockBarcodeType, code: string): string | null {
  if (type === 'INTERNAL') {
    return STOCK_INTERNAL_CODE_PATTERN.test(code)
      ? null
      : 'Code interne invalide : il est généré par Ocall Stock.';
  }
  const length = GTIN_LENGTH[type];
  if (!/^\d+$/.test(code) || code.length !== length) {
    return `${STOCK_BARCODE_TYPE_LABELS[type]} invalide : ${length} chiffres attendus.`;
  }
  if (!isValidGtin(type, code)) {
    return `${STOCK_BARCODE_TYPE_LABELS[type]} invalide : la clé de contrôle ne correspond pas (code mal saisi ou mal lu).`;
  }
  return null;
}

/**
 * Écritures équivalentes d'un même code GTIN : un UPC-A (12 chiffres) est aussi un EAN-13 précédé de 0, et
 * beaucoup de lecteurs le transmettent sous cette forme. Sert à la lecture et au contrôle des doublons.
 */
export function gtinEquivalents(code: string): string[] {
  if (/^\d{12}$/.test(code)) return [code, `0${code}`];
  if (/^0\d{12}$/.test(code)) return [code, code.slice(1)];
  return [code];
}
