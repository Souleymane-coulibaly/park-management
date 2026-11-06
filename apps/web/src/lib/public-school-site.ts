import 'server-only';
import type { SchoolSitePublicResponse } from '@ocall/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Cache d'une page publique School ; publication, retrait d'image et liens la régénèrent aussitôt. */
export const SCHOOL_SITE_REVALIDATE_SECONDS = 300;
export const schoolSiteTag = (slug: string) => `school-site:${slug}`;

/**
 * Version PUBLIÉE d'un site d'établissement (jamais le brouillon), mise en cache par le serveur
 * Next.js sous une étiquette propre aux sites School.
 */
export async function fetchSchoolSite(slug: string): Promise<SchoolSitePublicResponse | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}`, {
    next: { revalidate: SCHOOL_SITE_REVALIDATE_SECONDS, tags: [schoolSiteTag(slug)] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Site public indisponible (${res.status}).`);
  return res.json();
}

export async function fetchSchoolSitemap(
  host: string,
): Promise<{ url: string; lastModified: string | null }[]> {
  const res = await fetch(
    `${API_URL}/api/v1/public/school-sites/sitemap?host=${encodeURIComponent(host)}`,
    { next: { revalidate: 600 } },
  );
  return res.ok ? res.json() : [];
}
