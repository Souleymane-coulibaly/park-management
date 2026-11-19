/**
 * Ocall School × Ocall Print : fiches du personnel (avec ou sans compte) et cartes. Le moteur des cartes
 * (modèles, rendu, commandes) est celui d'Ocall Print, commun à toutes les applications.
 */

export const SCHOOL_STAFF_CATEGORIES = [
  'TEACHING',
  'ADMINISTRATION',
  'SECURITY',
  'CATERING',
  'MAINTENANCE',
  'TRANSPORT',
  'HEALTH',
  'OTHER',
] as const;
export type SchoolStaffCategory = (typeof SCHOOL_STAFF_CATEGORIES)[number];

export const SCHOOL_STAFF_CATEGORY_LABELS: Record<SchoolStaffCategory, string> = {
  TEACHING: 'Enseignement',
  ADMINISTRATION: 'Administration',
  SECURITY: 'Sécurité',
  CATERING: 'Restauration',
  MAINTENANCE: 'Entretien',
  TRANSPORT: 'Transport',
  HEALTH: 'Santé',
  OTHER: 'Autre',
};

export const SCHOOL_STAFF_LIMITS = { nameMax: 80, jobMax: 80, phoneMax: 30 } as const;

/** Numéro de personnel attribué par l'établissement : P-000001 (unique dans le client). */
export const schoolStaffNumber = (value: number) => `P-${String(value).padStart(6, '0')}`;

/** Résultat de la lecture d'une carte par un membre School autorisé. */
export const SCHOOL_CARD_CHECK_RESULTS = [
  'VALID',
  'REVOKED',
  'HOLDER_INACTIVE',
  'UNKNOWN',
] as const;
export type SchoolCardCheckResult = (typeof SCHOOL_CARD_CHECK_RESULTS)[number];

export const SCHOOL_CARD_CHECK_LABELS: Record<SchoolCardCheckResult, string> = {
  VALID: 'Carte valide',
  REVOKED: 'Carte révoquée',
  HOLDER_INACTIVE: 'Titulaire sorti ou inactif',
  UNKNOWN: 'Carte inconnue',
};
