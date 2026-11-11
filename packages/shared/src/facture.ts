/**
 * Ocall Facture (V1) — règles partagées par l'API et le web : rôles et permissions, TVA, numérotation,
 * mentions légales (Mali). Aucune donnée métier d'Ocall Park ni d'Ocall School.
 */

export const FACTURE_PRODUCT_CODE = 'OCALL_FACTURE';

// ─── Rôles et permissions ───

export const FACTURE_ROLES = ['MANAGER', 'SALES', 'ACCOUNTANT', 'TECHNICIAN'] as const;
export type FactureRole = (typeof FACTURE_ROLES)[number];

export const FACTURE_ROLE_LABELS: Record<FactureRole, string> = {
  MANAGER: 'Gérant',
  SALES: 'Commercial',
  ACCOUNTANT: 'Comptable',
  TECHNICIAN: 'Technicien',
};

export const FACTURE_PERMISSIONS = [
  /** Entrer dans l'application (contexte, paramètres en lecture). */
  'facture.access',
  'facture.settings.manage',
  'facture.members.read',
  'facture.members.manage',
  'facture.clients.read',
  'facture.clients.manage',
  'facture.catalog.read',
  'facture.catalog.manage',
  /** Consulter les devis, pro forma, bons de commande et factures, et leurs PDF. */
  'facture.documents.read',
  /** Créer et modifier les brouillons, émettre, envoyer, convertir, annuler, relancer. */
  'facture.documents.manage',
  /** Enregistrer et annuler les encaissements, créer et émettre les avoirs (F2). */
  'facture.billing.manage',
  /** Exporter le journal des ventes et des encaissements (F2). */
  'facture.reports.read',
  /** Consulter toutes les interventions et le parc d'équipements des clients (F3). */
  'facture.interventions.read',
  /** Planifier, modifier, affecter, annuler les interventions ; gérer les équipements (F3). */
  'facture.interventions.manage',
  /** Réaliser une intervention : temps, pièces, photos, fin des travaux, signature du client (F3). */
  'facture.interventions.work',
  /** Rapport d'intervention intelligent : proposition à relire avant la fin des travaux (F6A). */
  'facture.ai.report',
  /** Devis intelligent : brouillon de devis proposé depuis une demande (F6A). */
  'facture.ai.quote',
  /** Planification intelligente : techniciens et créneaux proposés, affectés après validation (F6B). */
  'facture.ai.planning',
  /** Maintenance préventive intelligente : équipements à entretenir ou à vérifier (F6B). */
  'facture.ai.maintenance',
] as const;
export type FacturePermission = (typeof FACTURE_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<FactureRole, readonly FacturePermission[]> = {
  MANAGER: FACTURE_PERMISSIONS,
  SALES: [
    'facture.access',
    'facture.members.read',
    'facture.clients.read',
    'facture.clients.manage',
    'facture.catalog.read',
    'facture.catalog.manage',
    'facture.documents.read',
    'facture.documents.manage',
    'facture.interventions.read',
    'facture.interventions.manage',
    'facture.ai.quote',
    'facture.ai.planning',
    'facture.ai.maintenance',
  ],
  ACCOUNTANT: [
    'facture.access',
    'facture.members.read',
    'facture.clients.read',
    'facture.clients.manage',
    'facture.catalog.read',
    'facture.documents.read',
    'facture.documents.manage',
    'facture.billing.manage',
    'facture.reports.read',
    'facture.interventions.read',
  ],
  // Le technicien réalise les interventions où il est affecté ; jamais de documents commerciaux.
  TECHNICIAN: [
    'facture.access',
    'facture.clients.read',
    'facture.catalog.read',
    'facture.interventions.work',
    'facture.ai.report',
  ],
};

export function hasFacturePermission(role: FactureRole, permission: FacturePermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function facturePermissionsOf(role: FactureRole): FacturePermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/** Rôles qu'un membre peut attribuer : seul le gérant (ou le propriétaire, gérant d'office) gère l'équipe. */
export function assignableFactureRoles(role: FactureRole): FactureRole[] {
  return role === 'MANAGER' ? [...FACTURE_ROLES] : [];
}

// ─── TVA ───

/** Taux proposés dans la liste déroulante : 0 à 20 %, par pas de 1 % (décision du 10/11/2026). */
export const FACTURE_VAT_RATES: readonly number[] = Array.from({ length: 21 }, (_, i) => i);
/** Taux normal de la TVA au Mali, proposé par défaut. */
export const FACTURE_DEFAULT_VAT_RATE = 18;

export const isFactureVatRate = (rate: unknown): rate is number =>
  typeof rate === 'number' && Number.isInteger(rate) && rate >= 0 && rate <= 20;

export const formatVatRate = (rate: number) => (rate === 0 ? 'Exonéré (0 %)' : `${rate} %`);

// ─── Documents et numérotation ───

export const FACTURE_DOCUMENT_TYPES = [
  'QUOTE',
  'PRO_FORMA',
  'ORDER',
  'INVOICE',
  'CREDIT_NOTE',
] as const;
export type FactureDocumentType = (typeof FACTURE_DOCUMENT_TYPES)[number];

export const FACTURE_DOCUMENT_TYPE_LABELS: Record<FactureDocumentType, string> = {
  QUOTE: 'Devis',
  PRO_FORMA: 'Facture pro forma',
  ORDER: 'Bon de commande',
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
};

export const FACTURE_NUMBER_PREFIXES: Record<FactureDocumentType, string> = {
  QUOTE: 'DEV',
  PRO_FORMA: 'PRO',
  ORDER: 'BC',
  INVOICE: 'FAC',
  CREDIT_NOTE: 'AV',
};

/**
 * Numéro d'un document : préfixe du type, année, rang sur 5 chiffres au moins (`FAC-2026-00001`).
 * Unique, séquentiel et chronologique par organisation, type et année ; attribué à l'émission seulement.
 */
export function formatFactureNumber(type: FactureDocumentType, year: number, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1)
    throw new Error('Rang de numérotation invalide.');
  return `${FACTURE_NUMBER_PREFIXES[type]}-${year}-${String(sequence).padStart(5, '0')}`;
}

// ─── Identité légale et mentions (Mali) ───

export interface FactureLegalIdentity {
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  nif?: string | null;
  taxRegime?: string | null;
}

/**
 * Mentions du vendeur recommandées sur les documents (Mali) : raison sociale, adresse, numéro
 * d'identification fiscale (NIF) et régime d'imposition. Renvoie les libellés manquants, signalés à
 * l'utilisateur sans bloquer l'émission (décision du 10/11/2026 : NIF et adresse facultatifs).
 * À faire valider par un expert-comptable malien avant le sprint de facturation.
 */
export function factureLegalMissing(identity: FactureLegalIdentity): string[] {
  const missing: string[] = [];
  const blank = (v: string | null | undefined) => !v || v.trim().length === 0;
  if (blank(identity.legalName)) missing.push('Raison sociale');
  if (blank(identity.address) || blank(identity.city)) missing.push('Adresse');
  if (blank(identity.nif)) missing.push('Numéro d’identification fiscale (NIF)');
  if (blank(identity.taxRegime)) missing.push('Régime d’imposition');
  return missing;
}

/**
 * Logos imprimés sur tous les documents : 3 en en-tête au plus (logo principal compris), 6 en bandeau au
 * bas de chaque page (certifications, marques, partenaires).
 */
export const FACTURE_MAX_HEADER_LOGOS = 3;
export const FACTURE_MAX_FOOTER_LOGOS = 6;
/** Cachet ou signature de l'entreprise, imprimé dans la case « Le fournisseur ». */
export const FACTURE_MAX_STAMPS = 1;
export const FACTURE_LOGO_PLACEMENTS = ['HEADER', 'FOOTER', 'STAMP'] as const;
export type FactureLogoPlacement = (typeof FACTURE_LOGO_PLACEMENTS)[number];

export const FACTURE_LOGO_LIMITS: Record<FactureLogoPlacement, number> = {
  HEADER: FACTURE_MAX_HEADER_LOGOS,
  FOOTER: FACTURE_MAX_FOOTER_LOGOS,
  STAMP: FACTURE_MAX_STAMPS,
};

/** NIF et RCCM : lettres, chiffres, tirets, points et barres obliques (formats variables). */
export const FACTURE_REGISTRATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]{2,39}$/;

/** Suggestions de régimes d'imposition (saisie libre possible, imprimée telle quelle). */
export const FACTURE_TAX_REGIME_SUGGESTIONS = [
  'Régime du réel normal',
  'Régime du réel simplifié',
  'Impôt synthétique',
] as const;
