/**
 * Ocall Suite — Sprint 2, étape B : référentiel commun des sites (établissements). Un lieu physique est
 * enregistré une seule fois dans la base Suite ; plusieurs applications peuvent l'utiliser (Park, Stock,
 * School…). Règles pures partagées par l'API et le web.
 */

export const ESTABLISHMENT_KINDS = [
  'PARK',
  'RESTAURANT',
  'SHOP',
  'WAREHOUSE',
  'SCHOOL',
  'AGENCY',
  'OFFICE',
  'OTHER',
] as const;
export type EstablishmentKind = (typeof ESTABLISHMENT_KINDS)[number];

export const ESTABLISHMENT_KIND_LABELS: Record<EstablishmentKind, string> = {
  PARK: 'Parc',
  RESTAURANT: 'Restaurant',
  SHOP: 'Boutique / magasin',
  WAREHOUSE: 'Dépôt / entrepôt',
  SCHOOL: 'École',
  AGENCY: 'Agence',
  OFFICE: 'Bureau',
  OTHER: 'Autre',
};

export const isEstablishmentKind = (value: unknown): value is EstablishmentKind =>
  typeof value === 'string' && (ESTABLISHMENT_KINDS as readonly string[]).includes(value);

/** Application qui utilise un site, telle que le référentiel l'affiche. */
export interface SiteUsage {
  /** Code produit (OCALL_PARK, OCALL_STOCK, OCALL_SCHOOL…). */
  product: string;
  /** Nom de l'application (« Ocall Stock »). */
  label: string;
  /** Fiche de l'application rattachée au site (null pour Park : l'établissement lui-même). */
  appSiteId: string | null;
  appSiteName: string;
}

/** Texte comparable : minuscules, sans accents, ponctuation et espaces réduits. */
export function normalizeSiteText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Raison d'une **suggestion** de rattachement entre la fiche d'une application et un établissement :
 * même nom (et même ville si les deux en ont une) = « same-name » ; même ville seulement = « same-city ».
 * Jamais appliquée automatiquement : l'administrateur choisit et valide chaque rattachement.
 */
export function siteMatchReason(
  appSite: { name: string; city?: string | null },
  establishment: { name: string; city?: string | null },
): 'same-name' | 'same-city' | null {
  const a = normalizeSiteText(appSite.name);
  const b = normalizeSiteText(establishment.name);
  const ca = normalizeSiteText(appSite.city);
  const cb = normalizeSiteText(establishment.city);
  const cityConflict = !!ca && !!cb && ca !== cb;
  if (a && a === b && !cityConflict) return 'same-name';
  if (ca && ca === cb) return 'same-city';
  return null;
}
