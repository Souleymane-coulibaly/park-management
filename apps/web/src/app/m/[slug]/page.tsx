import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { stockShowcaseStoreJsonLd, whatsappDigits, whatsappUrl } from '@ocall/shared';
import {
  ContactCards,
  GalleryMosaic,
  PREMIUM_CARD,
  PremiumHero,
  PremiumSection,
} from '@/components/site/showcase-premium';
import { StockRequestForm } from '@/components/stock-site/request';
import {
  ProductCard,
  StockSiteShell,
  shopContact,
  shopHref,
} from '@/components/stock-site/site-shell';
import { fetchStockSite, shopParam, stockMediaUrl, stockSiteBase } from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };
type Props = Params & { searchParams: Promise<{ boutique?: string | string[] }> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

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

export default async function StockSiteHomePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const boutique = shopParam(one((await searchParams).boutique));
  const data = await fetchStockSite(slug, boutique);
  if (!data) notFound();
  const base = await stockSiteBase(data, boutique ? `?boutique=${boutique}` : '');
  const s = data.site;
  const shop = data.shop ?? null;
  const contact = shopContact(s, shop);
  const jsonLd = stockShowcaseStoreJsonLd(s, data.url, (key) =>
    new URL(stockMediaUrl(key), data.url).toString(),
  );

  const wa = contact.whatsapp ? whatsappDigits(contact.whatsapp) : null;
  const waHref = wa ? whatsappUrl(wa) : null;
  // Sections affichées, dans l'ordre : fonds alternés comme sur les sites Park.
  const sections = [
    s.about ? 'about' : null,
    s.showCatalog && data.featured.length > 0 ? 'featured' : null,
    s.gallery.length > 0 ? 'gallery' : null,
    'contact',
  ].filter((x): x is string => x !== null);
  const tinted = (key: string) => sections.indexOf(key) % 2 === 0;

  return (
    <StockSiteShell site={s} base={base} shop={shop}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <PremiumHero
        coverUrl={s.cover ? stockMediaUrl(s.cover) : null}
        eyebrow={[s.businessName, s.city].filter(Boolean).join(' · ')}
        title={s.headline}
        tagline={s.tagline}
        cta={
          s.showCatalog
            ? {
                href: shopHref(`${base}/catalogue`, shop),
                label: 'Voir le catalogue',
                kind: 'link',
              }
            : waHref
              ? { href: waHref, label: 'Écrire sur WhatsApp', kind: 'whatsapp' }
              : null
        }
        discoverHref={`#${sections[0]}`}
      />

      {s.about && (
        <PremiumSection
          id="about"
          eyebrow="Bienvenue"
          title="Qui sommes-nous"
          tinted={tinted('about')}
        >
          <p className="max-w-3xl whitespace-pre-line text-lg leading-relaxed opacity-85">
            {s.about}
          </p>
        </PremiumSection>
      )}

      {s.showCatalog && data.featured.length > 0 && (
        <PremiumSection
          id="featured"
          eyebrow="Catalogue"
          title="Nos articles"
          tinted={tinted('featured')}
          testId="stock-site-featured"
          action={
            <Link
              href={shopHref(`${base}/catalogue`, shop)}
              className="inline-flex min-h-11 items-center rounded-full px-5 font-semibold text-white"
              style={{ background: 'var(--brand)' }}
            >
              Tout le catalogue
            </Link>
          }
        >
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.featured.map((p) => (
              <ProductCard key={p.id} product={p} base={base} shop={shop} />
            ))}
          </ul>
        </PremiumSection>
      )}

      {s.gallery.length > 0 && (
        <PremiumSection
          id="gallery"
          eyebrow="En images"
          title="Le magasin"
          tinted={tinted('gallery')}
        >
          <GalleryMosaic
            items={s.gallery.map((g) => ({
              src: stockMediaUrl(g.key),
              alt: g.caption ?? 'Le magasin',
              caption: g.caption,
            }))}
          />
        </PremiumSection>
      )}

      <PremiumSection
        id="contact"
        eyebrow="Nous trouver"
        title={shop ? shop.name : 'Localisation et contact'}
        tinted={tinted('contact')}
      >
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <ContactCards
            address={contact.address}
            mapUrl={contact.mapUrl}
            hours={contact.hours}
            phone={contact.phone}
            whatsapp={contact.whatsapp}
            whatsappHref={waHref}
            email={contact.email}
          />
          {s.forms.length > 0 && (
            <div id="demande" className={`scroll-mt-20 ${PREMIUM_CARD}`}>
              <h3 className="font-display text-2xl font-bold">Votre demande</h3>
              <p className="mt-1 text-sm opacity-70">
                Ajoutez des articles depuis le catalogue pour demander un devis ; le magasin vous
                recontacte rapidement.
              </p>
              <StockRequestForm
                slug={data.slug}
                forms={s.forms}
                shop={shop ? { siteId: shop.siteId, name: shop.name } : null}
              />
            </div>
          )}
        </div>
      </PremiumSection>
    </StockSiteShell>
  );
}
