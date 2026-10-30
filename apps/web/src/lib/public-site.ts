import 'server-only';
import type { PublicSiteResponse } from '@ocall/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Durée de cache d'une page publique ; la publication la régénère immédiatement (revalidation). */
export const SITE_REVALIDATE_SECONDS = 300;
export const siteTag = (slug: string) => `site:${slug}`;

/**
 * Version PUBLIÉE d'un site (jamais le brouillon), mise en cache par le serveur Next.js : les
 * visiteurs ne sollicitent l'API qu'à l'expiration du cache ou après une publication.
 */
export async function fetchPublicSite(
  slug: string,
): Promise<(PublicSiteResponse & { siteId: string }) | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/sites/${slug}`, {
    next: { revalidate: SITE_REVALIDATE_SECONDS, tags: [siteTag(slug)] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Site public indisponible (${res.status}).`);
  return res.json();
}

/** Hôte → site (sous-domaine Ocall ou domaine personnalisé ACTIF). */
export async function resolveSiteHost(
  host: string,
): Promise<{ slug: string; siteId: string } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/public/sites/resolve?host=${encodeURIComponent(host)}`,
    {
      next: { revalidate: 60 },
    },
  );
  return res.ok ? res.json() : null;
}

export async function fetchSitemap(host: string): Promise<{ url: string; lastModified: string }[]> {
  const res = await fetch(
    `${API_URL}/api/v1/public/sites/sitemap?host=${encodeURIComponent(host)}`,
    {
      next: { revalidate: 600 },
    },
  );
  return res.ok ? res.json() : [];
}

export { isAppHost, requestHost } from './site-hosts';
