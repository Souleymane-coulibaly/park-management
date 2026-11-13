/**
 * Ocall Stock (S2) — sites, emplacements, mouvements, transferts, inventaires : règles partagées par l'API
 * et le web.
 */

export const STOCK_SITE_KINDS = ['STORE', 'DEPOT', 'WAREHOUSE'] as const;
export type StockSiteKind = (typeof STOCK_SITE_KINDS)[number];
export const STOCK_SITE_KIND_LABELS: Record<StockSiteKind, string> = {
  STORE: 'Magasin',
  DEPOT: 'Dépôt',
  WAREHOUSE: 'Entrepôt',
};

/** Niveaux d'emplacement, du plus large au plus fin (l'emplacement par défaut est à part). */
export const STOCK_LOCATION_KINDS = ['ZONE', 'AISLE', 'SHELF', 'BIN'] as const;
export type StockLocationKind = (typeof STOCK_LOCATION_KINDS)[number] | 'DEFAULT';
export const STOCK_LOCATION_KIND_LABELS: Record<StockLocationKind, string> = {
  DEFAULT: 'Général',
  ZONE: 'Zone',
  AISLE: 'Allée',
  SHELF: 'Rayonnage',
  BIN: 'Emplacement',
};

/** Code d'un site : 2 à 8 lettres ou chiffres majuscules (ENT1, BKO). */
export const STOCK_SITE_CODE_PATTERN = /^[A-Z0-9]{2,8}$/;
/** Code d'un emplacement, unique dans son site : A-01-03. */
export const STOCK_LOCATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,23}$/;
/** Code de l'emplacement par défaut de chaque site. */
export const STOCK_DEFAULT_LOCATION_CODE = 'GENERAL';

/** Vrai si un emplacement de type `child` peut être rangé dans un emplacement de type `parent`. */
export function stockLocationNests(parent: StockLocationKind, child: StockLocationKind): boolean {
  if (parent === 'DEFAULT' || child === 'DEFAULT') return false;
  return STOCK_LOCATION_KINDS.indexOf(parent) < STOCK_LOCATION_KINDS.indexOf(child);
}

/**
 * Contenu du QR code d'un emplacement : « L: » + code du site + « / » + code de l'emplacement. Il ne peut
 * pas être confondu avec un code-barres ou une référence d'article (deux-points interdits).
 */
export function stockLocationQr(siteCode: string, locationCode: string): string {
  return `L:${siteCode}/${locationCode}`;
}

export function parseStockLocationQr(
  code: string,
): { siteCode: string; locationCode: string } | null {
  const m = /^L:([A-Z0-9]{2,8})\/([A-Z0-9][A-Z0-9-]{0,23})$/.exec(code.trim().toUpperCase());
  return m ? { siteCode: m[1]!, locationCode: m[2]! } : null;
}

// ─── Mouvements ───

export const STOCK_MOVEMENT_KIND_LABELS: Record<string, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  ADJUSTMENT: 'Ajustement',
  MOVE_OUT: 'Déplacement (départ)',
  MOVE_IN: 'Déplacement (arrivée)',
  TRANSFER_OUT: 'Transfert expédié',
  TRANSFER_IN: 'Transfert reçu',
  COUNT: 'Inventaire',
  RECEIPT: 'Réception fournisseur',
  RECEIPT_CANCEL: 'Réception annulée',
  SUPPLIER_RETURN: 'Retour fournisseur',
};

/** Saisies manuelles possibles (les autres mouvements naissent d'une opération : transfert, inventaire). */
export const STOCK_MANUAL_MOVEMENT_KINDS = ['IN', 'OUT', 'ADJUSTMENT'] as const;
export type StockManualMovementKind = (typeof STOCK_MANUAL_MOVEMENT_KINDS)[number];

/** Quantité la plus grande saisissable en une fois, et précision (3 décimales : kg, litres). */
export const STOCK_MAX_QUANTITY = 1_000_000_000;

/** Quantité affichée : sans zéros inutiles (12, 2,5, 0,125). */
export function formatStockQuantity(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// ─── Transferts et inventaires ───

export const STOCK_TRANSFER_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Demandé',
  PREPARED: 'Préparé',
  SHIPPED: 'Expédié',
  PARTIALLY_RECEIVED: 'Reçu en partie',
  RECEIVED: 'Reçu',
  CANCELLED: 'Annulé',
};

export const STOCK_COUNT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'En cours',
  VALIDATED: 'Validé',
  CANCELLED: 'Annulé',
};

export const STOCK_COUNT_SCOPE_LABELS: Record<string, string> = {
  FULL: 'Complet (non compté = 0)',
  PARTIAL: 'Partiel (seuls les articles comptés)',
};

/** Numéro affiché d'un transfert ou d'un inventaire : TR-000012, INV-000003. */
export const stockTransferNumber = (n: number) => `TR-${String(n).padStart(6, '0')}`;
export const stockCountNumber = (n: number) => `INV-${String(n).padStart(6, '0')}`;

// ─── S3 : achats ───

export const STOCK_PURCHASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  ORDERED: 'Commandée',
  PARTIALLY_RECEIVED: 'Reçue en partie',
  RECEIVED: 'Reçue',
  CLOSED: 'Close',
  CANCELLED: 'Annulée',
};

/** Numéros affichés : commande BC-000007, réception REC-000012, retour RF-000002. */
export const stockPurchaseNumber = (n: number) => `BC-${String(n).padStart(6, '0')}`;
export const stockReceiptNumber = (n: number) => `REC-${String(n).padStart(6, '0')}`;
export const stockReturnNumber = (n: number) => `RF-${String(n).padStart(6, '0')}`;

/** Documents joints : PDF, JPEG ou PNG de 10 Mo au plus, 10 par pièce. */
export const STOCK_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const STOCK_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const STOCK_DOCUMENT_MAX_COUNT = 10;
