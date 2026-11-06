import { slugFromHost } from '@ocall/shared';
import type { SchoolSitesConfig } from './school.config';

/**
 * Résolution d'un nom d'hôte vers un site d'établissement. Sprint 10 : sous-domaines
 * `<slug>.<SCHOOL_SITES_BASE_DOMAIN>` uniquement. Les domaines personnalisés (Sprint 13) s'ajouteront
 * par un autre résolveur, essayé après celui-ci, sans modifier les appelants.
 */
export interface SchoolSiteHostResolver {
  /** Slug porté par l'hôte (nom validé, noms réservés exclus) ; null si l'hôte n'est pas un site. */
  slugForHost(host: string): Promise<string | null>;
}

export const SCHOOL_SITE_HOST_RESOLVERS = Symbol('SCHOOL_SITE_HOST_RESOLVERS');

/** Hôte normalisé : minuscules, sans port ni point final ; null s'il est manifestement invalide. */
export function normalizeHost(input: string): string | null {
  const host = input.trim().toLowerCase().split(':')[0]!.replace(/\.$/, '');
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
}

export class SubdomainHostResolver implements SchoolSiteHostResolver {
  constructor(private readonly config: SchoolSitesConfig) {}

  async slugForHost(host: string): Promise<string | null> {
    if (!this.config.subdomainsEnabled) return null;
    const h = normalizeHost(host);
    return h ? slugFromHost(h, this.config.baseDomain) : null;
  }
}

/** Adresse canonique : sous-domaine s'il est activé, sinon `<origine>/s/<slug>`. */
export function schoolSiteCanonicalUrl(config: SchoolSitesConfig, slug: string): string {
  return config.subdomainsEnabled && config.baseDomain
    ? `https://${slug}.${config.baseDomain}`
    : `${config.publicOrigin}/s/${slug}`;
}
