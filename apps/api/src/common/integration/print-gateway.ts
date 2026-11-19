import type {
  PrintCardData,
  PrintCardKind,
  PrintItemStatus,
  PrintLayout,
  PrintOrderStatus,
  PrintSourceApp,
} from '@ocall/shared';

/**
 * Contrat d'intégration Ocall Print (seul lien entre une application source et le moteur commun de cartes).
 *
 * Ocall Print ne connaît ni les élèves ni les pass : l'application source (Ocall School aujourd'hui,
 * Ocall Parc et Sabatii demain) vérifie ELLE-MÊME les droits de l'utilisateur sur ses fiches, puis confie
 * au moteur des titulaires (`holderKind`, `holderId`) et leurs données au format `ocall-print/card@1`.
 * Print garde ce qui est commun : modèles recto verso, rendu (aperçu, bon à tirer, production), numéros
 * et QR signés, commandes, suivi de production, encaissement à la livraison, purge des fichiers.
 *
 * Isolation : chaque appel porte l'organisation de l'utilisateur ; Print ne lit et n'écrit que dans cette
 * organisation, et dans le périmètre (`scopeIds`, par exemple les établissements School visibles) que
 * l'application source lui transmet. Le module Print fournit l'implémentation sous le jeton
 * `PRINT_GATEWAY` (module global) ; un consommateur l'injecte en facultatif (`@Optional()`), car Print
 * peut être désactivé (`enabled()` vaut alors false et la fonction de carte est indisponible).
 */

export const PRINT_GATEWAY = Symbol('PRINT_GATEWAY');

export interface PrintActor {
  organizationId: string;
  userId: string;
}

/** Périmètre d'une application source : `scopeIds` null = tout le périmètre de l'organisation. */
export interface PrintScope {
  sourceApp: PrintSourceApp;
  scopeIds: string[] | null;
}

/** Données d'une carte fournies par la source ; Print ajoute le format, le numéro et le QR. */
export type PrintCardContent = Omit<PrintCardData, 'format' | 'kind' | 'cardNumber' | 'qr'>;

export interface PrintTemplateSummary {
  id: string;
  name: string;
  kind: PrintCardKind;
  scopeId: string | null;
  currentVersion: number;
  layout: PrintLayout;
  hasLogo: boolean;
  archivedAt: string | null;
  updatedAt: string;
}

export interface PrintCardSummary {
  id: string;
  cardNumber: string;
  status: 'ACTIVE' | 'REVOKED';
  holderKind: PrintCardKind;
  holderId: string;
  sourceApp: string;
  scopeId: string | null;
  validUntil: string | null;
  replacesCardId: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  /** Dernière ligne de commande de la carte (la plus récente), ou null si jamais commandée. */
  print: {
    orderId: string;
    orderNumber: string;
    orderStatus: PrintOrderStatus;
    itemStatus: PrintItemStatus;
    rejectReason: string | null;
  } | null;
}

export interface PrintDelivery {
  address: string;
  contactName: string;
  contactPhone: string;
  note: string | null;
}

export interface PrintOrderSummary {
  id: string;
  number: string;
  sourceApp: string;
  scopeId: string | null;
  kind: PrintCardKind;
  status: PrintOrderStatus;
  unitPrice: number;
  currency: string;
  quantity: number;
  totalAmount: number;
  paymentStatus: 'UNPAID' | 'PAID';
  paidAmount: number | null;
  paidAt: string | null;
  submittedAt: string;
  updatedAt: string;
  filesPurged: boolean;
}

export interface PrintOrderItemView {
  id: string;
  cardId: string;
  cardNumber: string;
  holderKind: PrintCardKind;
  /** Nom du titulaire ; null une fois les fichiers de production purgés. */
  holderLabel: string | null;
  status: PrintItemStatus;
  rejectReason: string | null;
}

export interface PrintOrderEventView {
  type: string;
  actorKind: string;
  createdAt: string;
  details: Record<string, unknown>;
}

export interface PrintOrderDetail extends PrintOrderSummary {
  templateName: string;
  templateVersion: number;
  delivery: PrintDelivery;
  acceptedAt: string | null;
  productionAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  rejectedAt: string | null;
  closedReason: string | null;
  paymentReference: string | null;
  items: PrintOrderItemView[];
  events: PrintOrderEventView[];
}

/** Fiche de l'accès autonome, telle qu'une application peut la reprendre (activation d'Ocall School). */
export interface PrintPersonExport {
  id: string;
  kind: PrintCardKind;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  reference: string | null;
  groupLabel: string | null;
  jobTitle: string | null;
  birthDate: string | null;
  hasPhoto: boolean;
  activeCardNumber: string | null;
}

export interface PrintGateway {
  enabled(): boolean;

  // ─── Modèles ───
  listTemplates(actor: PrintActor, scope: PrintScope): Promise<PrintTemplateSummary[]>;
  createTemplate(
    actor: PrintActor,
    target: { sourceApp: PrintSourceApp; scopeId: string | null },
    input: { name: string; kind: PrintCardKind; layout: unknown },
  ): Promise<PrintTemplateSummary>;
  updateTemplate(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    input: { name?: string; layout?: unknown },
  ): Promise<PrintTemplateSummary>;
  setTemplateLogo(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    file: Buffer | null,
  ): Promise<PrintTemplateSummary>;
  archiveTemplate(actor: PrintActor, scope: PrintScope, id: string): Promise<void>;
  /** Aperçu recto verso (SVG) d'un modèle, avec des données fictives ou celles d'un titulaire. */
  previewTemplate(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    sample: { content: PrintCardContent; photo: Buffer | null } | null,
  ): Promise<{ front: string; back: string }>;

  // ─── Cartes ───
  /**
   * Crée la carte de chaque titulaire, ou renvoie sa carte active : jamais deux cartes actives pour un
   * même titulaire (index unique en base, sûr en accès concurrent).
   */
  issueCards(
    actor: PrintActor,
    sourceApp: PrintSourceApp,
    holders: {
      holderKind: PrintCardKind;
      holderId: string;
      scopeId: string | null;
      validUntil: string | null;
    }[],
  ): Promise<PrintCardSummary[]>;
  listCards(
    actor: PrintActor,
    scope: PrintScope,
    filter: {
      holderKind?: PrintCardKind;
      holderIds?: string[];
      cardIds?: string[];
      status?: 'ACTIVE' | 'REVOKED';
    },
  ): Promise<PrintCardSummary[]>;
  revokeCard(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    reason: string,
  ): Promise<PrintCardSummary>;
  /** Révoque la carte et en émet une nouvelle (nouveau numéro, nouveau QR) pour le même titulaire. */
  replaceCard(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    reason: string,
  ): Promise<PrintCardSummary>;
  /** Révoque les cartes actives d'un titulaire (départ d'un élève, désactivation d'un agent). */
  revokeHolderCards(
    actor: PrintActor,
    sourceApp: PrintSourceApp,
    holderKind: PrintCardKind,
    holderId: string,
    reason: string,
  ): Promise<number>;
  /**
   * Carte d'un QR authentique de l'organisation de l'utilisateur ; null pour un QR falsifié, inconnu ou
   * d'une autre organisation (aucune différence visible entre ces cas).
   */
  verifyCard(actor: PrintActor, qr: string): Promise<PrintCardSummary | null>;
  /** Aperçu recto verso (SVG) d'une carte avec un modèle. */
  cardPreview(
    actor: PrintActor,
    scope: PrintScope,
    cardId: string,
    templateId: string,
    content: PrintCardContent,
    photo: Buffer | null,
  ): Promise<{ front: string; back: string }>;

  // ─── Commandes ───
  submitOrder(
    actor: PrintActor,
    target: { sourceApp: PrintSourceApp; scopeId: string | null; establishmentId: string | null },
    input: {
      templateId: string;
      idempotencyKey: string;
      delivery: PrintDelivery;
      items: { cardId: string; content: PrintCardContent; photo: Buffer | null }[];
    },
  ): Promise<PrintOrderDetail>;
  listOrders(
    actor: PrintActor,
    scope: PrintScope,
    filter: { status?: PrintOrderStatus },
  ): Promise<PrintOrderSummary[]>;
  getOrder(actor: PrintActor, scope: PrintScope, id: string): Promise<PrintOrderDetail>;
  cancelOrder(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    reason: string,
  ): Promise<PrintOrderDetail>;
  /** Bon à tirer PDF d'une commande (données figées) ; indisponible après la purge des fichiers. */
  orderProofPdf(actor: PrintActor, scope: PrintScope, id: string): Promise<Buffer>;

  // ─── Reprise des fiches de l'accès autonome (activation d'Ocall School) ───
  transferablePersons(actor: PrintActor): Promise<PrintPersonExport[]>;
  personPhoto(actor: PrintActor, personId: string): Promise<Buffer | null>;
  /**
   * Termine la reprise d'une fiche : elle est marquée reprise (jamais deux fois) et ses cartes passent à
   * l'application cible, numéro et QR conservés : aucune carte n'est à réimprimer.
   */
  completeTransfer(
    actor: PrintActor,
    personId: string,
    target: { sourceApp: PrintSourceApp; holderId: string; scopeId: string | null },
  ): Promise<void>;
}

/** Nom affiché d'un titulaire dans les listes (atelier, suivi). */
export const printHolderLabel = (c: Pick<PrintCardContent, 'holder'>) =>
  `${c.holder.lastName.toUpperCase()} ${c.holder.firstName}`.trim();
