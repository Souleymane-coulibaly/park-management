import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import {
  SCHOOL_SITE_PAGE_LABELS,
  type SchoolSiteLanguage,
  type SchoolSitePublicResponse,
  type SchoolSiteRoute,
  localizedText,
  parseSchoolSitePath,
  schoolSitePath,
} from '@ocall/shared';
import { SchoolSitePageContent, SchoolSiteShell } from '@/components/school-site/school-site-view';
import { fetchSchoolSite } from '@/lib/public-school-site';

type Params = { params: Promise<{ slug: string; path?: string[] }> };

type Resolved =
  | { kind: 'missing' }
  | { kind: 'unavailable'; data: Extract<SchoolSitePublicResponse, { state: 'UNAVAILABLE' }> }
  | {
      kind: 'page';
      data: Extract<SchoolSitePublicResponse, { state: 'PUBLISHED' }>;
      route: SchoolSiteRoute;
    };

/** Page demandée : chemin connu, langue publiée, actualité publiée ; tout le reste est introuvable. */
async function resolve(params: Params['params']): Promise<Resolved> {
  const { slug, path } = await params;
  const route = parseSchoolSitePath(`/${(path ?? []).join('/')}`);
  if (!route) return { kind: 'missing' };
  const data = await fetchSchoolSite(slug);
  if (!data) return { kind: 'missing' };
  if (data.state === 'UNAVAILABLE') return { kind: 'unavailable', data };
  if (!data.site.languages.includes(route.lang)) return { kind: 'missing' };
  if (route.newsSlug && !data.news.some((n) => n.slug === route.newsSlug))
    return { kind: 'missing' };
  return { kind: 'page', data, route };
}

const absolute = (canonical: string, lang: SchoolSiteLanguage, r: SchoolSiteRoute) => {
  const path = schoolSitePath(lang, r.page, r.newsSlug);
  return path === '/' ? canonical : `${canonical}${path}`;
};

/**
 * Métadonnées par établissement et par page : titre, description, adresse canonique, versions
 * linguistiques (hreflang). Site indisponible ou page inconnue : jamais indexés.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const r = await resolve(params);
  if (r.kind === 'missing')
    return { title: { absolute: 'Page introuvable' }, robots: { index: false, follow: false } };
  if (r.kind === 'unavailable') {
    return {
      title: { absolute: r.data.name.fr || r.data.name.ar },
      robots: { index: false, follow: false },
    };
  }
  const { site, canonicalUrl } = r.data;
  const lang = r.route.lang;
  const name = localizedText(site.name, lang)?.text ?? '';
  const news = r.route.newsSlug ? r.data.news.find((n) => n.slug === r.route.newsSlug) : null;
  const pageTitle = news
    ? (localizedText(news.title, lang)?.text ?? '')
    : r.route.page === 'home'
      ? ''
      : SCHOOL_SITE_PAGE_LABELS[r.route.page][lang];
  const description = (
    localizedText(news ? news.body : site.content.home.tagline, lang)?.text ||
    localizedText(site.content.home.intro, lang)?.text ||
    name
  ).slice(0, 160);
  const image = news?.image ?? site.cover ?? site.logo;
  return {
    title: { absolute: pageTitle ? `${pageTitle} — ${name}` : name },
    description,
    alternates: {
      canonical: absolute(canonicalUrl, lang, r.route),
      languages: Object.fromEntries(
        site.languages.map((l) => [l, absolute(canonicalUrl, l, r.route)]),
      ),
    },
    openGraph: {
      type: news ? 'article' : 'website',
      title: pageTitle || name,
      description,
      url: absolute(canonicalUrl, lang, r.route),
      siteName: name,
      locale: lang === 'ar' ? 'ar_AR' : 'fr_FR',
      images: image
        ? [
            {
              url: new URL(image.url, canonicalUrl).toString(),
              width: image.width,
              height: image.height,
            },
          ]
        : undefined,
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Page publique d'un site d'établissement : version PUBLIÉE uniquement, mise en cache et régénérée
 * à la publication. Adresse canonique unique (sous-domaine s'il est activé, sinon /s/<slug>) : une
 * autre adresse redirige (301). Langue par défaut absente : la racine redirige vers l'arabe.
 */
export default async function SchoolSitePage({ params }: Params) {
  const { slug, path } = await params;
  const requested = parseSchoolSitePath(`/${(path ?? []).join('/')}`);
  const r = await resolve(params);
  if (r.kind === 'missing') {
    // Site publié en arabe seulement : la racine française mène à la page arabe équivalente.
    if (requested && requested.lang === 'fr') {
      const data = await fetchSchoolSite(slug);
      if (data?.state === 'PUBLISHED' && !data.site.languages.includes('fr')) {
        permanentRedirect(absolute(data.canonicalUrl, 'ar', requested));
      }
    }
    notFound();
  }
  if (r.kind === 'unavailable') {
    const name = r.data.name;
    return (
      <main className="grid min-h-screen place-items-center bg-ivory px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">
            <span>{name.fr}</span>
            {name.ar && (
              <span lang="ar" dir="rtl" className="mx-2">
                {name.ar}
              </span>
            )}
          </h1>
          <p className="mt-2 text-muted">Ce site est momentanément indisponible.</p>
          <p className="text-muted" lang="ar" dir="rtl">
            هذا الموقع غير متاح مؤقتاً.
          </p>
        </div>
      </main>
    );
  }
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
  const servedByHost = h.get('x-ocall-site-host') === '1';
  const canonical = new URL(r.data.canonicalUrl);
  // Adresse non canonique (ex. /s/<slug> alors que le sous-domaine est actif) : redirection permanente.
  if (host && !servedByHost && canonical.host !== host) {
    permanentRedirect(absolute(r.data.canonicalUrl, r.route.lang, r.route));
  }
  const chrome = {
    lang: r.route.lang,
    page: r.route.page,
    base: servedByHost ? '' : `/s/${slug}`,
    readOnlyUntil: r.data.readOnlyUntil,
  };
  return (
    <SchoolSiteShell data={r.data} chrome={chrome}>
      <SchoolSitePageContent data={r.data} chrome={chrome} newsSlug={r.route.newsSlug} />
    </SchoolSiteShell>
  );
}
