/**
 * Contrat d'intégration Ocall Facture → Ocall Stock : demandes de mouvement (S5).
 *
 * Stock est la seule source des quantités : Facture ne touche jamais un stock, il demande. Une demande est
 * identifiée par une clé unique (celle de la file de sortie de Facture) : la rejouer n'a aucun effet. Stock
 * l'applique en une seule transaction (toutes ses lignes ou aucune), à l'emplacement des ventes Facture
 * réglé dans Stock, et en garde la trace.
 *
 * Le module Stock fournit l'implémentation sous le jeton `STOCK_MOVEMENT_GATEWAY` ; Facture l'injecte en
 * facultatif (`@Optional()`), car Stock peut être désactivé.
 */

export const STOCK_MOVEMENT_GATEWAY = Symbol('STOCK_MOVEMENT_GATEWAY');

export type StockMovementSource = 'INVOICE' | 'INTERVENTION' | 'CREDIT_NOTE';

export interface StockMovementRequest {
  organizationId: string;
  /** Clé unique de la demande : « facture-invoice:<document> », « facture-part:<intervention> »… */
  key: string;
  source: StockMovementSource;
  /** Document ou intervention d'origine (Facture). */
  sourceId: string;
  /** Numéro lisible du document d'origine. */
  reference: string;
  /** Auteur de l'émission ou de la signature. */
  actorUserId: string;
  /** Quantités signées : négative = sortie (facture, pièces), positive = retour (avoir). */
  lines: { variantId: string; quantity: number }[];
}

export interface StockMovementResult {
  /** Vrai si la demande avait déjà été appliquée : rien n'a été modifié. */
  replayed: boolean;
}

/** Refus de Stock : `permanent` = inutile de réessayer seul (le gérant corrige, puis relance). */
export class StockMovementError extends Error {
  constructor(
    readonly code:
      | 'STOCK_UNAVAILABLE'
      | 'STOCK_LOCATION_NOT_SET'
      | 'STOCK_INSUFFICIENT'
      | 'STOCK_VARIANT_NOT_FOUND',
    message: string,
    readonly permanent = true,
  ) {
    super(message);
    this.name = 'StockMovementError';
  }
}

export interface StockMovementGateway {
  /** Vrai si Stock accepte des mouvements pour l'organisation (application activée, abonnement en cours). */
  canWrite(organizationId: string): Promise<boolean>;
  /** Applique la demande (une seule fois par clé). Lève `StockMovementError` en cas de refus. */
  apply(request: StockMovementRequest): Promise<StockMovementResult>;
}
