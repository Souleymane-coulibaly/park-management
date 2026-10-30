import { NextResponse, type NextRequest } from 'next/server';
import { slugFromHost } from '@ocall/shared';
import { isAppHost, requestHost } from '@/lib/site-hosts';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PRIVATE = /^\/(app|admin|changer-mot-de-passe)(\/|$)/;
/** Chemins servis tels quels sur un hôte de site : ressources, images publiées, contrôle, SEO. */
const SITE_PASSTHROUGH =
  /^\/(_next\/|api\/v1\/public\/|\.well-known\/ocall-site$|sitemap\.xml$|robots\.txt$|favicon\.ico$|icon\.svg$)/;
const SITE_HOST_HEADER = 'x-ocall-site-host';

/** Cache court des domaines personnalisés résolus (évite un appel à l'API par requête). */
const hostCache = new Map<string, { slug: string | null; expires: number }>();

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

  if (SITE_PASSTHROUGH.test(path)) return NextResponse.next({ request: { headers } });
  const slug = await slugForHost(host);
  headers.set(SITE_HOST_HEADER, '1');
  const target = slug && path === '/' ? `/e/${slug}` : '/e/__introuvable';
  return NextResponse.rewrite(new URL(target, request.url), { request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)'],
};
