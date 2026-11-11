import 'server-only';
import {
  type SchoolSitePublicResponse,
  type SchoolSitePublishedNews,
  schoolSiteSlugError,
} from '@ocall/shared';

import { visitorHeaders } from './visitor-headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Version PUBLIÉE d'un site d'établissement (jamais le brouillon), lue SANS cache : une dépublication,
 * une résiliation de contrat, la fin du maintien ou le retrait d'une photo valent immédiatement.
 */
export async function fetchSchoolSite(slug: string): Promise<SchoolSitePublicResponse | null> {
  // Adresse invalide ou réservée (ex. « sitemap ») : introuvable, sans appel à l'API.
  if (schoolSiteSlugError(slug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}`, {
    cache: 'no-store',
    headers: await visitorHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Site public indisponible (${res.status}).`);
  return res.json();
}

/** Article publié d'un site, résolu par son adresse. */
export async function fetchSchoolNews(
  slug: string,
  newsSlug: string,
): Promise<SchoolSitePublishedNews | null> {
  if (schoolSiteSlugError(slug) || !/^[a-z0-9-]{1,80}$/.test(newsSlug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}/news/${newsSlug}`, {
    cache: 'no-store',
    headers: await visitorHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Actualité indisponible (${res.status}).`);
  return res.json();
}

/** Délai maximal de la contribution School au plan du site : au-delà, elle est considérée indisponible. */
const SCHOOL_SITEMAP_TIMEOUT_MS = 5_000;

/**
 * Entrées School du plan du site, sans cache (une dépublication ou une résiliation retire aussitôt les
 * pages). `null` si l'API ne répond pas (erreur réseau, délai dépassé, réponse illisible) : l'appelant
 * sert alors le reste du plan au lieu d'échouer en entier. Erreur transitoire (5xx, 429) : également
 * `null` — jamais un plan vide servi en 200. Autre réponse non OK (School désactivé…) : aucune entrée.
 */
export async function fetchSchoolSitemap(
  host: string,
): Promise<{ url: string; lastModified: string | null }[] | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/school-sites/sitemap?host=${encodeURIComponent(host)}`,
      {
        cache: 'no-store',
        headers: await visitorHeaders(),
        signal: AbortSignal.timeout(SCHOOL_SITEMAP_TIMEOUT_MS),
      },
    );
    if (res.status >= 500 || res.status === 429) return null;
    return res.ok ? await res.json() : [];
  } catch {
    return null;
  }
}
