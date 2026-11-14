/**
 * Contrat commun du référentiel des sites (Ocall Suite, Sprint 2, étape B).
 *
 * Un lieu physique d'une organisation est enregistré **une seule fois**, comme établissement de la base
 * Suite. Une application à base séparée (Stock, School…) y rattache sa propre fiche par l'UUID de
 * l'établissement (sans clé étrangère entre bases) ; plusieurs applications peuvent utiliser le même
 * établissement. Le module `establishments` fournit l'implémentation sous le jeton `SITE_REGISTRY`
 * (module global). Chaque lecture est filtrée par organisation : un établissement d'une autre
 * organisation est introuvable.
 */

export const SITE_REGISTRY = Symbol('SITE_REGISTRY');

/** Établissement tel qu'une application peut le lire. */
export interface RegistrySite {
  id: string;
  name: string;
  kind: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  brandId: string | null;
  brandName: string | null;
}

/** Fiches d'une application rattachées à des établissements (lecture seule, base de l'application). */
export interface SiteUsageProvider {
  product: string;
  label: string;
  usages(
    organizationId: string,
  ): Promise<{ establishmentId: string; appSiteId: string; appSiteName: string }[]>;
}

export interface SiteRegistry {
  /** Établissement de l'organisation ; null s'il n'existe pas ou appartient à une autre organisation. */
  get(organizationId: string, id: string): Promise<RegistrySite | null>;
  /** Tous les établissements de l'organisation (actifs et désactivés), par nom. */
  list(organizationId: string): Promise<RegistrySite[]>;
  /**
   * Nouveau lieu dans le référentiel, créé depuis une application (`source` : son code produit), sans
   * activité Park. Nom déjà pris dans l'organisation : 409 (rattacher l'établissement existant).
   */
  createSite(input: {
    organizationId: string;
    actorUserId: string;
    source: string;
    name: string;
    kind: string | null;
    city?: string | null;
    address?: string | null;
    phone?: string | null;
  }): Promise<RegistrySite>;
  /** Chaque application déclare au démarrage la lecture de ses rattachements. */
  registerUsage(provider: SiteUsageProvider): void;
}
