import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteView, siteJsonLd } from '@/components/site/site-view';
import { fetchPublicSite } from '@/lib/public-site';

type Params = { params: Promise<{ slug: string }> };

/**
 * Page publique d'un site vitrine : version PUBLIÉE uniquement, mise en cache et régénérée à la
 * publication. Une seule adresse canonique (domaine personnalisé actif > sous-domaine > /e/slug) :
 * les autres adresses redirigent (301) pour éviter le contenu dupliqué.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchPublicSite(slug);
  if (!data) return { title: { absolute: 'Site introuvable' }, robots: { index: false } };
  if (data.state === 'UNAVAILABLE') {
    return { title: { absolute: data.publicName }, robots: { index: false, follow: false } };
  }
  const c = data.site.content;
  const description = (
    c.tagline ||
    c.description ||
    `${c.publicName}${c.city ? `, ${c.city}` : ''}`
  ).slice(0, 160);
  const image = data.site.cover ?? data.site.logo;
  return {
    title: { absolute: c.city ? `${c.publicName} — ${c.city}` : c.publicName },
    description,
    alternates: { canonical: data.canonicalUrl },
    openGraph: {
      type: 'website',
      title: c.publicName,
      description,
      url: data.canonicalUrl,
      siteName: c.publicName,
      locale: 'fr_FR',
      images: image
        ? [
            {
              url: new URL(image.url, data.canonicalUrl).toString(),
              width: image.width,
              height: image.height,
              alt: image.alt,
            },
          ]
        : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicSitePage({ params }: Params) {
  const { slug } = await params;
  const data = await fetchPublicSite(slug);
  if (!data) notFound();
  if (data.state === 'UNAVAILABLE') {
    return (
      <main className="grid min-h-screen place-items-center bg-ivory px-4 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">{data.publicName}</h1>
          <p className="mt-2 text-muted">Ce site est momentanément indisponible.</p>
        </div>
      </main>
    );
  }
  // Adresse non canonique (ex. /e/slug alors qu'un domaine est actif) : redirection permanente.
  // Une page servie par son propre hôte (sous-domaine, domaine) est marquée par le middleware.
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
  const servedByHost = h.get('x-ocall-site-host') === '1';
  if (host && !servedByHost && new URL(data.canonicalUrl).host !== host) {
    permanentRedirect(data.canonicalUrl);
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: siteJsonLd(data.site, data.canonicalUrl) }}
      />
      <SiteView site={data.site} />
    </>
  );
}
