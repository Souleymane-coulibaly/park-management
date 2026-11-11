import 'server-only';
import type { FactureSitePublished } from '@ocall/shared';
import { visitorHeaders } from './visitor-headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export interface FactureSitePublicResponse {
  slug: string;
  /** Adresse canonique (domaine personnalisé actif, sous-domaine ou `/v/<slug>`). */
  url: string;
  site: FactureSitePublished;
}

/**
 * Lecture publique d'une vitrine Ocall Facture (F5) : version publiée seulement, jamais mise en cache
 * (une publication ou un retrait est visible aussitôt), identité du visiteur transmise pour la limitation
 * de débit. null : site introuvable, hors ligne ou non autorisé.
 */
export async function fetchFactureSite(slug: string): Promise<FactureSitePublicResponse | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  try {
    const res = await fetch(`${API_URL}/api/v1/public/facture-sites/${slug}`, {
      cache: 'no-store',
      headers: await visitorHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as FactureSitePublicResponse) : null;
  } catch {
    return null;
  }
}

/** Plan du site des vitrines Facture pour un hôte ; null si l'API est injoignable. */
export async function fetchFactureSitemap(
  host: string,
): Promise<{ url: string; lastModified: string | null }[] | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/facture-sites/sitemap?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    return res.ok ? ((await res.json()) as { url: string; lastModified: string | null }[]) : null;
  } catch {
    return null;
  }
}

/** Identifiant du site Facture servi par un domaine personnalisé (page de contrôle HTTPS). */
export async function factureSiteIdForHost(host: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/facture-sites/well-known?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    return res.ok ? ((await res.json()) as { siteId: string }).siteId : null;
  } catch {
    return null;
  }
}

/** URL publique d'une image publiée d'une vitrine Facture. */
export const factureMediaUrl = (key: string) => `/api/v1/public/facture-media/${key}`;
