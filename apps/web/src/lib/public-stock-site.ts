import 'server-only';
import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import type { StockShowcaseProduct, StockShowcasePublished } from '@ocall/shared';
import { visitorHeaders } from './visitor-headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface Base {
  slug: string;
  /** Adresse canonique (domaine personnalisé actif, sous-domaine ou `/m/<slug>`). */
  url: string;
  site: StockShowcasePublished;
}

export interface StockSiteHome extends Base {
  categories: { id: string; name: string }[];
  featured: StockShowcaseProduct[];
}

export interface StockSiteCatalog extends Base {
  total: number;
  page: number;
  pageSize: number;
  categories: { id: string; name: string }[];
  items: StockShowcaseProduct[];
}

export interface StockSiteProduct extends Base {
  product: StockShowcaseProduct;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/public/${path}`, {
      cache: 'no-store',
      headers: await visitorHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const validSlug = (slug: string) => /^[a-z0-9-]{1,40}$/.test(slug);

/**
 * Lecture publique d'une vitrine Ocall Stock (S7) : version publiée et catalogue des articles publiés,
 * jamais mis en cache. null : site introuvable, hors ligne ou non autorisé.
 */
export function fetchStockSite(slug: string) {
  return validSlug(slug) ? get<StockSiteHome>(`stock-sites/${slug}`) : Promise.resolve(null);
}

export function fetchStockCatalog(
  slug: string,
  query: { category?: string; q?: string; page?: number },
) {
  if (!validSlug(slug)) return Promise.resolve(null);
  const params = new URLSearchParams();
  if (query.category && /^[0-9a-f-]{36}$/.test(query.category)) {
    params.set('category', query.category);
  }
  if (query.q) params.set('q', query.q.slice(0, 80));
  if (query.page && query.page > 0) params.set('page', String(Math.min(query.page, 200)));
  return get<StockSiteCatalog>(`stock-sites/${slug}/catalogue?${params}`);
}

export function fetchStockProduct(slug: string, id: string) {
  if (!validSlug(slug) || !/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(null);
  return get<StockSiteProduct>(`stock-sites/${slug}/articles/${id}`);
}

/** Plan du site des vitrines Stock pour un hôte ; null si l'API est injoignable. */
export async function fetchStockSitemap(
  host: string,
): Promise<{ url: string; lastModified: string | null }[] | null> {
  return get(`stock-sites/sitemap?host=${encodeURIComponent(host)}`);
}

/** Identifiant de la vitrine Stock servie par un domaine personnalisé (page de contrôle HTTPS). */
export async function stockSiteIdForHost(host: string): Promise<string | null> {
  const found = await get<{ siteId: string }>(
    `stock-sites/well-known?host=${encodeURIComponent(host)}`,
  );
  return found?.siteId ?? null;
}

/** URL publique d'une image publiée de la vitrine, d'une photo d'article publié. */
export const stockMediaUrl = (key: string) => `/api/v1/public/stock-media/${key}`;
export const stockImageUrl = (id: string) => `/api/v1/public/stock-images/${id}`;

/**
 * Préfixe des liens internes : vide sur l'hôte de la vitrine (sous-domaine, domaine personnalisé),
 * `/m/<slug>` sur l'application. Hors de l'hôte canonique, la page redirige (301) vers son adresse
 * canonique : une seule adresse indexée par page.
 */
export async function stockSiteBase(data: Base, subpath: string): Promise<string> {
  const h = await headers();
  const onSiteHost = h.get('x-ocall-site-host') === '1';
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
  if (host && !onSiteHost && new URL(data.url).host !== host) {
    permanentRedirect(`${data.url}${subpath}`);
  }
  return onSiteHost ? '' : `/m/${data.slug}`;
}
