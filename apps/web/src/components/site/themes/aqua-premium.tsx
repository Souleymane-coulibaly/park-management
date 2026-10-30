import type { CSSProperties, ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Facebook,
  Globe,
  Instagram,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Waves,
} from 'lucide-react';
import {
  type PublishedSite,
  SITE_ACCENT_TEXT,
  SITE_DEFAULT_ACCENT,
  type SiteSection,
  formatXof,
  sectionsFor,
} from '@ocall/shared';
import { SiteImage } from '../site-image';
import { HoursTable, MapFacade } from './site-client-parts';

/**
 * Thème « OCALL AQUA PREMIUM » : accueil immersif plein écran, chiffres clés, attractions en
 * photos, galerie en mosaïque, tarifs en cartes, restaurant, carte à la demande, bouton WhatsApp
 * permanent sur mobile. Identité propre à Ocall (couleurs de l'établissement), sans script lourd :
 * menu mobile sans JavaScript (<details>), images optimisées, animations désactivées si le
 * visiteur préfère réduire les animations.
 *
 * Vitrine uniquement : aucun achat, réservation, commande ni paiement.
 */

const NAV_LABELS: Partial<Record<SiteSection, string>> = {
  about: 'Le parc',
  attractions: 'Attractions',
  gallery: 'Galerie',
  prices: 'Tarifs',
  menu: 'Restaurant',
  hours: 'Horaires',
  contact: 'Contact',
};

/** Grille des chiffres clés selon leur nombre (classes complètes : Tailwind les détecte). */
const FACT_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

const digits = (phone: string) => phone.replace(/[^0-9]/g, '');
const tel = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

function SectionTitle({ id, eyebrow, title }: { id: string; eyebrow?: string; title: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      {eyebrow && (
        <p
          className="mb-2 text-sm font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--brand)' }}
        >
          {eyebrow}
        </p>
      )}
      <h2 id={`${id}-title`} className="font-display text-3xl font-bold leading-tight sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

export function AquaPremium({ site, banner }: { site: PublishedSite; banner?: ReactNode }) {
  const c = site.content;
  const accent = site.accentColor ?? SITE_DEFAULT_ACCENT;
  const allowed = sectionsFor(site.businessType);
  const order = c.sections.order.filter(
    (s) => allowed.includes(s) && !c.sections.hidden.includes(s),
  );
  const vars = { '--brand': site.primaryColor, '--accent': accent } as CSSProperties;
  const accentButton = { background: 'var(--accent)', color: SITE_ACCENT_TEXT } as CSSProperties;
  const highlights = c.heroHighlights ?? [];
  const restaurant = c.restaurant ?? { description: '', photos: [] };
  const mapLink =
    c.latitude !== null && c.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`
      : c.address
        ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${c.address} ${c.city}`)}`
        : null;

  // Chiffres clés saisis par l'établissement ; sinon déduits des tarifs et horaires publiés.
  const openDay = c.hours.find((h) => !h.closed);
  const minPrice = site.tickets.reduce<number | null>(
    (m, t) => (t.price === null ? m : m === null ? t.price : Math.min(m, t.price)),
    null,
  );
  const facts =
    (c.keyFacts?.length ?? 0) > 0
      ? c.keyFacts!
      : [
          ...(minPrice !== null ? [{ label: 'Entrée', value: `dès ${formatXof(minPrice)}` }] : []),
          ...(openDay
            ? [{ label: 'Horaires', value: `${openDay.opens} – ${openDay.closes}` }]
            : []),
          ...(c.city ? [{ label: 'Où', value: c.city }] : []),
        ];
  const primaryCta = c.whatsapp
    ? {
        href: `https://wa.me/${digits(c.whatsapp)}`,
        label: 'Écrire sur WhatsApp',
        icon: <MessageCircle className="h-5 w-5" aria-hidden />,
        external: true,
      }
    : c.phone
      ? {
          href: tel(c.phone),
          label: 'Appeler',
          icon: <Phone className="h-5 w-5" aria-hidden />,
          external: false,
        }
      : null;
  const navItems = order.filter((s) => NAV_LABELS[s]).slice(0, 6);

  const sections: Record<SiteSection, ReactNode> = {
    about:
      c.description || c.services.length ? (
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <SectionTitle id="about" eyebrow="Bienvenue" title={c.tagline || c.publicName} />
            {c.description && (
              <p className="whitespace-pre-line text-lg leading-relaxed opacity-85">
                {c.description}
              </p>
            )}
          </div>
          {c.services.length > 0 && (
            <ul className="grid gap-3 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
              {c.services.map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full"
                    style={accentButton}
                  >
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="font-medium">{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null,
    services: null, // affichés dans la présentation
    attractions: c.attractions.length ? (
      <>
        <SectionTitle id="attractions" eyebrow="À vivre" title="Attractions et activités" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {c.attractions.map((a) => (
            <li
              key={a.name}
              className="group overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 transition motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-lg"
            >
              <div
                className="relative aspect-[4/3] overflow-hidden"
                style={{
                  background:
                    'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, white))',
                }}
              >
                {a.image ? (
                  <SiteImage
                    media={a.image}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition duration-500 motion-safe:group-hover:scale-105"
                    alt={a.image.alt || a.name}
                  />
                ) : (
                  <Waves className="absolute inset-0 m-auto h-14 w-14 text-white/80" aria-hidden />
                )}
              </div>
              <div className="p-5">
                <h3 className="text-lg font-bold">{a.name}</h3>
                {a.description && (
                  <p className="mt-1.5 whitespace-pre-line text-[15px] opacity-80">
                    {a.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </>
    ) : null,
    gallery: site.gallery.length ? (
      <>
        <SectionTitle id="gallery" eyebrow="En images" title="Galerie" />
        <ul className="columns-2 gap-3 md:columns-3 [&>li]:mb-3">
          {site.gallery.map((m) => (
            <li key={m.url} className="break-inside-avoid overflow-hidden rounded-2xl">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={m.alt ? `Agrandir : ${m.alt}` : 'Agrandir la photo'}
              >
                <SiteImage
                  media={m}
                  sizes="(min-width: 768px) 33vw, 50vw"
                  className="h-auto w-full transition duration-500 motion-safe:hover:scale-[1.03]"
                />
              </a>
            </li>
          ))}
        </ul>
      </>
    ) : null,
    prices: site.tickets.length ? (
      <>
        <SectionTitle id="prices" eyebrow="Tarifs" title="Nos tarifs d’entrée" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {site.tickets.map((t) => (
            <li
              key={t.name}
              className="flex flex-col rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5"
            >
              <p className="text-lg font-bold">{t.name}</p>
              {t.peopleIncluded > 1 && (
                <p className="text-sm opacity-70">Pour {t.peopleIncluded} personnes</p>
              )}
              {t.price !== null && (
                <p
                  className="mt-4 font-display text-4xl font-bold"
                  style={{ color: 'var(--brand)' }}
                >
                  {formatXof(t.price)}
                </p>
              )}
              {t.description && <p className="mt-3 text-[15px] opacity-80">{t.description}</p>}
              {t.conditions && <p className="mt-2 text-sm opacity-65">{t.conditions}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm opacity-70">
          Tarifs indicatifs. Billets en vente sur place uniquement.
        </p>
      </>
    ) : null,
    hours: (
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <SectionTitle id="hours" eyebrow="Planifiez votre visite" title="Horaires d’ouverture" />
        <HoursTable hours={c.hours} note={c.hoursNote || undefined} />
      </div>
    ),
    menu:
      site.menu.length || restaurant.description || restaurant.photos.length ? (
        <>
          <SectionTitle id="menu" eyebrow="Restaurant" title="Se restaurer sur place" />
          {restaurant.description && (
            <p className="mb-6 max-w-3xl whitespace-pre-line text-lg opacity-85">
              {restaurant.description}
            </p>
          )}
          {restaurant.photos.length > 0 && (
            <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {restaurant.photos.map((m) => (
                <li key={m.url} className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                  <SiteImage
                    media={m}
                    fill
                    sizes="(min-width: 640px) 33vw, 50vw"
                    className="object-cover"
                  />
                </li>
              ))}
            </ul>
          )}
          {site.menu.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              {site.menu.map((g) => (
                <div
                  key={g.category}
                  className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5"
                >
                  <h3 className="mb-3 text-lg font-bold" style={{ color: 'var(--brand)' }}>
                    {g.category}
                  </h3>
                  <ul className="divide-y divide-black/10">
                    {g.items.map((i) => (
                      <li key={i.name} className="flex items-baseline justify-between gap-4 py-2.5">
                        <span>
                          <span className="font-medium">{i.name}</span>
                          {i.description && (
                            <span className="block text-sm opacity-70">{i.description}</span>
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
                Prix indicatifs. Commandes sur place uniquement.
              </p>
            </div>
          )}
        </>
      ) : null,
    safety: c.safetyInfo ? (
      <div className="flex gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <ShieldCheck className="h-8 w-8 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden />
        <div>
          <h2 id="safety-title" className="font-display text-2xl font-bold">
            Votre sécurité
          </h2>
          <p className="mt-2 whitespace-pre-line opacity-85">{c.safetyInfo}</p>
        </div>
      </div>
    ) : null,
    practical: c.practicalInfo ? (
      <div className="flex gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
        <Sparkles className="h-8 w-8 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden />
        <div>
          <h2 id="practical-title" className="font-display text-2xl font-bold">
            Informations pratiques
          </h2>
          <p className="mt-2 whitespace-pre-line opacity-85">{c.practicalInfo}</p>
        </div>
      </div>
    ) : null,
    contact: (
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <SectionTitle id="contact" eyebrow="Nous trouver" title="Localisation et contact" />
          <ul className="space-y-4">
            {(c.address || c.city) && (
              <ContactLine icon={<MapPin className="h-5 w-5" />} label="Adresse">
                {[c.address, c.city].filter(Boolean).join(', ')}
                {mapLink && (
                  <a
                    href={mapLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block font-semibold underline"
                    style={{ color: 'var(--brand)' }}
                  >
                    Itinéraire
                  </a>
                )}
              </ContactLine>
            )}
            {c.phone && (
              <ContactLine icon={<Phone className="h-5 w-5" />} label="Téléphone">
                <a href={tel(c.phone)} className="underline">
                  {c.phone}
                </a>
              </ContactLine>
            )}
            {c.whatsapp && (
              <ContactLine icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp">
                <a
                  href={`https://wa.me/${digits(c.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {c.whatsapp}
                </a>
              </ContactLine>
            )}
            {c.email && (
              <ContactLine icon={<Mail className="h-5 w-5" />} label="E-mail">
                <a href={`mailto:${c.email}`} className="underline">
                  {c.email}
                </a>
              </ContactLine>
            )}
          </ul>
        </div>
        {c.latitude !== null && c.longitude !== null && (
          <MapFacade latitude={c.latitude} longitude={c.longitude} label={c.publicName} />
        )}
      </div>
    ),
  };

  const socials = [
    { url: c.socials.facebook, label: 'Facebook', icon: <Facebook className="h-5 w-5" /> },
    { url: c.socials.instagram, label: 'Instagram', icon: <Instagram className="h-5 w-5" /> },
    { url: c.socials.tiktok, label: 'TikTok', icon: <Globe className="h-5 w-5" /> },
    { url: c.socials.website, label: 'Site web', icon: <Globe className="h-5 w-5" /> },
  ].filter((s) => s.url);

  return (
    <div className="min-h-screen scroll-smooth bg-white font-sans text-[#0B1F2E]" style={vars}>
      {banner}
      {/* En-tête fixe : logo, ancres, appel à l'action ; menu mobile sans JavaScript. */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#top" className="flex min-w-0 items-center gap-2.5 font-display font-bold">
            {site.logo && (
              <SiteImage
                media={site.logo}
                sizes="40px"
                className="h-10 w-auto rounded-lg"
                alt={site.logo.alt || `Logo ${c.publicName}`}
              />
            )}
            <span className="truncate">{c.publicName}</span>
          </a>
          <nav
            className="hidden items-center gap-6 text-[15px] font-medium md:flex"
            aria-label="Sections"
          >
            {navItems.map((s) => (
              <a key={s} href={`#${s}`} className="opacity-80 hover:opacity-100">
                {NAV_LABELS[s]}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {primaryCta && (
              <a
                href={primaryCta.href}
                {...(primaryCta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="hidden min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold sm:inline-flex"
                style={accentButton}
              >
                {primaryCta.icon} {primaryCta.label}
              </a>
            )}
            <details className="relative md:hidden">
              <summary
                className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full ring-1 ring-black/10 [&::-webkit-details-marker]:hidden"
                aria-label="Menu"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </summary>
              <nav
                className="absolute right-0 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/10"
                aria-label="Sections"
              >
                {navItems.map((s) => (
                  <a
                    key={s}
                    href={`#${s}`}
                    className="block rounded-xl px-4 py-3 font-medium hover:bg-black/5"
                  >
                    {NAV_LABELS[s]}
                  </a>
                ))}
              </nav>
            </details>
          </div>
        </div>
      </header>

      {/* Accueil immersif */}
      <section id="top" className="relative isolate flex min-h-[86svh] items-end overflow-hidden">
        {site.cover ? (
          <SiteImage
            media={site.cover}
            fill
            priority
            sizes="100vw"
            className="-z-20 object-cover"
          />
        ) : null}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: site.cover
              ? `linear-gradient(180deg, rgba(5,20,32,0.15) 0%, rgba(5,20,32,0.45) 45%, ${site.primaryColor} 100%)`
              : `linear-gradient(135deg, ${site.primaryColor}, #0B1F2E)`,
          }}
        />
        <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-32 text-white sm:px-6 sm:pb-28 motion-safe:animate-[site-fade-up_.7s_ease-out]">
          {highlights.length > 0 && (
            <ul className="mb-5 flex flex-wrap gap-2">
              {highlights.map((h) => (
                <li
                  key={h}
                  className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium ring-1 ring-white/30 backdrop-blur"
                >
                  {h}
                </li>
              ))}
            </ul>
          )}
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
            {c.publicName}
          </h1>
          {c.tagline && (
            <p className="mt-4 max-w-2xl text-lg text-white/90 sm:text-xl">{c.tagline}</p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            {primaryCta && (
              <a
                href={primaryCta.href}
                {...(primaryCta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-semibold shadow-lg"
                style={accentButton}
              >
                {primaryCta.icon} {primaryCta.label}
              </a>
            )}
            <a
              href={`#${order[0] ?? 'contact'}`}
              className="inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-semibold text-white ring-2 ring-white/70 hover:bg-white/10"
            >
              Découvrir <ChevronDown className="h-5 w-5" aria-hidden />
            </a>
          </div>
        </div>
      </section>

      {/* Chiffres clés */}
      {facts.length > 0 && (
        <div className="relative z-10 mx-auto -mt-14 max-w-6xl px-4 sm:px-6">
          <ul
            className={`grid gap-3 rounded-3xl bg-white p-4 shadow-xl ring-1 ring-black/5 sm:p-6 ${FACT_COLUMNS[facts.length] ?? FACT_COLUMNS[4]}`}
          >
            {facts.map((f) => (
              <li
                key={f.label}
                className="rounded-2xl p-3 text-center sm:p-4"
                style={{ background: 'color-mix(in srgb, var(--accent) 16%, white)' }}
              >
                <p className="break-words font-display text-base font-bold leading-tight sm:text-2xl">
                  {f.value}
                </p>
                <p className="mt-0.5 text-sm opacity-70">{f.label}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <main>
        {order.map((key, i) =>
          sections[key] ? (
            <section
              key={key}
              id={key}
              aria-labelledby={`${key}-title`}
              className={`scroll-mt-20 ${i % 2 === 0 ? 'bg-[#F4F9FC]' : 'bg-white'}`}
            >
              <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">{sections[key]}</div>
            </section>
          ) : null,
        )}
      </main>

      {/* Pied de page */}
      <footer className="text-white" style={{ background: '#0B1F2E' }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-display text-xl font-bold">{c.publicName}</p>
            {c.tagline && <p className="mt-2 text-white/75">{c.tagline}</p>}
            {socials.length > 0 && (
              <ul className="mt-5 flex gap-3">
                {socials.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"
                    >
                      {s.icon}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-3 flex items-center gap-2 font-semibold">
              <Clock className="h-4 w-4" aria-hidden /> Horaires
            </p>
            <ul className="space-y-1 text-white/80">
              {c.hours.map((h) => (
                <li key={h.weekday} className="flex justify-between gap-4 text-sm">
                  <span>{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][h.weekday - 1]}</span>
                  <span className="tabular-nums">
                    {h.closed ? 'Fermé' : `${h.opens} – ${h.closes}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold">Contact</p>
            <ul className="space-y-2 text-white/80">
              {(c.address || c.city) && <li>{[c.address, c.city].filter(Boolean).join(', ')}</li>}
              {c.phone && (
                <li>
                  <a href={tel(c.phone)} className="hover:underline">
                    {c.phone}
                  </a>
                </li>
              )}
              {c.email && (
                <li>
                  <a href={`mailto:${c.email}`} className="hover:underline">
                    {c.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-sm text-white/60 sm:px-6">
            <p>© {c.publicName}</p>
            <p>Site réalisé avec Ocall Park</p>
          </div>
        </div>
      </footer>

      {/* Bouton WhatsApp permanent sur mobile */}
      {c.whatsapp && (
        <a
          href={`https://wa.me/${digits(c.whatsapp)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Écrire sur WhatsApp"
          className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full shadow-xl sm:hidden"
          style={accentButton}
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
        </a>
      )}
    </div>
  );
}

function ContactLine({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden>
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold opacity-60">{label}</span>
        {children}
      </span>
    </li>
  );
}
