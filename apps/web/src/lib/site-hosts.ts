/**
 * Hôtes et routage des sites vitrines (Sprint 10), sans dépendance serveur : partagé par le
 * middleware et les routes. Rien n'est supposé acquis : sans `SITES_BASE_DOMAIN`, seules les
 * adresses `/e/<slug>` existent.
 */

/** Hôte de la requête (derrière le proxy de l'hébergeur : `x-forwarded-host`). */
export function requestHost(headers: Headers): string {
  return (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
}

/** Hôtes de l'application elle-même (espace client, Super Admin, pages commerciales). */
export function isAppHost(host: string): boolean {
  const h = host.toLowerCase().split(':')[0]!;
  const configured = (process.env.APP_HOSTS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const base = process.env.SITES_BASE_DOMAIN?.trim().toLowerCase();
  // Domaine des sites School : son apex, www et app restent des hôtes de l'application.
  const school = process.env.SCHOOL_SITES_BASE_DOMAIN?.trim().toLowerCase();
  // Domaine des vitrines Facture : de même, son apex, www et app restent des hôtes de l'application.
  const facture = process.env.FACTURE_SITES_BASE_DOMAIN?.trim().toLowerCase();
  return (
    configured.includes(h) ||
    (!!school && (h === school || h === `www.${school}` || h === `app.${school}`)) ||
    (!!facture && (h === facture || h === `www.${facture}` || h === `app.${facture}`)) ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.railway.app') ||
    (!!base && (h === base || h === `www.${base}` || h === `app.${base}`))
  );
}

// ─── Sites des établissements Ocall School (Sprint 10) ───

/** Domaine des sites School (`<slug>.<domaine>`), seulement si les sous-domaines sont activés. */
export function schoolSitesBaseDomain(): string | null {
  if (process.env.SCHOOL_SITES_SUBDOMAINS_ENABLED !== 'true') return null;
  return process.env.SCHOOL_SITES_BASE_DOMAIN?.trim().toLowerCase() || null;
}

/**
 * Hôte placé sous le domaine des sites School (`*.ocall.school`) : il n'est servi QUE par le routage
 * des sites School (jamais par celui des sites Park ni par l'application), même si son libellé est
 * invalide ou inconnu — la page est alors introuvable.
 */
export function isSchoolSiteHost(host: string): boolean {
  const base = schoolSitesBaseDomain();
  const h = host.toLowerCase().split(':')[0]!;
  return !!base && h.endsWith(`.${base}`) && !isAppHost(h);
}

// ─── Vitrines Ocall Facture (F5) ───

/** Domaine des vitrines Facture (`<slug>.<domaine>`), seulement si les sous-domaines sont activés. */
export function factureSitesBaseDomain(): string | null {
  if (process.env.FACTURE_SITES_SUBDOMAINS_ENABLED !== 'true') return null;
  return process.env.FACTURE_SITES_BASE_DOMAIN?.trim().toLowerCase() || null;
}

/**
 * Hôte placé sous le domaine des vitrines Facture : servi QUE par le routage des vitrines Facture
 * (jamais par celui des sites Park ou School ni par l'application).
 */
export function isFactureSiteHost(host: string): boolean {
  const base = factureSitesBaseDomain();
  const h = host.toLowerCase().split(':')[0]!;
  return !!base && h.endsWith(`.${base}`) && !isAppHost(h);
}
