import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  STOCK_AI_ILLUSTRATION_LABEL,
  STOCK_SHOWCASE_AVAILABILITY_LABELS,
  type StockShowcaseProduct,
  type StockShowcasePublished,
  type StockShowcasePublishedShop,
  formatXof,
  whatsappDigits,
  whatsappUrl,
} from '@ocall/shared';
import { type PremiumCta, PremiumSite } from '@/components/site/showcase-premium';
import { stockImageUrl, stockMediaUrl } from '@/lib/public-stock-site';

/** Prix public : prix de vente TTC si l'entreprise l'affiche, sinon « Prix sur demande ». */
export function PublicPrice({ product }: { product: StockShowcaseProduct }) {
  if (product.priceTtc === null) return <span className="opacity-70">Prix sur demande</span>;
  return (
    <span className="font-semibold" style={{ color: 'var(--brand)' }}>
      {product.priceFrom ? 'À partir de ' : ''}
      {formatXof(product.priceTtc)} TTC
    </span>
  );
}

/** Badge de disponibilité : jamais une quantité. */
export function AvailabilityBadge({ product }: { product: StockShowcaseProduct }) {
  const available = product.availability === 'AVAILABLE';
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${available ? 'bg-forest-light text-forest-dark' : 'bg-savanna-light text-charcoal'}`}
    >
      {STOCK_SHOWCASE_AVAILABILITY_LABELS[product.availability]}
    </span>
  );
}

export function ProductCard({
  product,
  base,
  shop = null,
}: {
  product: StockShowcaseProduct;
  base: string;
  shop?: StockShowcasePublishedShop | null;
}) {
  return (
    <li className="group min-w-0 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 transition motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-lg">
      <Link href={shopHref(`${base}/article/${product.id}`, shop)} className="block">
        {product.images[0] ? (
          <div className="relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- photo publiée servie par l'API */}
            <img
              src={stockImageUrl(product.images[0])}
              alt={product.name}
              loading="lazy"
              className="aspect-square w-full bg-[#F4F9FC] object-cover transition duration-500 motion-safe:group-hover:scale-105"
            />
            {product.illustrations.includes(product.images[0]) && (
              <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-charcoal">
                {STOCK_AI_ILLUSTRATION_LABEL}
              </span>
            )}
          </div>
        ) : (
          <div
            className="flex aspect-square w-full items-center justify-center text-sm font-medium text-white/90"
            style={{
              background:
                'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, white))',
            }}
          >
            Photo à venir
          </div>
        )}
        <div className="space-y-1.5 p-4">
          <p className="font-semibold leading-snug">{product.name}</p>
          <p className="text-sm">
            <PublicPrice product={product} />
          </p>
          <AvailabilityBadge product={product} />
        </div>
      </Link>
    </li>
  );
}

/** Lien qui garde la boutique choisie par le visiteur (S10), ancre comprise. */
export function shopHref(path: string, shop: StockShowcasePublishedShop | null | undefined) {
  if (!shop) return path || '/';
  const [p, hash] = path.split('#');
  const q = `${p!.includes('?') ? '&' : '?'}boutique=${shop.siteId}`;
  return `${p || '/'}${q}${hash ? `#${hash}` : ''}`;
}

/** Coordonnées affichées : celles de la boutique choisie, à défaut celles de l'entreprise (S10). */
export function shopContact(
  site: StockShowcasePublished,
  shop: StockShowcasePublishedShop | null | undefined,
) {
  return {
    address: shop
      ? [shop.address, shop.city].filter(Boolean).join(', ') || null
      : [site.address, site.city].filter(Boolean).join(', ') || null,
    mapUrl: shop ? shop.mapUrl : site.mapUrl,
    hours: shop?.hours ?? site.hours,
    phone: shop?.phone ?? site.phone,
    whatsapp: shop?.whatsapp ?? site.whatsapp,
    email: site.email,
  };
}

/** Bandeau du choix de boutique : la boutique choisie et un lien pour en changer, ou l'invitation à choisir. */
function ShopBar({
  site,
  base,
  shop,
}: {
  site: StockShowcasePublished;
  base: string;
  shop: StockShowcasePublishedShop | null;
}) {
  if (!site.shops?.length) return null;
  return (
    <div className="border-b border-black/5 bg-[#F4F9FC]" data-testid="stock-site-shop-bar">
      <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
        {shop ? (
          <>
            <span>
              Votre boutique : <strong data-testid="stock-site-shop-name">{shop.name}</strong>
            </span>
            <Link
              href={`${base}/boutiques`}
              className="font-semibold underline"
              style={{ color: 'var(--brand)' }}
            >
              Changer
            </Link>
          </>
        ) : (
          <>
            <span>Prix et disponibilité selon votre boutique.</span>
            <Link
              href={`${base}/boutiques`}
              className="font-semibold underline"
              style={{ color: 'var(--brand)' }}
              data-testid="stock-site-choose-shop"
            >
              Choisir ma boutique
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Habillage public d'une vitrine Stock (mise en page des sites Park) : en-tête fixe, contenu, pied de page,
 * bouton WhatsApp mobile, couleur principale de l'entreprise. Les liens suivent l'adresse servie (`base` :
 * vide sur l'hôte de la vitrine, `/m/<slug>` sur l'application).
 */
export function StockSiteShell({
  site,
  base,
  shop = null,
  children,
}: {
  site: StockShowcasePublished;
  base: string;
  /** Boutique choisie par le visiteur (S10) : ses coordonnées, liens qui la gardent. */
  shop?: StockShowcasePublishedShop | null;
  children: ReactNode;
}) {
  const contact = shopContact(site, shop);
  const wa = contact.whatsapp ? whatsappDigits(contact.whatsapp) : null;
  const home = base || '/';
  const link = (path: string) => shopHref(path, shop);
  const cta: PremiumCta | null = wa
    ? { href: whatsappUrl(wa), label: 'Écrire sur WhatsApp', kind: 'whatsapp' }
    : contact.phone
      ? { href: `tel:${contact.phone.replace(/[^+\d]/g, '')}`, label: 'Appeler', kind: 'phone' }
      : null;
  return (
    <PremiumSite
      brandColor={site.primaryColor}
      name={site.businessName}
      homeHref={link(home)}
      logoUrl={site.logo ? stockMediaUrl(site.logo) : null}
      nav={[
        { href: link(home), label: 'Accueil' },
        ...(site.showCatalog ? [{ href: link(`${base}/catalogue`), label: 'Catalogue' }] : []),
        ...(site.shops?.length ? [{ href: `${base}/boutiques`, label: 'Nos boutiques' }] : []),
        { href: link(`${base}/#contact`), label: 'Contact' },
        ...(site.forms.length > 0 ? [{ href: link(`${base}/#demande`), label: 'Ma demande' }] : []),
      ]}
      cta={cta}
      ctaTestId={wa ? 'stock-site-whatsapp' : undefined}
      whatsappHref={wa ? whatsappUrl(wa) : null}
      footer={{
        tagline: site.tagline,
        hours: contact.hours,
        address: contact.address,
        phone: contact.phone,
        email: contact.email,
        poweredBy: 'Site réalisé avec Ocall Stock',
      }}
      testId="stock-site"
    >
      <ShopBar site={site} base={base} shop={shop} />
      {children}
    </PremiumSite>
  );
}
