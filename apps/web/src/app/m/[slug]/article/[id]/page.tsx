import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { STOCK_AI_ILLUSTRATION_LABEL, stockShowcaseProductJsonLd } from '@ocall/shared';
import { PremiumPageTitle } from '@/components/site/showcase-premium';
import { AddToRequest } from '@/components/stock-site/request';
import {
  AvailabilityBadge,
  PublicPrice,
  StockSiteShell,
  shopHref,
} from '@/components/stock-site/site-shell';
import {
  fetchStockProduct,
  shopParam,
  stockImageUrl,
  stockSiteBase,
} from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; id: string }> };
type Props = Params & { searchParams: Promise<{ boutique?: string | string[] }> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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
export default async function StockSiteProductPage({ params, searchParams }: Props) {
  const { slug, id } = await params;
  const boutique = shopParam(one((await searchParams).boutique));
  const data = await fetchStockProduct(slug, id, boutique);
  if (!data) notFound();
  const p = data.product;
  const shop = data.shop ?? null;
  const base = await stockSiteBase(
    data,
    `/article/${p.id}${boutique ? `?boutique=${boutique}` : ''}`,
  );
  const url = `${data.url}/article/${p.id}`;
  const jsonLd = stockShowcaseProductJsonLd(data.site, p, url, (imageId) =>
    new URL(stockImageUrl(imageId), data.url).toString(),
  );

  return (
    <StockSiteShell site={data.site} base={base} shop={shop}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <PremiumPageTitle
        eyebrow={
          <>
            <Link href={shopHref(`${base}/catalogue`, shop)} className="underline">
              Catalogue
            </Link>
            {p.category && <> · {p.category.name}</>}
          </>
        }
        title={p.name}
      />
      <article
        className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 [&>*]:min-w-0"
        data-testid="stock-site-product"
      >
        <div className="space-y-3">
          {p.images.length > 0 ? (
            p.images.map((imageId, i) => (
              <figure key={imageId} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- photo publiée servie par l'API */}
                <img
                  src={stockImageUrl(imageId)}
                  alt={
                    p.illustrations.includes(imageId)
                      ? `${STOCK_AI_ILLUSTRATION_LABEL} : ${p.name}`
                      : i === 0
                        ? p.name
                        : `${p.name} — photo ${i + 1}`
                  }
                  className="w-full rounded-3xl bg-[#F4F9FC] object-cover shadow-sm ring-1 ring-black/5"
                />
                {p.illustrations.includes(imageId) && (
                  <figcaption className="text-xs opacity-70">
                    {STOCK_AI_ILLUSTRATION_LABEL}
                  </figcaption>
                )}
              </figure>
            ))
          ) : (
            <div
              className="flex aspect-square items-center justify-center rounded-3xl font-medium text-white/90"
              style={{
                background:
                  'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, white))',
              }}
            >
              Photo à venir
            </div>
          )}
        </div>
        <div className="space-y-4">
          {p.brand && <p className="text-sm opacity-70">Marque : {p.brand}</p>}
          <p className="text-2xl">
            <PublicPrice product={p} />
            {p.priceTtc !== null && <span className="text-sm opacity-70"> / {p.unit}</span>}
          </p>
          <AvailabilityBadge product={p} />
          {p.description && (
            <p className="whitespace-pre-line text-lg leading-relaxed opacity-85">
              {p.description}
            </p>
          )}
          {data.site.forms.includes('QUOTE') && (
            <div className="space-y-3 rounded-3xl bg-[#F4F9FC] p-6 ring-1 ring-black/5">
              <p className="text-sm font-semibold">Demander un devis</p>
              <AddToRequest slug={data.slug} product={{ id: p.id, name: p.name }} withQuantity />
              <Link
                href={shopHref(`${base}/#demande`, shop)}
                className="text-sm font-semibold underline"
                style={{ color: 'var(--brand)' }}
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
