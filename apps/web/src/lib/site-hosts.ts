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
  return (
    configured.includes(h) ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.railway.app') ||
    (!!base && (h === base || h === `www.${base}` || h === `app.${base}`))
  );
}
