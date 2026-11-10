/**
 * Ocall Facture — module IA (F6A), sur Ocall AI Core : rapport d'intervention intelligent et devis
 * intelligent. L'IA propose, une personne décide : chaque sortie est une proposition tracée, appliquée
 * seulement par l'action explicite d'un utilisateur autorisé.
 */

export const FACTURE_AI_APPLICATION = 'facture';

/** Fonctionnalités IA de F6A (la planification et la maintenance suivront en F6B). */
export const FACTURE_AI_FEATURES = ['FACTURE_REPORT', 'FACTURE_QUOTE'] as const;
export type FactureAiFeature = (typeof FACTURE_AI_FEATURES)[number];

export const FACTURE_AI_FEATURE_LABELS: Record<FactureAiFeature, string> = {
  FACTURE_REPORT: 'Rapport d’intervention intelligent',
  FACTURE_QUOTE: 'Devis intelligent',
};

export const FACTURE_AI_PROPOSAL_STATUSES = ['PROPOSED', 'APPLIED', 'REJECTED'] as const;
export type FactureAiProposalStatus = (typeof FACTURE_AI_PROPOSAL_STATUSES)[number];

export const FACTURE_AI_PROPOSAL_STATUS_LABELS: Record<FactureAiProposalStatus, string> = {
  PROPOSED: 'Proposée',
  APPLIED: 'Appliquée',
  REJECTED: 'Rejetée',
};

/** Plafond mensuel proposé par fonctionnalité (réglable par le gérant sous le plafond Ocall). */
export const FACTURE_AI_DEFAULT_MONTHLY_LIMIT = 100;
/** Plafond plateforme par défaut (variable `FACTURE_AI_MAX_MONTHLY_CALLS`). */
export const FACTURE_AI_PLATFORM_MONTHLY_CEILING = 500;

/** Observations du technicien (saisies ou dictées) : 4 000 caractères au plus. */
export const FACTURE_AI_MAX_OBSERVATIONS = 4_000;
/** Demande du client pour un devis : 4 000 caractères au plus. */
export const FACTURE_AI_MAX_REQUEST = 4_000;
/** Articles du catalogue présentés au modèle pour un devis. */
export const FACTURE_AI_MAX_CATALOG_ITEMS = 300;
/** Lignes d'un devis proposé. */
export const FACTURE_AI_MAX_QUOTE_LINES = 40;

/**
 * Texte appliqué différent du texte proposé (le technicien l'a corrigé) : comparaison sans tenir compte
 * des espaces superflus.
 */
export function factureAiTextEdited(proposed: string | null, applied: string | null): boolean {
  const clean = (v: string | null) => (v ?? '').replace(/\s+/g, ' ').trim();
  return clean(proposed) !== clean(applied);
}
