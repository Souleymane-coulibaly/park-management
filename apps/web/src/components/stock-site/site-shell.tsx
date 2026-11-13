import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  STOCK_SHOWCASE_AVAILABILITY_LABELS,
  type StockShowcaseProduct,
  type StockShowcasePublished,
  formatXof,
  whatsappDigits,
  whatsappUrl,
} from '@ocall/shared';
import { stockImageUrl, stockMediaUrl } from '@/lib/public-stock-site';

/** Prix public : prix de vente TTC si l'entreprise l'affiche, sinon « Prix sur demande ». */
export function PublicPrice({ product }: { product: StockShowcaseProduct }) {
  if (product.priceTtc === null) return <span className="text-muted">Prix sur demande</span>;
  return (
    <span className="font-semibold text-forest">
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
    <li className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
      <Link href={`${base}/article/${product.id}`} className="block">
        {product.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo publiée servie par l'API
          <img
            src={stockImageUrl(product.images[0])}
            alt={product.name}
            loading="lazy"
            className="aspect-square w-full bg-ivory object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-ivory text-sm text-muted">
            Photo à venir
          </div>
        )}
        <div className="space-y-1 p-3">
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
 * Habillage public d'une vitrine Stock : en-tête (logo, nom, navigation), contenu, pied de page. Les liens
 * suivent l'adresse servie (`base` : vide sur l'hôte de la vitrine, `/m/<slug>` sur l'application).
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
  return (
    <main className="min-h-screen bg-ivory text-charcoal" data-testid="stock-site">
      <nav className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link
            href={base || '/'}
            className="flex min-w-0 items-center gap-2 font-display font-bold"
          >
            {site.logo && (
              // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
              <img src={stockMediaUrl(site.logo)} alt="" className="h-8 w-auto rounded" />
            )}
            <span className="truncate">{site.businessName}</span>
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link href={base || '/'} className="hover:underline">
              Accueil
            </Link>
            {site.showCatalog && (
              <Link href={`${base}/catalogue`} className="hover:underline">
                Catalogue
              </Link>
            )}
            {site.forms.length > 0 && (
              <Link href={`${base || '/'}#demande`} className="hover:underline">
                Ma demande
              </Link>
            )}
            {wa && (
              <a
                href={whatsappUrl(wa)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-[#25D366] px-3 py-1.5 font-semibold text-white"
                data-testid="stock-site-whatsapp"
              >
                WhatsApp
              </a>
            )}
          </div>
        </div>
      </nav>
      {children}
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        {site.businessName}
        {site.city ? ` · ${site.city}` : ''} · Site réalisé avec Ocall Stock
      </footer>
    </main>
  );
}
