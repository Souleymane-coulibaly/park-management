/**
 * Contrat d'intégration Ocall Facture ↔ Ocall Stock (seul lien entre les deux modules).
 *
 * Sens unique pour les articles : Stock → Facture, en lecture seule. Facture ne modifie jamais un article
 * Stock ; Stock ne modifie jamais un document Facture. Les demandes de mouvement de stock (déstockage à
 * l'émission d'une facture, retours) passeront par un contrat distinct, idempotent, au sprint S5.
 *
 * Le module Stock fournit l'implémentation sous le jeton `STOCK_CATALOG_READER` (module global) ; un
 * consommateur l'injecte en facultatif (`@Optional()`), car Stock peut être désactivé.
 */

export const STOCK_CATALOG_READER = Symbol('STOCK_CATALOG_READER');

/** Article vendable d'Ocall Stock, tel qu'une autre application peut le lire. */
export interface StockCatalogEntry {
  variantId: string;
  productId: string;
  sku: string;
  /** Nom de l'article, suivi de la variante s'il y en a une (« Peinture blanche — 5 L »). */
  label: string;
  description: string | null;
  unit: string;
  /** Prix de vente TTC du jour, entier dans la devise de l'organisation. */
  salePrice: number;
  vatRate: number;
  /** Code-barres principal (fabricant, sinon interne) ; null s'il n'y en a pas. */
  barcode: string | null;
  isStockable: boolean;
  isArchived: boolean;
}

export interface StockCatalogReader {
  /**
   * Vrai si Ocall Stock est activé et que l'organisation y a droit (essai, abonnement, ou consultation
   * seule après échéance : ses articles restent lisibles).
   */
  isAvailable(organizationId: string): Promise<boolean>;
  /** Recherche (nom, référence, code-barres) parmi les articles non archivés, 50 résultats au plus. */
  search(organizationId: string, q: string, limit: number): Promise<StockCatalogEntry[]>;
  /** Articles désignés, de cette organisation seulement (les autres identifiants sont ignorés). */
  variants(organizationId: string, variantIds: readonly string[]): Promise<StockCatalogEntry[]>;
}
