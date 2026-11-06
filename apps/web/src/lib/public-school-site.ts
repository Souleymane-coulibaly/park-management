import 'server-only';
import { headers } from 'next/headers';
import type { SchoolSitePublicResponse, SchoolSitePublishedNews } from '@ocall/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * En-têtes des lectures faites pour un visiteur (pages lues sans cache) : l'IP du visiteur, authentifiée
 * par le secret partagé web/API, pour que la limitation de débit de l'API compte chaque visiteur et non
 * le serveur web. Frontière de confiance explicite : WEB_TRUSTED_PROXY_HOPS proxys de confiance (edge de
 * l'hébergeur) précèdent le web ; l'IP retenue est l'entrée de X-Forwarded-For ajoutée par le plus
 * éloigné d'entre eux. Sans proxy de confiance (0, accès direct) : aucune identité transmise, l'API
 * garde l'IP de la requête — une valeur fournie par le visiteur n'est jamais signée.
 */
async function visitorHeaders(): Promise<Record<string, string>> {
  const secret = process.env.SITES_REVALIDATE_SECRET?.trim();
  if (!secret) return {};
  const hops = Number(process.env.WEB_TRUSTED_PROXY_HOPS ?? '0');
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) return {};
  const h = await headers();
  const forwarded = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  // Entrées ajoutées par les proxys de confiance : les `hops` dernières ; à gauche, le visiteur peut
  // écrire ce qu'il veut. Moins d'entrées que de proxys attendus : rien n'est transmis.
  const ip = forwarded.length >= hops ? forwarded[forwarded.length - hops] : undefined;
  return ip ? { 'x-ocall-internal': secret, 'x-ocall-visitor-ip': ip } : {};
}

/**
 * Version PUBLIÉE d'un site d'établissement (jamais le brouillon), lue SANS cache : une dépublication,
 * une résiliation de contrat, la fin du maintien ou le retrait d'une photo valent immédiatement.
 */
export async function fetchSchoolSite(slug: string): Promise<SchoolSitePublicResponse | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
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
  if (!/^[a-z0-9-]{1,40}$/.test(slug) || !/^[a-z0-9-]{1,80}$/.test(newsSlug)) return null;
  const res = await fetch(`${API_URL}/api/v1/public/school-sites/${slug}/news/${newsSlug}`, {
    cache: 'no-store',
    headers: await visitorHeaders(),
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
    { cache: 'no-store', headers: await visitorHeaders() },
  );
  return res.ok ? res.json() : [];
}
