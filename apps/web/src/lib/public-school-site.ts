import 'server-only';
import type { SchoolSitePublicResponse, SchoolSitePublishedNews } from '@ocall/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Version PUBLIÉE d'un site d'établissement (jamais le brouillon), lue SANS cache : une dépublication,
 * une résiliation de contrat, la fin du maintien ou le retrait d'une photo valent immédiatement.
 */
export async function fetchSchoolSite(slug: string): Promise<SchoolSitePublicResponse | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Site public indisponible (${res.status}).`);
  return res.json();
}

/** Article publié d'un site, résolu par son adresse. */
export async function fetchSchoolNews(
  slug: string,
  newsSlug: string,
): Promise<SchoolSitePublishedNews | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug) || !/^[a-z0-9-]{1,80}$/.test(newsSlug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}/news/${newsSlug}`, {
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Actualité indisponible (${res.status}).`);
  return res.json();
}

export async function fetchSchoolSitemap(
  host: string,
): Promise<{ url: string; lastModified: string | null }[]> {
  const res = await fetch(
    `${API_URL}/api/v1/public/school-sites/sitemap?host=${encodeURIComponent(host)}`,
    // Sans cache : une dépublication ou une résiliation retire aussitôt les pages du plan.
    { cache: 'no-store' },
  );
  return res.ok ? res.json() : [];
}
