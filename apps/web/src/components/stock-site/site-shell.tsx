import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  STOCK_AI_ILLUSTRATION_LABEL,
  STOCK_SHOWCASE_AVAILABILITY_LABELS,
  type StockShowcaseProduct,
  type StockShowcasePublished,
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

export function ProductCard({ product, base }: { product: StockShowcaseProduct; base: string }) {
  return (
    <li className="group min-w-0 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 transition motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-lg">
      <Link href={`${base}/article/${product.id}`} className="block">
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

/**
 * Habillage public d'une vitrine Stock (mise en page des sites Park) : en-tête fixe, contenu, pied de page,
 * bouton WhatsApp mobile, couleur principale de l'entreprise. Les liens suivent l'adresse servie (`base` :
 * vide sur l'hôte de la vitrine, `/m/<slug>` sur l'application).
 */
export function StockSiteShell({
  site,
  base,
  children,
}: {
  site: StockShowcasePublished;
  base: string;
  children: ReactNode;
}) {
  const wa = site.whatsapp ? whatsappDigits(site.whatsapp) : null;
  const home = base || '/';
  const cta: PremiumCta | null = wa
    ? { href: whatsappUrl(wa), label: 'Écrire sur WhatsApp', kind: 'whatsapp' }
    : site.phone
      ? { href: `tel:${site.phone.replace(/[^+\d]/g, '')}`, label: 'Appeler', kind: 'phone' }
      : null;
  return (
    <PremiumSite
      brandColor={site.primaryColor}
      name={site.businessName}
      homeHref={home}
      logoUrl={site.logo ? stockMediaUrl(site.logo) : null}
      nav={[
        { href: home, label: 'Accueil' },
        ...(site.showCatalog ? [{ href: `${base}/catalogue`, label: 'Catalogue' }] : []),
        { href: `${base}/#contact`, label: 'Contact' },
        ...(site.forms.length > 0 ? [{ href: `${base}/#demande`, label: 'Ma demande' }] : []),
      ]}
      cta={cta}
      ctaTestId={wa ? 'stock-site-whatsapp' : undefined}
      whatsappHref={wa ? whatsappUrl(wa) : null}
      footer={{
        tagline: site.tagline,
        hours: site.hours,
        address: [site.address, site.city].filter(Boolean).join(', ') || null,
        phone: site.phone,
        email: site.email,
        poweredBy: 'Site réalisé avec Ocall Stock',
      }}
      testId="stock-site"
    >
      {children}
    </PremiumSite>
  );
}
