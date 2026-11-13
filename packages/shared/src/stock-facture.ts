/**
 * Ocall Stock ↔ Ocall Facture (S5) : règles partagées par l'API et le web.
 *
 * Stock est la seule source des quantités. Facture ne demande un mouvement qu'à trois moments :
 * l'émission d'une facture, la signature d'une intervention (pièces posées), l'émission d'un avoir
 * « marchandise retournée ». Chaque demande ne porte que ce qui n'a pas déjà été déstocké ailleurs.
 */

export const STOCK_FACTURE_SOURCES = ['INVOICE', 'INTERVENTION', 'CREDIT_NOTE'] as const;
export type StockFactureSource = (typeof STOCK_FACTURE_SOURCES)[number];

export const STOCK_FACTURE_SOURCE_LABELS: Record<StockFactureSource, string> = {
  INVOICE: 'Facture émise',
  INTERVENTION: 'Pièces d’une intervention signée',
  CREDIT_NOTE: 'Avoir — marchandise retournée',
};

/**
 * État de la synchronisation d'un document avec Stock :
 * - PENDING : en file, transmis sous peu (nouvelles tentatives espacées en cas d'incident) ;
 * - DONE : mouvements enregistrés dans Stock (ou rien à déstocker : déjà fait par la source) ;
 * - FAILED : refusé ou tentatives épuisées, visible du gérant, qui peut relancer ;
 * - SKIPPED : Stock indisponible à l'émission (abonnement échu) : « stock non mis à jour », définitif.
 */
export const STOCK_FACTURE_SYNC_STATUSES = ['PENDING', 'DONE', 'FAILED', 'SKIPPED'] as const;
export type StockFactureSyncStatus = (typeof STOCK_FACTURE_SYNC_STATUSES)[number];

export const STOCK_FACTURE_SYNC_LABELS: Record<StockFactureSyncStatus, string> = {
  PENDING: 'Stock : mise à jour en cours',
  DONE: 'Stock mis à jour',
  FAILED: 'Stock : synchronisation en échec',
  SKIPPED: 'Stock non mis à jour',
};

/** Motifs d'échec renvoyés par Stock, en clair pour le gérant. */
export const STOCK_FACTURE_ERROR_LABELS: Record<string, string> = {
  STOCK_INSUFFICIENT: 'Stock insuffisant à l’emplacement des ventes Facture',
  STOCK_LOCATION_NOT_SET: 'Emplacement des ventes Facture non réglé dans Ocall Stock',
  STOCK_UNAVAILABLE: 'Ocall Stock indisponible (abonnement échu ou application désactivée)',
  STOCK_VARIANT_NOT_FOUND: 'Article Stock introuvable',
  ATTEMPTS_EXHAUSTED: 'Nouvelles tentatives épuisées',
};

/** Tentatives automatiques avant l'état « en échec » (incidents passagers seulement). */
export const STOCK_FACTURE_MAX_ATTEMPTS = 6;

/** Délai avant la tentative suivante : 1, 2, 4, 8, 16 min… (plafonné à une heure). */
export function stockFactureRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

/** Prix TTC (Stock) → prix unitaire hors taxe (Facture), en unités entières de la devise. */
export function stockTtcToHt(ttc: number, vatRate: number): number {
  return Math.round((ttc * 100) / (100 + vatRate));
}

/** Une ligne de mouvement demandée : article Stock et quantité signée (négative = sortie). */
export interface StockFactureLine {
  variantId: string;
  quantity: number;
}

/** Quantités manipulées en millièmes (3 décimales) : aucune erreur d'arrondi en virgule flottante. */
const milli = (q: number) => Math.round(q * 1000);

/** Somme des quantités par article (millièmes). */
export function stockQuantitiesByVariant(
  lines: readonly { variantId: string | null; quantity: number }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!l.variantId) continue;
    m.set(l.variantId, (m.get(l.variantId) ?? 0) + milli(l.quantity));
  }
  return m;
}

/**
 * Ce qu'une facture doit encore déstocker : ses quantités par article, moins ce que sa source a déjà sorti
 * (vente en caisse facturée, pièces d'une intervention signée). Jamais de quantité négative : une facture
 * ne remet rien en stock (seul un avoir « marchandise retournée » le fait).
 */
export function stockFactureNetExit(
  wanted: ReadonlyMap<string, number>,
  covered: ReadonlyMap<string, number>,
): StockFactureLine[] {
  const out: StockFactureLine[] = [];
  for (const [variantId, q] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    const net = q - (covered.get(variantId) ?? 0);
    if (net > 0) out.push({ variantId, quantity: -net / 1000 });
  }
  return out;
}

/**
 * Remise en stock d'un avoir « marchandise retournée » : par article, jamais plus que ce qui est sorti du
 * stock pour la facture (sa demande et celle de sa source), moins ce que les avoirs précédents ont déjà
 * remis. `out` et `returned` sont en millièmes, positifs.
 */
export function stockFactureReturn(
  credited: ReadonlyMap<string, number>,
  out: ReadonlyMap<string, number>,
  returned: ReadonlyMap<string, number>,
): StockFactureLine[] {
  const lines: StockFactureLine[] = [];
  for (const [variantId, q] of [...credited].sort(([a], [b]) => a.localeCompare(b))) {
    const left = (out.get(variantId) ?? 0) - (returned.get(variantId) ?? 0);
    const back = Math.min(q, left);
    if (back > 0) lines.push({ variantId, quantity: back / 1000 });
  }
  return lines;
}
