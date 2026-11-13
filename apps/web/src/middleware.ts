import { NextResponse, type NextRequest } from 'next/server';
import { parseSchoolSitePath, parseStockShowcasePath, slugFromHost } from '@ocall/shared';
import {
  factureSitesBaseDomain,
  isAppHost,
  isFactureSiteHost,
  isSchoolSiteHost,
  isStockSiteHost,
  requestHost,
  schoolSitesBaseDomain,
  stockSitesBaseDomain,
} from '@/lib/site-hosts';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
// Portail parents : privé, sauf la page publique d'activation par le lien d'invitation.
const PRIVATE =
  /^\/(app|admin|partenaire|suite|school|facture|stock|parents(?!\/activation)|changer-mot-de-passe|double-authentification)(\/|$)/;
/** Chemins servis tels quels sur un hôte de site : ressources, images publiées, contrôle, SEO. */
const SITE_PASSTHROUGH =
  /^\/(_next\/|api\/v1\/public\/|\.well-known\/ocall-site$|sitemap\.xml$|robots\.txt$|favicon\.ico$|icon\.svg$)/;
/**
 * Sur un hôte de site School : ressources, images publiées des sites School, SEO. Les routes publiques
 * des sites Park n'y sont pas servies, et réciproquement (isolation des deux produits).
 */
const SCHOOL_SITE_PASSTHROUGH =
  /^\/(_next\/|api\/v1\/public\/school-media\/|sitemap\.xml$|robots\.txt$|favicon\.ico$|icon\.svg$)/;
// Insensible à la casse, comme le routeur de l'API : /api/v1/public/School-sites reste exclu.
const SCHOOL_PUBLIC_API = /^\/api\/v1\/public\/school-/i;
const SITE_HOST_HEADER = 'x-ocall-site-host';
/** Sur un hôte de vitrine Facture : ressources, API publique des vitrines Facture, contrôle, SEO. */
const FACTURE_SITE_PASSTHROUGH =
  /^\/(_next\/|api\/v1\/public\/facture-(sites|media)\/|\.well-known\/ocall-site$|sitemap\.xml$|robots\.txt$|favicon\.ico$|icon\.svg$)/i;

/** Sur un hôte de vitrine Stock : ressources, API publique des vitrines Stock, contrôle, SEO. */
const STOCK_SITE_PASSTHROUGH =
  /^\/(_next\/|api\/v1\/public\/stock-(sites|media|images)\/|\.well-known\/ocall-site$|sitemap\.xml$|robots\.txt$|favicon\.ico$|icon\.svg$)/i;

/** Cache court des domaines personnalisés résolus (évite un appel à l'API par requête). */
const hostCache = new Map<string, { slug: string | null; expires: number }>();

/** Domaine personnalisé d'une vitrine Facture (après les sites Park) : cache court, comme Park. */
const factureHostCache = new Map<string, { slug: string | null; expires: number }>();

async function factureSlugForHost(host: string): Promise<string | null> {
  const cached = factureHostCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/facture-sites/resolve?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    return null;
  }
  if (factureHostCache.size > 5_000) factureHostCache.clear();
  factureHostCache.set(host, { slug, expires: Date.now() + 60_000 });
  return slug;
}

/** Domaine personnalisé d'une vitrine Stock (après les sites Park et Facture) : cache court. */
const stockHostCache = new Map<string, { slug: string | null; expires: number }>();

async function stockSlugForHost(host: string): Promise<string | null> {
  const cached = stockHostCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/stock-sites/resolve?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    return null;
  }
  if (stockHostCache.size > 5_000) stockHostCache.clear();
  stockHostCache.set(host, { slug, expires: Date.now() + 60_000 });
  return slug;
}

/** Page d'une vitrine Stock servie sur son hôte : `/m/<slug>[/catalogue|/article/<id>]`, requête comprise. */
function stockTarget(slug: string | null, path: string, search: string): string | null {
  const route = parseStockShowcasePath(path);
  if (!slug || !route) return null;
  const sub =
    route.page === 'home' ? '' : route.page === 'catalog' ? '/catalogue' : `/article/${route.id}`;
  return `/m/${slug}${sub}${search}`;
}

async function slugForHost(host: string): Promise<string | null> {
  if (process.env.SITES_SUBDOMAINS_ENABLED === 'true') {
    const sub = slugFromHost(host, process.env.SITES_BASE_DOMAIN?.trim().toLowerCase() || null);
    if (sub) return sub;
  }
  const cached = hostCache.get(host);
  if (cached && cached.expires > Date.now()) return cached.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/api/v1/public/sites/resolve?host=${encodeURIComponent(host)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    // API injoignable : page introuvable plutôt qu'un site erroné ; rien n'est mis en cache.
    return null;
  }
  if (hostCache.size > 5_000) hostCache.clear();
  hostCache.set(host, { slug, expires: Date.now() + 60_000 });
  return slug;
}

/**
 * - Hôtes de l'application : filtre rapide des espaces privés (sans cookie de session → connexion ;
 *   la vérification réelle est faite par l'API et les layouts serveur).
 * - Hôtes des sites School (`<slug>.<domaine School>`) : pages publiques du site (réécrites vers
 *   /s/<slug>/…), rien d'autre.
 * - Hôtes de sites (`<slug>.<domaine Ocall>`, domaine personnalisé ACTIF) : seule la page d'accueil
 *   du site est servie (réécrite vers /e/<slug>) ; espaces privés, autres pages et API internes y
 *   sont introuvables.
 */
export async function middleware(request: NextRequest) {
  const host = requestHost(request.headers);
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  headers.delete(SITE_HOST_HEADER);

  if (!host || isAppHost(host)) {
    if (PRIVATE.test(path) && !request.cookies.has('ocp_session')) {
      const url = new URL('/connexion', request.url);
      url.searchParams.set('suivant', path);
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request: { headers } });
  }

  // Sites des établissements Ocall School (`<slug>.<domaine School>`) : uniquement les pages publiques
  // connues du site (réécrites vers /s/<slug>/…) ; tout autre chemin, ou un libellé invalide ou
  // réservé, est introuvable. Jamais résolu par les sites Park ni servi par l'application.
  // L'hôte est classé AVANT toute exemption de chemin.
  if (isSchoolSiteHost(host)) {
    if (SCHOOL_SITE_PASSTHROUGH.test(path)) return NextResponse.next({ request: { headers } });
    const schoolSlug = slugFromHost(host, schoolSitesBaseDomain());
    const route = parseSchoolSitePath(path);
    headers.set(SITE_HOST_HEADER, '1');
    const target =
      schoolSlug && route
        ? `/s/${schoolSlug}${path === '/' ? '' : path.replace(/\/$/, '')}`
        : '/s/__introuvable';
    return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
  }

  // Vitrines Ocall Facture (`<slug>.<domaine Facture>`) : la seule page d'accueil de la vitrine
  // (réécrite vers /v/<slug>) et son API publique ; jamais résolu par les sites Park ni School.
  if (isFactureSiteHost(host)) {
    if (FACTURE_SITE_PASSTHROUGH.test(path)) return NextResponse.next({ request: { headers } });
    const factureSlug = slugFromHost(host, factureSitesBaseDomain());
    headers.set(SITE_HOST_HEADER, '1');
    const target = factureSlug && path === '/' ? `/v/${factureSlug}` : '/v/__introuvable';
    return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
  }

  // Vitrines Ocall Stock (`<slug>.<domaine Stock>`, S7) : accueil, catalogue et fiches article (réécrits
  // vers /m/<slug>/…) et leur API publique ; jamais résolu par les sites Park, School ni Facture.
  if (isStockSiteHost(host)) {
    if (STOCK_SITE_PASSTHROUGH.test(path)) return NextResponse.next({ request: { headers } });
    const stockSlug = slugFromHost(host, stockSitesBaseDomain());
    headers.set(SITE_HOST_HEADER, '1');
    const target = stockTarget(stockSlug, path, request.nextUrl.search) ?? '/m/__introuvable';
    return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
  }

  // Hôte de site Park : routes publiques des sites School exclues.
  if (SITE_PASSTHROUGH.test(path) && !SCHOOL_PUBLIC_API.test(path)) {
    return NextResponse.next({ request: { headers } });
  }
  const slug = await slugForHost(host);
  headers.set(SITE_HOST_HEADER, '1');
  // Domaine personnalisé inconnu des sites Park : vitrine Facture éventuelle (Park reste prioritaire),
  // puis vitrine Stock (accueil, catalogue, fiches article).
  if (!slug && path === '/') {
    const factureSlug = await factureSlugForHost(host);
    if (factureSlug) {
      return NextResponse.rewrite(new URL(`/v/${factureSlug}`, request.url), {
        request: { headers },
      });
    }
  }
  if (!slug && parseStockShowcasePath(path)) {
    const target = stockTarget(await stockSlugForHost(host), path, request.nextUrl.search);
    if (target) return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
  }
  const target = slug && path === '/' ? `/e/${slug}` : '/e/__introuvable';
  return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)'],
};
