/**
 * Ocall Facture — interventions (F3) : statuts et transitions, temps passé, numérotation, droits d'un
 * technicien. Règles partagées par l'API et le web ; la base les tient aussi (déclencheurs).
 */
import { type FactureRole, hasFacturePermission } from './facture';

export const FACTURE_INTERVENTION_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'SIGNED',
  'INVOICED',
  'CANCELLED',
] as const;
export type FactureInterventionStatus = (typeof FACTURE_INTERVENTION_STATUSES)[number];

export const FACTURE_INTERVENTION_STATUS_LABELS: Record<FactureInterventionStatus, string> = {
  PLANNED: 'Planifiée',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Réalisée',
  SIGNED: 'Signée',
  INVOICED: 'Facturée',
  CANCELLED: 'Annulée',
};

/**
 * Transitions permises : planifiée → en cours → réalisée → signée → facturée ; une intervention réalisée
 * mais pas encore signée peut être rouverte ; seules une intervention planifiée ou en cours s'annulent.
 */
const TRANSITIONS: Record<FactureInterventionStatus, readonly FactureInterventionStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['SIGNED', 'IN_PROGRESS'],
  SIGNED: ['INVOICED'],
  INVOICED: [],
  CANCELLED: [],
};

export function canMoveFactureIntervention(
  from: FactureInterventionStatus,
  to: FactureInterventionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Planning (créneau, techniciens, client, équipement, demande) modifiable : avant la fin des travaux. */
export const isFactureInterventionPlanningOpen = (status: FactureInterventionStatus) =>
  status === 'PLANNED' || status === 'IN_PROGRESS';

/** Temps, pièces et photos : saisis pendant les travaux seulement ; figés dès la fin des travaux. */
export const isFactureInterventionWorkOpen = (status: FactureInterventionStatus) =>
  status === 'IN_PROGRESS';

// ─── Limites ───

/** Une saisie de temps : 1 minute à 12 heures. */
export const FACTURE_MAX_TIME_ENTRY_MINUTES = 720;
/** Photos par intervention. */
export const FACTURE_MAX_INTERVENTION_PHOTOS = 12;
/** Techniciens affectés à une intervention. */
export const FACTURE_MAX_INTERVENTION_TECHNICIANS = 10;
/** Durée d'un créneau : 31 jours au plus. */
export const FACTURE_MAX_INTERVENTION_SPAN_MS = 31 * 86_400_000;

/** Durée lisible : `1 h 35`, `45 min`, `2 h`. */
export function formatFactureMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Heures facturées pour une durée : quantité à 3 décimales (90 min → 1,5 ; 100 min → 1,667). */
export const factureHoursOf = (minutes: number) => Math.round((minutes * 1000) / 60) / 1000;

/** Référence d'une intervention : `INT-2026-00001`, par organisation et année de création. */
export function formatFactureInterventionNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1)
    throw new Error('Rang de numérotation invalide.');
  return `INT-${year}-${String(sequence).padStart(5, '0')}`;
}

// ─── Droits ───

/**
 * Portée d'un rôle sur les interventions : toutes (gérant, commercial, comptable), seulement celles où il
 * est affecté (technicien), aucune.
 */
export function factureInterventionScope(role: FactureRole): 'all' | 'assigned' | 'none' {
  if (hasFacturePermission(role, 'facture.interventions.read')) return 'all';
  if (hasFacturePermission(role, 'facture.interventions.work')) return 'assigned';
  return 'none';
}

/**
 * Saisie des travaux (démarrer, temps, pièces, photos, fin, signature) : un rôle qui planifie le fait sur
 * toute intervention ; un technicien, sur celles où il est affecté.
 */
export function canWorkOnFactureIntervention(role: FactureRole, assigned: boolean): boolean {
  if (!hasFacturePermission(role, 'facture.interventions.work')) return false;
  return assigned || hasFacturePermission(role, 'facture.interventions.manage');
}
