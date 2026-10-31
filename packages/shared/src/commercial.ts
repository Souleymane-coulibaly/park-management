/**
 * Site commercial Ocall Suite (Sprint 12A) : demandes de démonstration. Une demande ne crée
 * jamais d'abonnement ; elle est conservée 24 mois, puis anonymisée.
 */

export const DEMO_REQUEST_STATUS_LABELS = {
  NEW: 'Nouvelle',
  CONTACTED: 'Contactée',
  DEMO_SCHEDULED: 'Démonstration planifiée',
  WON: 'Gagnée',
  LOST: 'Perdue',
  SPAM: 'Indésirable',
} as const;
export type DemoRequestStatus = keyof typeof DEMO_REQUEST_STATUS_LABELS;

/** Conservation des demandes avant anonymisation. */
export const DEMO_REQUEST_RETENTION_MONTHS = 24;
/** Délai minimal de remplissage : en dessous, l'envoi est traité comme automatisé. */
export const DEMO_FORM_MIN_FILL_MS = 3_000;
/** Un formulaire affiché depuis plus longtemps doit être rechargé. */
export const DEMO_FORM_MAX_AGE_MS = 24 * 60 * 60_000;

/** Numéro lisible d'une demande : DEM-2026-00012. */
export function formatDemoRequestNumber(year: number, sequence: number): string {
  return `DEM-${year}-${String(sequence).padStart(5, '0')}`;
}

/**
 * Contrôles anti-spam (aucun service tiers) : champ piège rempli, envoi trop rapide ou formulaire
 * trop ancien. Renvoie la raison, ou null si la demande peut être enregistrée.
 */
export function demoSpamReason(
  input: { website?: string | null; startedAt: number },
  now: number = Date.now(),
): 'HONEYPOT' | 'TOO_FAST' | 'EXPIRED' | null {
  if (input.website && input.website.trim() !== '') return 'HONEYPOT';
  const age = now - input.startedAt;
  if (age < DEMO_FORM_MIN_FILL_MS) return 'TOO_FAST';
  if (age > DEMO_FORM_MAX_AGE_MS) return 'EXPIRED';
  return null;
}
