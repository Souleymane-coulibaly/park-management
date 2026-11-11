import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { factureSiteJsonLd, formatXof, whatsappDigits, whatsappUrl } from '@ocall/shared';
import { FactureRequestForm } from '@/components/facture-site/request-form';
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

  return (
    <main className="min-h-screen bg-ivory text-charcoal" data-testid="facture-site">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <header className="relative overflow-hidden bg-forest text-white">
        {s.cover && (
          // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
          <img
            src={factureMediaUrl(s.cover)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-30"
          />
        )}
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20">
          {s.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
            <img
              src={factureMediaUrl(s.logo)}
              alt={`Logo ${s.businessName}`}
              className="mb-6 h-16 w-auto rounded-lg bg-white p-2"
            />
          )}
          <p className="text-sm font-semibold uppercase tracking-wide text-white/80">
            {s.businessName}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{s.headline}</h1>
          {s.tagline && <p className="mt-3 max-w-2xl text-lg text-white/90">{s.tagline}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            {s.forms.length > 0 && (
              <a
                href="#demande"
                className="rounded-xl bg-white px-5 py-3 font-semibold text-forest"
              >
                Faire une demande
              </a>
            )}
            {wa && (
              <a
                href={whatsappUrl(wa)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white"
                data-testid="facture-site-whatsapp"
              >
                Écrire sur WhatsApp
              </a>
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

        {s.services.length > 0 && (
          <section data-testid="facture-site-services">
            <h2 className="font-display text-2xl font-bold">Nos prestations</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {s.services.map((svc) => (
                <li key={svc.itemId} className="rounded-2xl border border-line bg-surface p-5">
                  <p className="font-semibold">{svc.name}</p>
                  {svc.description && (
                    <p className="mt-1 text-sm text-charcoal-soft">{svc.description}</p>
                  )}
                  {svc.priceTtc !== null && (
                    <p className="mt-2 text-sm font-semibold text-forest">
                      {formatXof(svc.priceTtc)} TTC / {svc.unit}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {s.gallery.length > 0 && (
          <section>
            <h2 className="font-display text-2xl font-bold">Nos réalisations</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {s.gallery.map((g) => (
                <li key={g.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API */}
                  <img
                    src={factureMediaUrl(g.key)}
                    alt={g.caption ?? 'Réalisation'}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl object-cover"
                  />
                  {g.caption && <p className="mt-1 text-xs text-muted">{g.caption}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-8 lg:grid-cols-2">
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
        </section>
      </div>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        {s.businessName} · Site réalisé avec Ocall Facture
      </footer>
    </main>
  );
}
