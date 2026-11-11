/**
 * Ocall Stock — étiquettes autocollantes : formats et contenu paramétrable. Rendu PDF à la taille exacte
 * de l'étiquette (une étiquette par page), imprimé par le dialogue d'impression du navigateur.
 */

export const STOCK_LABEL_FORMATS = ['40x30', '50x30', '60x40'] as const;
export type StockLabelFormat = (typeof STOCK_LABEL_FORMATS)[number];

export const STOCK_LABEL_SIZES: Record<StockLabelFormat, { widthMm: number; heightMm: number }> = {
  '40x30': { widthMm: 40, heightMm: 30 },
  '50x30': { widthMm: 50, heightMm: 30 },
  '60x40': { widthMm: 60, heightMm: 40 },
};

/** Éléments imprimables ; chacun s'active ou non. */
export const STOCK_LABEL_FIELDS = [
  'storeName',
  'productName',
  'variant',
  'reference',
  'barcode',
  'qrCode',
  'price',
] as const;
export type StockLabelField = (typeof STOCK_LABEL_FIELDS)[number];

export const STOCK_LABEL_FIELD_LABELS: Record<StockLabelField, string> = {
  storeName: 'Nom du magasin',
  productName: 'Nom de l’article',
  variant: 'Variante',
  reference: 'Référence',
  barcode: 'Code-barres',
  qrCode: 'QR code',
  price: 'Prix et devise',
};

export const STOCK_LABEL_DEFAULT_FIELDS: readonly StockLabelField[] = [
  'storeName',
  'productName',
  'variant',
  'barcode',
  'price',
];

/** Plafonds d'une impression : copies par article et étiquettes au total. */
export const STOCK_LABEL_MAX_COPIES = 200;
export const STOCK_LABEL_MAX_TOTAL = 1000;
