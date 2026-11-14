import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { factureSiteJsonLd, formatXof, whatsappDigits, whatsappUrl } from '@ocall/shared';
import { FactureRequestForm } from '@/components/facture-site/request-form';
import {
  ContactCards,
  GalleryMosaic,
  PREMIUM_CARD,
  type PremiumCta,
  PremiumHero,
  PremiumSection,
  PremiumSite,
} from '@/components/site/showcase-premium';
import { factureMediaUrl, fetchFactureSite } from '@/lib/public-facture-site';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * Vitrine publique d'une entreprise Ocall Facture (F5) : version PUBLIÉE uniquement, lue sans cache.
 * Une seule adresse canonique (domaine personnalisé actif > sous-domaine > /v/slug) : les autres
 * adresses redirigent (301). Données structurées LocalBusiness pour le référencement local.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchFactureSite(slug);
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
      images: image ? [{ url: new URL(factureMediaUrl(image), data.url).toString() }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function FactureSitePage({ params }: Params) {
  const { slug } = await params;
  const data = await fetchFactureSite(slug);
  if (!data) notFound();
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
  if (host && h.get('x-ocall-site-host') !== '1' && new URL(data.url).host !== host) {
    permanentRedirect(data.url);
  }
  const s = data.site;
  const wa = s.whatsapp ? whatsappDigits(s.whatsapp) : null;
  const jsonLd = factureSiteJsonLd(s, data.url, (key) =>
    new URL(factureMediaUrl(key), data.url).toString(),
  );

  const waHref = wa ? whatsappUrl(wa) : null;
  const headerCta: PremiumCta | null = waHref
    ? { href: waHref, label: 'Écrire sur WhatsApp', kind: 'whatsapp' }
    : s.phone
      ? { href: `tel:${s.phone.replace(/[^+\d]/g, '')}`, label: 'Appeler', kind: 'phone' }
      : null;
  // Sections affichées, dans l'ordre : fonds alternés comme sur les sites Park.
  const sections = [
    s.about ? 'about' : null,
    s.services.length > 0 ? 'services' : null,
    s.gallery.length > 0 ? 'gallery' : null,
    'contact',
  ].filter((x): x is string => x !== null);
  const tinted = (key: string) => sections.indexOf(key) % 2 === 0;

  return (
    <PremiumSite
      brandColor={s.primaryColor}
      name={s.businessName}
      homeHref="#top"
      logoUrl={s.logo ? factureMediaUrl(s.logo) : null}
      nav={[
        ...(s.services.length > 0 ? [{ href: '#services', label: 'Prestations' }] : []),
        ...(s.gallery.length > 0 ? [{ href: '#gallery', label: 'Réalisations' }] : []),
        { href: '#contact', label: 'Contact' },
        ...(s.forms.length > 0 ? [{ href: '#demande', label: 'Demande' }] : []),
      ]}
      cta={headerCta}
      ctaTestId={waHref ? 'facture-site-whatsapp' : undefined}
      whatsappHref={waHref}
      footer={{
        tagline: s.tagline,
        hours: s.hours,
        address: [s.address, s.city].filter(Boolean).join(', ') || null,
        phone: s.phone,
        email: s.email,
        poweredBy: 'Site réalisé avec Ocall Facture',
      }}
      testId="facture-site"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <PremiumHero
        coverUrl={s.cover ? factureMediaUrl(s.cover) : null}
        eyebrow={[s.businessName, s.city].filter(Boolean).join(' · ')}
        title={s.headline}
        tagline={s.tagline}
        cta={
          s.forms.length > 0
            ? { href: '#demande', label: 'Faire une demande', kind: 'link' }
            : headerCta
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

      {s.services.length > 0 && (
        <PremiumSection
          id="services"
          eyebrow="Savoir-faire"
          title="Nos prestations"
          tinted={tinted('services')}
          testId="facture-site-services"
        >
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {s.services.map((svc) => (
              <li key={svc.itemId} className={`flex min-w-0 flex-col ${PREMIUM_CARD}`}>
                <p className="text-lg font-bold">{svc.name}</p>
                {svc.description && (
                  <p className="mt-2 whitespace-pre-line text-[15px] opacity-80">
                    {svc.description}
                  </p>
                )}
                {svc.priceTtc !== null && (
                  <p
                    className="mt-4 font-display text-2xl font-bold"
                    style={{ color: 'var(--brand)' }}
                  >
                    {formatXof(svc.priceTtc)} TTC
                    <span className="text-sm font-normal opacity-70"> / {svc.unit}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </PremiumSection>
      )}

      {s.gallery.length > 0 && (
        <PremiumSection
          id="gallery"
          eyebrow="En images"
          title="Nos réalisations"
          tinted={tinted('gallery')}
        >
          <GalleryMosaic
            items={s.gallery.map((g) => ({
              src: factureMediaUrl(g.key),
              alt: g.caption ?? 'Réalisation',
              caption: g.caption,
            }))}
          />
        </PremiumSection>
      )}

      <PremiumSection
        id="contact"
        eyebrow="Nous trouver"
        title="Localisation et contact"
        tinted={tinted('contact')}
      >
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <ContactCards
            address={[s.address, s.city].filter(Boolean).join(', ') || null}
            mapUrl={s.mapUrl}
            hours={s.hours}
            phone={s.phone}
            whatsapp={s.whatsapp}
            whatsappHref={waHref}
            email={s.email}
          />
          {s.forms.length > 0 && (
            <div id="demande" className={`scroll-mt-20 ${PREMIUM_CARD}`}>
              <h3 className="font-display text-2xl font-bold">Votre demande</h3>
              <p className="mt-1 text-sm opacity-70">
                Nous vous recontactons rapidement. Un rendez-vous demandé est confirmé par
                l’entreprise.
              </p>
              <FactureRequestForm
                slug={data.slug}
                forms={s.forms}
                services={s.services.map((x) => ({ id: x.itemId, name: x.name }))}
              />
            </div>
          )}
        </div>
      </PremiumSection>
    </PremiumSite>
  );
}
