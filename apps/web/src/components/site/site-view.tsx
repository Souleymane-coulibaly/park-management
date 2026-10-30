import type { CSSProperties, ReactNode } from 'react';
import {
  Clock,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
} from 'lucide-react';
import {
  ISO_WEEKDAY_LABELS,
  type PublishedSite,
  SITE_SECTION_LABELS,
  type SiteSection,
  formatXof,
  sectionsFor,
} from '@ocall/shared';

/**
 * Rendu d'un site vitrine publié (ou de son aperçu). Composant sans état : utilisable côté serveur
 * (pages publiques mises en cache) comme dans l'aperçu de l'éditeur.
 *
 * Sécurité : tous les textes sont rendus comme du TEXTE (React échappe tout) — aucun HTML du client
 * n'est interprété. Aucune action d'achat, de réservation, de commande ni de paiement : informations
 * et prix indicatifs uniquement.
 */

const THEMES = {
  CLASSIC: {
    page: 'bg-white text-[#24352F]',
    band: 'bg-[#F7F5F0]',
    card: 'bg-white border border-[#E2DACB]',
  },
  MODERN: { page: 'bg-white text-[#1d2723]', band: 'bg-[#F3F4F2]', card: 'bg-white shadow-md' },
  WARM: {
    page: 'bg-[#F6F0E5] text-[#24352F]',
    band: 'bg-[#EFE4D0]',
    card: 'bg-[#FFFBF4] border border-[#E2D3B8]',
  },
} as const;

const digits = (phone: string) => phone.replace(/[^0-9]/g, '');

export function SiteView({ site, banner }: { site: PublishedSite; banner?: ReactNode }) {
  const c = site.content;
  const theme = THEMES[site.theme] ?? THEMES.CLASSIC;
  const allowed = sectionsFor(site.businessType);
  const order = c.sections.order.filter(
    (s) => allowed.includes(s) && !c.sections.hidden.includes(s),
  );
  const brand = { '--brand': site.primaryColor } as CSSProperties;
  const mapLink =
    c.latitude !== null && c.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`
      : c.address
        ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${c.address} ${c.city}`)}`
        : null;

  const sections: Record<SiteSection, ReactNode> = {
    about: c.description ? (
      <p className="max-w-3xl whitespace-pre-line text-[17px] leading-relaxed">{c.description}</p>
    ) : null,
    gallery: site.gallery.length ? (
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {site.gallery.map((m) => (
          <li key={m.url} className="overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.url}
              alt={m.alt}
              width={m.width}
              height={m.height}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] h-full w-full object-cover"
            />
          </li>
        ))}
      </ul>
    ) : null,
    attractions: c.attractions.length ? (
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {c.attractions.map((a) => (
          <li key={a.name} className={`rounded-xl p-4 ${theme.card}`}>
            <p className="font-semibold">{a.name}</p>
            {a.description && (
              <p className="mt-1 whitespace-pre-line text-sm opacity-80">{a.description}</p>
            )}
          </li>
        ))}
      </ul>
    ) : null,
    menu: site.menu.length ? (
      <div className="grid gap-6 md:grid-cols-2">
        {site.menu.map((g) => (
          <div key={g.category}>
            <h3 className="mb-2 text-lg font-bold" style={{ color: 'var(--brand)' }}>
              {g.category}
            </h3>
            <ul className="divide-y divide-black/10">
              {g.items.map((i) => (
                <li key={i.name} className="flex items-baseline justify-between gap-4 py-2">
                  <span>
                    <span className="font-medium">{i.name}</span>
                    {i.description && (
                      <span className="block text-sm opacity-75">{i.description}</span>
                    )}
                  </span>
                  {i.price !== null && (
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatXof(i.price)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm opacity-70 md:col-span-2">
          Prix indicatifs, susceptibles d’évoluer. Commandes sur place uniquement.
        </p>
      </div>
    ) : null,
    prices: site.tickets.length ? (
      <div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {site.tickets.map((t) => (
            <li key={t.name} className={`rounded-xl p-4 ${theme.card}`}>
              <p className="font-semibold">{t.name}</p>
              {t.price !== null && (
                <p
                  className="mt-1 font-display text-2xl font-bold"
                  style={{ color: 'var(--brand)' }}
                >
                  {formatXof(t.price)}
                </p>
              )}
              {t.peopleIncluded > 1 && (
                <p className="text-sm opacity-75">Pour {t.peopleIncluded} personnes</p>
              )}
              {t.description && <p className="mt-1 text-sm opacity-80">{t.description}</p>}
              {t.conditions && <p className="mt-1 text-sm opacity-70">{t.conditions}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm opacity-70">
          Tarifs indicatifs. Billets en vente sur place uniquement.
        </p>
      </div>
    ) : null,
    services: c.services.length ? (
      <ul className="flex flex-wrap gap-2">
        {c.services.map((s) => (
          <li key={s} className={`rounded-full px-4 py-1.5 text-sm ${theme.card}`}>
            {s}
          </li>
        ))}
      </ul>
    ) : null,
    hours: (
      <div className="max-w-md">
        <table className="w-full text-[15px]">
          <tbody>
            {c.hours.map((h) => (
              <tr key={h.weekday} className="border-b border-black/10">
                <th scope="row" className="py-2 text-left font-medium">
                  {ISO_WEEKDAY_LABELS[h.weekday - 1]}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {h.closed ? 'Fermé' : `${h.opens} – ${h.closes}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.hoursNote && <p className="mt-2 text-sm opacity-75">{c.hoursNote}</p>}
      </div>
    ),
    safety: c.safetyInfo ? <p className="max-w-3xl whitespace-pre-line">{c.safetyInfo}</p> : null,
    practical: c.practicalInfo ? (
      <p className="max-w-3xl whitespace-pre-line">{c.practicalInfo}</p>
    ) : null,
    contact: (
      <ul className="grid gap-3 sm:grid-cols-2">
        {(c.address || c.city) && (
          <Contact icon={<MapPin className="h-5 w-5" />} label="Adresse">
            {[c.address, c.city].filter(Boolean).join(', ')}
            {mapLink && (
              <a
                href={mapLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block font-semibold underline"
                style={{ color: 'var(--brand)' }}
              >
                Voir sur la carte
              </a>
            )}
          </Contact>
        )}
        {c.phone && (
          <Contact icon={<Phone className="h-5 w-5" />} label="Téléphone">
            <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} className="underline">
              {c.phone}
            </a>
          </Contact>
        )}
        {c.whatsapp && (
          <Contact icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp">
            <a
              href={`https://wa.me/${digits(c.whatsapp)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {c.whatsapp}
            </a>
          </Contact>
        )}
        {c.email && (
          <Contact icon={<Mail className="h-5 w-5" />} label="E-mail">
            <a href={`mailto:${c.email}`} className="underline">
              {c.email}
            </a>
          </Contact>
        )}
      </ul>
    ),
  };

  const socials = [
    { url: c.socials.facebook, label: 'Facebook', icon: <Facebook className="h-5 w-5" /> },
    { url: c.socials.instagram, label: 'Instagram', icon: <Instagram className="h-5 w-5" /> },
    { url: c.socials.tiktok, label: 'TikTok', icon: <Globe className="h-5 w-5" /> },
    { url: c.socials.website, label: 'Site web', icon: <Globe className="h-5 w-5" /> },
  ].filter((s) => s.url);

  return (
    <div className={`min-h-screen ${theme.page}`} style={brand}>
      {banner}
      <header className="relative isolate overflow-hidden">
        {site.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={site.cover.url}
            alt={site.cover.alt}
            width={site.cover.width}
            height={site.cover.height}
            fetchPriority="high"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
        )}
        <div
          className={`${site.cover ? 'bg-black/55 text-white' : theme.band} ${site.theme === 'MODERN' ? 'py-20 sm:py-28' : 'py-14 sm:py-20'}`}
        >
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            {site.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={site.logo.url}
                alt={site.logo.alt || `Logo ${c.publicName}`}
                width={site.logo.width}
                height={site.logo.height}
                className="mb-5 h-16 w-auto rounded-lg bg-white/90 p-1.5 sm:h-20"
              />
            )}
            <h1
              className={`font-display font-bold leading-tight ${site.theme === 'MODERN' ? 'text-4xl sm:text-6xl' : 'text-3xl sm:text-5xl'}`}
            >
              {c.publicName}
            </h1>
            {c.tagline && (
              <p className="mt-3 max-w-2xl text-lg opacity-90 sm:text-xl">{c.tagline}</p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              {c.phone && (
                <a
                  href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-semibold text-white"
                  style={{ background: 'var(--brand)' }}
                >
                  <Phone className="h-4 w-4" aria-hidden /> Appeler
                </a>
              )}
              {c.whatsapp && (
                <a
                  href={`https://wa.me/${digits(c.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 font-semibold text-[#24352F] ring-1 ring-black/10"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
                </a>
              )}
              {mapLink && (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 font-semibold text-[#24352F] ring-1 ring-black/10"
                >
                  <MapPin className="h-4 w-4" aria-hidden /> Itinéraire
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      <main>
        {order.map((key, i) =>
          sections[key] ? (
            <section
              key={key}
              id={key}
              aria-labelledby={`${key}-title`}
              className={i % 2 === 1 ? theme.band : ''}
            >
              <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
                <h2
                  id={`${key}-title`}
                  className="mb-5 flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl"
                >
                  {key === 'hours' && (
                    <Clock className="h-6 w-6" style={{ color: 'var(--brand)' }} aria-hidden />
                  )}
                  {SITE_SECTION_LABELS[key]}
                </h2>
                {sections[key]}
              </div>
            </section>
          ) : null,
        )}
      </main>

      <footer className="border-t border-black/10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm sm:px-6">
          <p>© {c.publicName}</p>
          {socials.length > 0 && (
            <ul className="flex gap-3">
              {socials.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="grid h-11 w-11 place-items-center rounded-full ring-1 ring-black/10"
                  >
                    {s.icon}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="opacity-60">Site réalisé avec Ocall Park</p>
        </div>
      </footer>
    </div>
  );
}

function Contact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold opacity-70">{label}</span>
        {children}
      </span>
    </li>
  );
}

/** Données structurées schema.org : texte échappé, `<` neutralisé pour ne jamais fermer la balise. */
export function siteJsonLd(site: PublishedSite, canonicalUrl: string): string {
  const c = site.content;
  const types =
    site.businessType === 'PARK'
      ? 'AmusementPark'
      : site.businessType === 'RESTAURANT'
        ? 'Restaurant'
        : ['AmusementPark', 'Restaurant'];
  const absolute = (u: string) => new URL(u, canonicalUrl).toString();
  const data = {
    '@context': 'https://schema.org',
    '@type': types,
    name: c.publicName,
    description: c.tagline || c.description.slice(0, 300) || undefined,
    url: canonicalUrl,
    image: site.cover ? absolute(site.cover.url) : site.logo ? absolute(site.logo.url) : undefined,
    logo: site.logo ? absolute(site.logo.url) : undefined,
    telephone: c.phone || undefined,
    email: c.email || undefined,
    address:
      c.address || c.city
        ? {
            '@type': 'PostalAddress',
            streetAddress: c.address || undefined,
            addressLocality: c.city || undefined,
          }
        : undefined,
    geo:
      c.latitude !== null && c.longitude !== null
        ? { '@type': 'GeoCoordinates', latitude: c.latitude, longitude: c.longitude }
        : undefined,
    openingHoursSpecification: c.hours
      .filter((h) => !h.closed)
      .map((h) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
          h.weekday - 1
        ],
        opens: h.opens,
        closes: h.closes,
      })),
    sameAs: [c.socials.facebook, c.socials.instagram, c.socials.tiktok].filter(Boolean),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
