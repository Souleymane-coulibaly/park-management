/**
 * Contrat d'intégration Ocall Facture ↔ Ocall Stock (seul lien entre les deux modules).
 *
 * Sens unique pour les articles : Stock → Facture, en lecture seule. Facture ne modifie jamais un article
 * Stock ; Stock ne modifie jamais un document Facture. Les demandes de mouvement de stock (déstockage à
 * l'émission d'une facture, retours) passent par un contrat distinct et idempotent (`stock-movements.ts`).
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
  /**
   * Disponible (en stock − réservé) à l'emplacement des ventes Facture, par article. Droits vérifiés côté
   * Stock : null si ce compte n'a pas le droit de consulter les stocks, ou si l'emplacement n'est pas réglé.
   */
  availability(
    organizationId: string,
    userId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, number> | null>;
  /**
   * Vente en caisse à facturer (numéro « VTE-000123 » ou identifiant), de cette organisation seulement.
   * Droits vérifiés côté Stock (consulter les ventes) ; null si introuvable ou non autorisée.
   */
  sale(organizationId: string, userId: string, ref: string): Promise<StockSaleForInvoice | null>;
}

/** Vente en caisse lue par Facture : quantités nettes des retours déjà faits en caisse. */
export interface StockSaleForInvoice {
  id: string;
  /** « VTE-000123 ». */
  number: string;
  createdAt: Date;
  customer: { name: string; phone: string | null; email: string | null } | null;
  /** Total TTC encaissé. */
  total: number;
  lines: {
    variantId: string;
    productId: string;
    sku: string;
    label: string;
    unit: string;
    /** Quantité vendue moins la quantité déjà reprise en caisse. */
    quantity: number;
    /** Montant TTC restant de la ligne (après remise et remboursements). */
    total: number;
    vatRate: number;
    isStockable: boolean;
  }[];
}
