import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { stockShowcaseProductJsonLd } from '@ocall/shared';
import { AddToRequest } from '@/components/stock-site/request';
import { AvailabilityBadge, PublicPrice, StockSiteShell } from '@/components/stock-site/site-shell';
import { fetchStockProduct, stockImageUrl, stockSiteBase } from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, id } = await params;
  const data = await fetchStockProduct(slug, id);
  if (!data) return { title: { absolute: 'Article introuvable' }, robots: { index: false } };
  const p = data.product;
  const url = `${data.url}/article/${p.id}`;
  const description = (p.description || `${p.name} — ${data.site.businessName}`).slice(0, 160);
  return {
    title: { absolute: `${p.name} — ${data.site.businessName}` },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title: p.name,
      description,
      url,
      siteName: data.site.businessName,
      locale: 'fr_FR',
      images: p.images[0]
        ? [{ url: new URL(stockImageUrl(p.images[0]), data.url).toString() }]
        : undefined,
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Fiche publique d'un article publié : photos, prix (s'il est affiché), disponibilité (badge sans
 * chiffre), ajout à la demande de devis ; données structurées `Product` et `Offer`.
 */
export default async function StockSiteProductPage({ params }: Params) {
  const { slug, id } = await params;
  const data = await fetchStockProduct(slug, id);
  if (!data) notFound();
  const p = data.product;
  const base = await stockSiteBase(data, `/article/${p.id}`);
  const url = `${data.url}/article/${p.id}`;
  const jsonLd = stockShowcaseProductJsonLd(data.site, p, url, (imageId) =>
    new URL(stockImageUrl(imageId), data.url).toString(),
  );

  return (
    <StockSiteShell site={data.site} base={base}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article
        className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-2 [&>*]:min-w-0"
        data-testid="stock-site-product"
      >
        <div className="space-y-3">
          {p.images.length > 0 ? (
            p.images.map((imageId, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- photo publiée servie par l'API
              <img
                key={imageId}
                src={stockImageUrl(imageId)}
                alt={i === 0 ? p.name : `${p.name} — photo ${i + 1}`}
                className="w-full rounded-2xl bg-surface object-cover"
              />
            ))
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-2xl bg-surface text-muted">
              Photo à venir
            </div>
          )}
        </div>
        <div className="space-y-4">
          <nav className="text-sm text-muted">
            <Link href={`${base}/catalogue`} className="underline">
              Catalogue
            </Link>
            {p.category && <> · {p.category.name}</>}
          </nav>
          <h1 className="font-display text-3xl font-bold">{p.name}</h1>
          {p.brand && <p className="text-sm text-muted">Marque : {p.brand}</p>}
          <p className="text-xl">
            <PublicPrice product={p} />
            {p.priceTtc !== null && <span className="text-sm text-muted"> / {p.unit}</span>}
          </p>
          <AvailabilityBadge product={p} />
          {p.description && (
            <p className="whitespace-pre-line text-charcoal-soft">{p.description}</p>
          )}
          {data.site.forms.includes('QUOTE') && (
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold">Demander un devis</p>
              <AddToRequest slug={data.slug} product={{ id: p.id, name: p.name }} withQuantity />
              <Link
                href={`${base || '/'}#demande`}
                className="text-sm font-semibold text-forest underline"
              >
                Voir ma demande et l’envoyer
              </Link>
            </div>
          )}
        </div>
      </article>
    </StockSiteShell>
  );
}
