/**
 * Règles du module Restaurant (Sprint 5) : canaux de commande, cycle de préparation, commandes QR,
 * salles et tables, stocks et réservations. Partagé entre l'API (autorité) et l'interface.
 */

// ─── Commandes ───

export const ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'COUNTER', 'QR', 'KIOSK'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
/** Canaux qu'un employé choisit à la caisse ; QR est réservé aux demandes clients validées. */
export const STAFF_ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'COUNTER'] as const;
export type StaffOrderChannel = (typeof STAFF_ORDER_CHANNELS)[number];

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  DINE_IN: 'Sur place',
  TAKEAWAY: 'À emporter',
  COUNTER: 'Comptoir',
  QR: 'QR code client',
  KIOSK: 'Borne de commande',
};

/** Longueur maximale d'une instruction de préparation (ligne ou commande). */
export const MAX_NOTE_LENGTH = 200;

/**
 * Cycle de préparation, indépendant du paiement. Seule l'action explicite « Envoyer en cuisine »
 * fait quitter NOT_SENT ; un paiement ne modifie jamais ce statut.
 */
export const PREPARATION_FLOW = ['NOT_SENT', 'SENT', 'IN_PREPARATION', 'READY', 'SERVED'] as const;
export type PreparationStatus = (typeof PREPARATION_FLOW)[number];

/** Actions de préparation et statut atteint. */
export const PREPARATION_ACTIONS = {
  send: 'SENT',
  start: 'IN_PREPARATION',
  ready: 'READY',
  serve: 'SERVED',
} as const satisfies Record<string, PreparationStatus>;
export type PreparationAction = keyof typeof PREPARATION_ACTIONS;

/** Statuts de départ autorisés pour chaque action. */
const ALLOWED_FROM: Record<PreparationAction, readonly PreparationStatus[]> = {
  send: ['NOT_SENT'],
  start: ['SENT'],
  // La cuisine peut marquer « prête » sans étape « en préparation ».
  ready: ['SENT', 'IN_PREPARATION'],
  serve: ['READY'],
};

export type TransitionDecision =
  | { kind: 'apply'; to: PreparationStatus }
  /** Déjà au statut visé ou au-delà : requête rejouée, aucune modification (idempotence). */
  | { kind: 'noop' }
  | { kind: 'refuse'; code: 'ORDER_NOT_SENT' | 'ORDER_NOT_READY' | 'INVALID_TRANSITION' };

/**
 * Décide d'une transition de préparation. Une action rejouée (statut déjà atteint ou dépassé) est
 * un « noop » : elle ne crée ni doublon ni retour en arrière.
 */
export function decidePreparationTransition(
  current: PreparationStatus,
  action: PreparationAction,
): TransitionDecision {
  const target = PREPARATION_ACTIONS[action];
  if (PREPARATION_FLOW.indexOf(current) >= PREPARATION_FLOW.indexOf(target)) {
    return { kind: 'noop' };
  }
  if (ALLOWED_FROM[action].includes(current)) return { kind: 'apply', to: target };
  if (current === 'NOT_SENT') return { kind: 'refuse', code: 'ORDER_NOT_SENT' };
  if (action === 'serve') return { kind: 'refuse', code: 'ORDER_NOT_READY' };
  return { kind: 'refuse', code: 'INVALID_TRANSITION' };
}

/** Statuts visibles sur l'écran cuisine : jamais une commande non envoyée. */
export const KITCHEN_VISIBLE_STATUSES = ['SENT', 'IN_PREPARATION', 'READY'] as const;

// ─── Commandes par QR code ───

export const QR_ORDER_STATUSES = ['PENDING_VALIDATION', 'ACCEPTED', 'REJECTED'] as const;
export type QrOrderStatus = (typeof QR_ORDER_STATUSES)[number];

/** Origine d'une demande client : QR code de table ou de zone, ou borne libre-service. */
export const ORDER_REQUEST_SOURCES = ['QR', 'KIOSK'] as const;
export type OrderRequestSource = (typeof ORDER_REQUEST_SOURCES)[number];

export const QR_ORDER_STATUS_LABELS: Record<QrOrderStatus, string> = {
  PENDING_VALIDATION: 'En attente de validation',
  ACCEPTED: 'Acceptée',
  REJECTED: 'Refusée',
};

/** Au-delà de ce délai, une demande non traitée n'est plus comptée comme « en attente ». */
export const QR_REQUEST_PENDING_WINDOW_MINUTES = 120;
/** Demandes en attente simultanées par point de commande (table ou zone) : protection anti-abus. */
export const MAX_PENDING_QR_REQUESTS_PER_POINT = 5;
/** Une demande client reste modeste : au plus 30 lignes et 20 unités par ligne. */
export const MAX_QR_LINES = 30;
export const MAX_QR_LINE_QUANTITY = 20;

/** Jeton d'un QR de table ou de zone : 128 bits aléatoires en base64url (22 caractères). */
export const DINING_QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Chemin du menu public ouvert par le QR code. */
export function publicMenuPath(qrToken: string): string {
  return `/commande/${qrToken}`;
}

/** Chemin du suivi d'une demande de commande, par son jeton public. */
export function publicOrderStatusPath(publicToken: string): string {
  return `/commande/suivi/${publicToken}`;
}

// ─── Salles, zones et tables ───

export const DINING_ZONE_KINDS = ['ROOM', 'TERRACE', 'POOLSIDE', 'CUSTOM'] as const;
export type DiningZoneKind = (typeof DINING_ZONE_KINDS)[number];

export const DINING_ZONE_KIND_LABELS: Record<DiningZoneKind, string> = {
  ROOM: 'Salle',
  TERRACE: 'Terrasse',
  POOLSIDE: 'Bord de piscine',
  CUSTOM: 'Espace personnalisé',
};

export const TABLE_STATUSES = ['FREE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  FREE: 'Libre',
  OCCUPIED: 'Occupée',
  RESERVED: 'Réservée',
  OUT_OF_SERVICE: 'Hors service',
};

// ─── Stocks ───

export const STOCK_UNITS = ['UNIT', 'G', 'KG', 'ML', 'CL', 'L'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  UNIT: 'pièce',
  G: 'g',
  KG: 'kg',
  ML: 'ml',
  CL: 'cl',
  L: 'l',
};

export const STOCK_MOVEMENT_KINDS = ['IN', 'OUT', 'ADJUSTMENT', 'SALE'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];
/** Mouvements saisis à la main (SALE est produit uniquement par une vente). */
export const MANUAL_STOCK_MOVEMENT_KINDS = ['IN', 'OUT', 'ADJUSTMENT'] as const;
export type ManualStockMovementKind = (typeof MANUAL_STOCK_MOVEMENT_KINDS)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  ADJUSTMENT: 'Ajustement d’inventaire',
  SALE: 'Consommation (vente)',
};

/** Quantités de stock : 3 décimales au plus, plafond de sécurité. */
export const STOCK_DECIMALS = 3;
export const MAX_STOCK_QUANTITY = 1_000_000_000;

/** Arrondit une quantité de stock à 3 décimales (évite 0.30000000000000004). */
export function roundStock(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Vrai si la quantité a au plus 3 décimales et reste dans le plafond (valeur absolue). */
export function isValidStockQuantity(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_STOCK_QUANTITY &&
    Math.abs(roundStock(value) - value) < 1e-9
  );
}

/** Alerte de stock : quantité au niveau du seuil ou en dessous (sans seuil, aucune alerte). */
export function isStockLow(quantity: number, alertThreshold: number | null): boolean {
  return alertThreshold !== null && quantity <= alertThreshold;
}

// ─── Réservations ───

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmée',
  CANCELLED: 'Annulée',
  COMPLETED: 'Terminée',
  NO_SHOW: 'Non présentée',
};

/** Statuts qui occupent la table : une réservation annulée ou terminée libère le créneau. */
export const BLOCKING_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED'] as const;

export const DEFAULT_RESERVATION_MINUTES = 90;
export const MIN_RESERVATION_MINUTES = 15;
export const MAX_RESERVATION_MINUTES = 12 * 60;
export const MAX_PARTY_SIZE = 200;

/** Deux créneaux [début, fin[ se chevauchent ; des créneaux bout à bout ne sont pas en conflit. */
export function slotsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
