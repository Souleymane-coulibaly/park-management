import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, Clock, Mail, MapPin, Menu, MessageCircle, Phone } from 'lucide-react';
import { SITE_ACCENT_TEXT, SITE_DEFAULT_ACCENT, showcaseBrandColor } from '@ocall/shared';

/**
 * Mise en page « premium » des vitrines Ocall Stock et Ocall Facture, reprise du thème Aqua Premium des
 * sites Park : en-tête fixe (logo, navigation, appel à l'action, menu mobile sans JavaScript), accueil
 * plein écran, sections alternées aux titres soignés, cartes de contact, galerie en mosaïque, pied de page
 * sombre et bouton WhatsApp permanent sur mobile. Couleur principale choisie par l'entreprise.
 *
 * Composants sans état, rendus côté serveur. Tous les textes sont rendus comme du TEXTE.
 */

export const ACCENT_BUTTON = {
  background: 'var(--accent)',
  color: SITE_ACCENT_TEXT,
} as CSSProperties;
const tel = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

export interface PremiumNavItem {
  href: string;
  label: string;
}

export interface PremiumCta {
  href: string;
  label: string;
  kind: 'whatsapp' | 'phone' | 'link';
}

function CtaIcon({ kind }: { kind: PremiumCta['kind'] }) {
  if (kind === 'whatsapp') return <MessageCircle className="h-5 w-5" aria-hidden />;
  if (kind === 'phone') return <Phone className="h-5 w-5" aria-hidden />;
  return null;
}

function CtaLink({
  cta,
  className,
  testId,
}: {
  cta: PremiumCta;
  className: string;
  testId?: string;
}) {
  return (
    <a
      href={cta.href}
      {...(cta.kind === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={className}
      style={ACCENT_BUTTON}
      data-testid={testId}
    >
      <CtaIcon kind={cta.kind} /> {cta.label}
    </a>
  );
}

/** Habillage complet : en-tête fixe, contenu, pied de page, bouton WhatsApp mobile. */
export function PremiumSite({
  brandColor,
  name,
  homeHref,
  logoUrl,
  nav,
  cta,
  ctaTestId,
  whatsappHref,
  footer,
  testId,
  children,
}: {
  brandColor: string | null | undefined;
  name: string;
  homeHref: string;
  logoUrl: string | null;
  nav: PremiumNavItem[];
  cta: PremiumCta | null;
  ctaTestId?: string;
  whatsappHref: string | null;
  footer: {
    tagline: string | null;
    hours: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    poweredBy: string;
  };
  testId: string;
  children: ReactNode;
}) {
  const vars = {
    '--brand': showcaseBrandColor(brandColor),
    '--accent': SITE_DEFAULT_ACCENT,
  } as CSSProperties;
  return (
    <div
      className="min-h-screen overflow-x-clip scroll-smooth bg-white font-sans text-[#0B1F2E]"
      style={vars}
      data-testid={testId}
    >
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href={homeHref} className="flex min-w-0 items-center gap-2.5 font-display font-bold">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
              <img src={logoUrl} alt={`Logo ${name}`} className="h-10 w-auto rounded-lg" />
            )}
            <span className="truncate">{name}</span>
          </a>
          <nav
            className="hidden items-center gap-6 text-[15px] font-medium md:flex"
            aria-label="Navigation"
          >
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="opacity-80 hover:opacity-100">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {cta && (
              <CtaLink
                cta={cta}
                testId={ctaTestId}
                className="hidden min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold sm:inline-flex"
              />
            )}
            {nav.length > 0 && (
              <details className="relative md:hidden">
                <summary
                  className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full ring-1 ring-black/10 [&::-webkit-details-marker]:hidden"
                  aria-label="Menu"
                >
                  <Menu className="h-5 w-5" aria-hidden />
                </summary>
                <nav
                  className="absolute right-0 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/10"
                  aria-label="Navigation"
                >
                  {nav.map((n) => (
                    <a
                      key={n.href}
                      href={n.href}
                      className="block rounded-xl px-4 py-3 font-medium hover:bg-black/5"
                    >
                      {n.label}
                    </a>
                  ))}
                </nav>
              </details>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="text-white" style={{ background: '#0B1F2E' }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 [&>*]:min-w-0">
          <div>
            <p className="font-display text-xl font-bold">{name}</p>
            {footer.tagline && <p className="mt-2 text-white/75">{footer.tagline}</p>}
          </div>
          {footer.hours && (
            <div>
              <p className="mb-3 flex items-center gap-2 font-semibold">
                <Clock className="h-4 w-4" aria-hidden /> Horaires
              </p>
              <p className="whitespace-pre-line text-sm text-white/80">{footer.hours}</p>
            </div>
          )}
          <div>
            <p className="mb-3 font-semibold">Contact</p>
            <ul className="space-y-2 break-words text-white/80">
              {footer.address && <li>{footer.address}</li>}
              {footer.phone && (
                <li>
                  <a href={tel(footer.phone)} className="hover:underline">
                    {footer.phone}
                  </a>
                </li>
              )}
              {footer.email && (
                <li>
                  <a href={`mailto:${footer.email}`} className="hover:underline">
                    {footer.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5 text-sm text-white/60 sm:px-6">
            <p>© {name}</p>
            <p>{footer.poweredBy}</p>
          </div>
        </div>
      </footer>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Écrire sur WhatsApp"
          className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full shadow-xl sm:hidden"
          style={ACCENT_BUTTON}
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
        </a>
      )}
    </div>
  );
}

/** Accueil plein écran : photo de couverture (ou dégradé de la couleur principale), titre, actions. */
export function PremiumHero({
  coverUrl,
  eyebrow,
  title,
  tagline,
  cta,
  discoverHref,
  discoverLabel = 'Découvrir',
  extra,
}: {
  coverUrl: string | null;
  eyebrow: string | null;
  title: string;
  tagline: string | null;
  cta: PremiumCta | null;
  discoverHref: string;
  discoverLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <section id="top" className="relative isolate flex min-h-[78svh] items-end overflow-hidden">
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API
        <img src={coverUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
      )}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: coverUrl
            ? 'linear-gradient(180deg, rgba(5,20,32,0.15) 0%, rgba(5,20,32,0.45) 45%, var(--brand) 100%)'
            : 'linear-gradient(135deg, var(--brand), #0B1F2E)',
        }}
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-28 text-white sm:px-6 sm:pb-24 motion-safe:animate-[site-fade-up_.7s_ease-out]">
        {eyebrow && (
          <p className="mb-4 inline-block rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-medium ring-1 ring-white/30 backdrop-blur">
            {eyebrow}
          </p>
        )}
        <h1 className="max-w-3xl break-words font-display text-4xl font-bold leading-[1.05] sm:text-6xl">
          {title}
        </h1>
        {tagline && <p className="mt-4 max-w-2xl text-lg text-white/90 sm:text-xl">{tagline}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          {cta && (
            <CtaLink
              cta={cta}
              className="inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-semibold shadow-lg"
            />
          )}
          <a
            href={discoverHref}
            className="inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-semibold text-white ring-2 ring-white/70 hover:bg-white/10"
          >
            {discoverLabel} <ChevronDown className="h-5 w-5" aria-hidden />
          </a>
          {extra}
        </div>
      </div>
    </section>
  );
}

/** Section de page : fond alterné, titre avec sur-titre à la couleur principale. */
export function PremiumSection({
  id,
  eyebrow,
  title,
  tinted = false,
  action,
  testId,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  tinted?: boolean;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-20 ${tinted ? 'bg-[#F4F9FC]' : 'bg-white'}`}
      data-testid={testId}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            {eyebrow && (
              <p
                className="mb-2 text-sm font-semibold uppercase tracking-[0.18em]"
                style={{ color: 'var(--brand)' }}
              >
                {eyebrow}
              </p>
            )}
            <h2
              id={`${id}-title`}
              className="font-display text-3xl font-bold leading-tight sm:text-4xl"
            >
              {title}
            </h2>
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Titre de page intérieure (catalogue, fiche) sous l'en-tête : bandeau à la couleur principale. */
export function PremiumPageTitle({ eyebrow, title }: { eyebrow?: ReactNode; title: string }) {
  return (
    <div
      className="text-white"
      style={{ background: 'linear-gradient(135deg, var(--brand), #0B1F2E)' }}
    >
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        {eyebrow && <div className="mb-2 text-sm text-white/80">{eyebrow}</div>}
        <h1 className="break-words font-display text-3xl font-bold sm:text-4xl">{title}</h1>
      </div>
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
    <li className="flex min-w-0 gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 break-words">
        <span className="block text-sm font-semibold opacity-60">{label}</span>
        {children}
      </span>
    </li>
  );
}

/** Cartes de contact : adresse (lien de carte), horaires, téléphone, WhatsApp, e-mail. */
export function ContactCards({
  address,
  mapUrl,
  hours,
  phone,
  whatsapp,
  whatsappHref,
  email,
}: {
  address: string | null;
  mapUrl: string | null;
  hours: string | null;
  phone: string | null;
  whatsapp: string | null;
  whatsappHref: string | null;
  email: string | null;
}) {
  return (
    <ul className="space-y-4">
      {(address || mapUrl) && (
        <ContactLine icon={<MapPin className="h-5 w-5" />} label="Adresse">
          {address}
          {mapUrl && (
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block font-semibold underline"
              style={{ color: 'var(--brand)' }}
            >
              Voir sur la carte
            </a>
          )}
        </ContactLine>
      )}
      {hours && (
        <ContactLine icon={<Clock className="h-5 w-5" />} label="Horaires">
          <span className="whitespace-pre-line">{hours}</span>
        </ContactLine>
      )}
      {phone && (
        <ContactLine icon={<Phone className="h-5 w-5" />} label="Téléphone">
          <a href={tel(phone)} className="underline">
            {phone}
          </a>
        </ContactLine>
      )}
      {whatsapp && whatsappHref && (
        <ContactLine icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="underline">
            {whatsapp}
          </a>
        </ContactLine>
      )}
      {email && (
        <ContactLine icon={<Mail className="h-5 w-5" />} label="E-mail">
          <a href={`mailto:${email}`} className="underline">
            {email}
          </a>
        </ContactLine>
      )}
    </ul>
  );
}

/** Galerie en mosaïque ; chaque photo s'ouvre en grand. */
export function GalleryMosaic({
  items,
}: {
  items: { src: string; alt: string; caption: string | null }[];
}) {
  return (
    <ul className="columns-2 gap-3 md:columns-3 [&>li]:mb-3">
      {items.map((m) => (
        <li key={m.src} className="break-inside-avoid overflow-hidden rounded-2xl">
          <a
            href={m.src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Agrandir : ${m.alt}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- image publiée servie par l'API */}
            <img
              src={m.src}
              alt={m.alt}
              loading="lazy"
              className="h-auto w-full transition duration-500 motion-safe:hover:scale-[1.03]"
            />
          </a>
          {m.caption && <p className="bg-white px-3 py-2 text-sm opacity-75">{m.caption}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Carte blanche arrondie (prestations, demande, encadrés). */
export const PREMIUM_CARD = 'rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5';
