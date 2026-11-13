import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { stockShowcaseStoreJsonLd } from '@ocall/shared';
import { StockRequestForm } from '@/components/stock-site/request';
import { ProductCard, StockSiteShell } from '@/components/stock-site/site-shell';
import { fetchStockSite, stockMediaUrl, stockSiteBase } from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * Vitrine publique d'un magasin Ocall Stock (S7) : version PUBLIÉE uniquement, lue sans cache, premiers
 * articles du catalogue public, contact et demande. Une seule adresse canonique (domaine personnalisé
 * actif > sous-domaine > /m/slug) ; données structurées `Store`.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStockSite(slug);
  if (!data) return { title: { absolute: 'Site introuvable' }, robots: { index: false } };
  const s = data.site;
  const description = (
    s.seoDescription ||
    s.tagline ||
    `${s.businessName}${s.city ? `, ${s.city}` : ''}`
  ).slice(0, 160);
  const image = s.cover ?? s.logo;
  return {
    title: { absolute: s.city ? `${s.businessName} — ${s.city}` : s.businessName },
    description,
    alternates: { canonical: data.url },
    openGraph: {
      type: 'website',
      title: s.businessName,
      description,
      url: data.url,
      siteName: s.businessName,
      locale: 'fr_FR',
      images: image ? [{ url: new URL(stockMediaUrl(image), data.url).toString() }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function StockSiteHomePage({ params }: Params) {
  const { slug } = await params;
  const data = await fetchStockSite(slug);
  if (!data) notFound();
  const base = await stockSiteBase(data, '');
  const s = data.site;
  const jsonLd = stockShowcaseStoreJsonLd(s, data.url, (key) =>
    new URL(stockMediaUrl(key), data.url).toString(),
  );

  return (
    <StockSiteShell site={s} base={base}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <header className="relative overflow-hidden bg-forest text-white">
        {s.cover && (
          // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
          <img
            src={stockMediaUrl(s.cover)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/80">
            {s.businessName}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{s.headline}</h1>
          {s.tagline && <p className="mt-3 max-w-2xl text-lg text-white/90">{s.tagline}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            {s.showCatalog && (
              <Link
                href={`${base}/catalogue`}
                className="rounded-xl bg-white px-5 py-3 font-semibold text-forest"
              >
                Voir le catalogue
              </Link>
            )}
            {s.phone && (
              <a
                href={`tel:${s.phone.replace(/[^+\d]/g, '')}`}
                className="rounded-xl border border-white/60 px-5 py-3 font-semibold"
              >
                Appeler {s.phone}
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-12 px-4 py-12">
        {s.about && (
          <section>
            <h2 className="font-display text-2xl font-bold">Qui sommes-nous</h2>
            <p className="mt-3 whitespace-pre-line text-charcoal-soft">{s.about}</p>
          </section>
        )}

        {s.showCatalog && data.featured.length > 0 && (
          <section data-testid="stock-site-featured">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl font-bold">Nos articles</h2>
              <Link href={`${base}/catalogue`} className="font-semibold text-forest underline">
                Tout le catalogue
              </Link>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data.featured.map((p) => (
                <ProductCard key={p.id} product={p} base={base} />
              ))}
            </ul>
          </section>
        )}

        {s.gallery.length > 0 && (
          <section>
            <h2 className="font-display text-2xl font-bold">Le magasin</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {s.gallery.map((g) => (
                <li key={g.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API */}
                  <img
                    src={stockMediaUrl(g.key)}
                    alt={g.caption ?? 'Le magasin'}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl object-cover"
                  />
                  {g.caption && <p className="mt-1 text-xs text-muted">{g.caption}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h2 className="font-display text-2xl font-bold">Nous trouver</h2>
            <dl className="mt-4 space-y-2 text-sm">
              {(s.address || s.city) && (
                <div>
                  <dt className="font-semibold">Adresse</dt>
                  <dd>{[s.address, s.city].filter(Boolean).join(', ')}</dd>
                </div>
              )}
              {s.hours && (
                <div>
                  <dt className="font-semibold">Horaires</dt>
                  <dd>{s.hours}</dd>
                </div>
              )}
              {s.phone && (
                <div>
                  <dt className="font-semibold">Téléphone</dt>
                  <dd>{s.phone}</dd>
                </div>
              )}
              {s.email && (
                <div>
                  <dt className="font-semibold">E-mail</dt>
                  <dd>
                    <a className="text-forest underline" href={`mailto:${s.email}`}>
                      {s.email}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {s.mapUrl && (
              <a
                href={s.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block font-semibold text-forest underline"
              >
                Voir sur la carte
              </a>
            )}
          </div>
          {s.forms.length > 0 && (
            <div id="demande">
              <h2 className="font-display text-2xl font-bold">Votre demande</h2>
              <p className="mt-1 text-sm text-muted">
                Ajoutez des articles depuis le catalogue pour demander un devis ; le magasin vous
                recontacte rapidement.
              </p>
              <StockRequestForm slug={data.slug} forms={s.forms} />
            </div>
          )}
        </section>
      </div>
    </StockSiteShell>
  );
}
