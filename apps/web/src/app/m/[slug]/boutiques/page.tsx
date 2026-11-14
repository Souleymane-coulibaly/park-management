import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { whatsappDigits, whatsappUrl } from '@ocall/shared';
import { PREMIUM_CARD, PremiumPageTitle } from '@/components/site/showcase-premium';
import { StockSiteShell, shopHref } from '@/components/stock-site/site-shell';
import { fetchStockSite, shopParam, stockSiteBase } from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ boutique?: string | string[] }>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStockSite(slug);
  if (!data?.site.shops?.length) {
    return { title: { absolute: 'Page introuvable' }, robots: { index: false } };
  }
  return {
    title: { absolute: `Nos boutiques — ${data.site.businessName}` },
    description: `Boutiques de ${data.site.businessName} : adresses, horaires et contacts.`,
    alternates: { canonical: `${data.url}/boutiques` },
    robots: { index: true, follow: true },
  };
}

/**
 * « Nos boutiques » (S10) : boutiques présentées sur la vitrine, avec adresse, horaires et contacts ; le
 * visiteur choisit la sienne pour voir ses prix et sa disponibilité et lui adresser sa demande.
 */
export default async function StockSiteShopsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const boutique = shopParam(one((await searchParams).boutique));
  const data = await fetchStockSite(slug, boutique);
  if (!data?.site.shops?.length) notFound();
  const base = await stockSiteBase(data, '/boutiques');
  const s = data.site;
  const shops = s.shops ?? [];
  const current = data.shop ?? null;

  return (
    <StockSiteShell site={s} base={base} shop={current}>
      <PremiumPageTitle eyebrow={s.businessName} title="Nos boutiques" />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="stock-site-shops">
          {shops.map((shop) => {
            const address = [shop.address, shop.city].filter(Boolean).join(', ');
            const wa = shop.whatsapp ? whatsappDigits(shop.whatsapp) : null;
            const chosen = current?.siteId === shop.siteId;
            const target = s.showCatalog ? `${base}/catalogue` : `${base}/#contact`;
            return (
              <li
                key={shop.siteId}
                className={`${PREMIUM_CARD} min-w-0 space-y-3`}
                data-testid="stock-site-shop"
              >
                <h2 className="font-display text-xl font-bold">{shop.name}</h2>
                {address && <p className="opacity-80">{address}</p>}
                {shop.hours && <p className="text-sm opacity-80">{shop.hours}</p>}
                <ul className="space-y-1 text-sm">
                  {shop.phone && (
                    <li>
                      <a
                        href={`tel:${shop.phone.replace(/[^+\d]/g, '')}`}
                        className="font-semibold underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        {shop.phone}
                      </a>
                    </li>
                  )}
                  {wa && (
                    <li>
                      <a
                        href={whatsappUrl(wa)}
                        className="font-semibold underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        Écrire sur WhatsApp
                      </a>
                    </li>
                  )}
                  {shop.mapUrl && (
                    <li>
                      <a
                        href={shop.mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold underline"
                        style={{ color: 'var(--brand)' }}
                      >
                        Voir sur la carte
                      </a>
                    </li>
                  )}
                </ul>
                <Link
                  href={shopHref(target, shop)}
                  aria-current={chosen ? 'true' : undefined}
                  className="inline-flex min-h-11 items-center rounded-full px-5 font-semibold text-white"
                  style={{ background: 'var(--brand)' }}
                  data-testid="stock-site-shop-choose"
                >
                  {chosen ? 'Boutique choisie' : 'Choisir cette boutique'}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </StockSiteShell>
  );
}
