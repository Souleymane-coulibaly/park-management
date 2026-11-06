import type { CSSProperties, ReactNode } from 'react';
import {
  SCHOOL_SITE_PAGES,
  SCHOOL_SITE_PAGE_LABELS,
  type SchoolSiteLanguage,
  type SchoolSitePage,
  type SchoolSitePublished,
  type SchoolSitePublishedLink,
  type SchoolSitePublishedMedia,
  type SchoolSitePublishedNews,
  type SchoolSiteText,
  localizedText,
  schoolSitePath,
} from '@ocall/shared';
import { SocialIcon } from './school-site-icons';

/** Données nécessaires au rendu d'une page (version publiée, ou brouillon en prévisualisation). */
export interface SchoolSiteRenderData {
  site: SchoolSitePublished;
  links: SchoolSitePublishedLink[];
  whatsapp: string | null;
  news: (SchoolSitePublishedNews & { status?: string })[];
}

/** Textes fixes des pages publiques, en français et en arabe. */
const UI = {
  skip: { fr: 'Aller au contenu', ar: 'الانتقال إلى المحتوى' },
  menu: { fr: 'Menu', ar: 'القائمة' },
  language: { fr: 'Langue', ar: 'اللغة' },
  follow: { fr: 'Suivez-nous', ar: 'تابعونا' },
  contact: { fr: 'Nous contacter', ar: 'اتصلوا بنا' },
  phone: { fr: 'Téléphone', ar: 'الهاتف' },
  email: { fr: 'E-mail', ar: 'البريد الإلكتروني' },
  address: { fr: 'Adresse', ar: 'العنوان' },
  hours: { fr: 'Horaires', ar: 'المواعيد' },
  map: { fr: 'Voir sur la carte', ar: 'عرض على الخريطة' },
  whatsapp: { fr: 'Écrire sur WhatsApp', ar: 'راسلونا على واتساب' },
  readMore: { fr: 'Lire l’actualité', ar: 'قراءة الخبر' },
  noNews: { fr: 'Aucune actualité pour le moment.', ar: 'لا توجد أخبار حالياً.' },
  noPhotos: { fr: 'Aucune photo pour le moment.', ar: 'لا توجد صور حالياً.' },
  allNews: { fr: 'Toutes les actualités', ar: 'كل الأخبار' },
  latestNews: { fr: 'Dernières actualités', ar: 'آخر الأخبار' },
  fallback: { fr: 'Texte disponible en arabe uniquement', ar: 'النص متوفر بالفرنسية فقط' },
  about: {
    overview: { fr: 'Présentation', ar: 'لمحة عامة' },
    history: { fr: 'Historique', ar: 'التاريخ' },
    mission: { fr: 'Mission', ar: 'الرسالة' },
    values: { fr: 'Valeurs', ar: 'القيم' },
  },
  teaching: {
    levels: { fr: 'Niveaux proposés', ar: 'المستويات المتاحة' },
    programs: { fr: 'Programmes', ar: 'البرامج' },
    languages: { fr: 'Langues d’enseignement', ar: 'لغات التدريس' },
    pedagogy: { fr: 'Informations pédagogiques', ar: 'معلومات تربوية' },
  },
  footer: {
    fr: 'Site publié par l’établissement avec Ocall School.',
    ar: 'موقع تنشره المؤسسة بواسطة Ocall School.',
  },
  readOnly: {
    fr: 'Site maintenu temporairement en consultation.',
    ar: 'الموقع متاح مؤقتاً للاطلاع فقط.',
  },
} as const;

const dirOf = (lang: SchoolSiteLanguage) => (lang === 'ar' ? 'rtl' : 'ltr');
const ui = (t: { fr: string; ar: string }, lang: SchoolSiteLanguage) => t[lang];

/**
 * Texte localisé avec la règle de repli : la langue demandée, sinon l'autre langue avec SA langue et
 * SON sens d'écriture, signalée aux lecteurs d'écran et visuellement. Rien si les deux sont vides.
 */
export function LocalText({
  text,
  lang,
  as: Tag = 'span',
  className,
  multiline = false,
}: {
  text: SchoolSiteText | undefined;
  lang: SchoolSiteLanguage;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div';
  className?: string;
  multiline?: boolean;
}) {
  const l = localizedText(text, lang);
  if (!l) return null;
  const note = l.fallback ? (
    <span
      className="ms-2 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-normal text-muted"
      lang={lang}
      dir={dirOf(lang)}
    >
      {ui(UI.fallback, l.lang === 'ar' ? 'fr' : 'ar')}
    </span>
  ) : null;
  if (multiline) {
    return (
      <div
        lang={l.lang}
        dir={dirOf(l.lang)}
        className={className}
        data-fallback={l.fallback || undefined}
      >
        {l.text.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="mb-3 whitespace-pre-line last:mb-0">
            {para}
          </p>
        ))}
        {note}
      </div>
    );
  }
  return (
    <Tag
      lang={l.lang}
      dir={dirOf(l.lang)}
      className={className}
      data-fallback={l.fallback || undefined}
    >
      {l.text}
      {note}
    </Tag>
  );
}

/** Image publiée : deux tailles réencodées par le serveur, chargement différé (aucun optimiseur tiers). */
function SiteImg({
  media,
  lang,
  className,
  sizes = '100vw',
  eager = false,
}: {
  media: SchoolSitePublishedMedia;
  lang: SchoolSiteLanguage;
  className?: string;
  sizes?: string;
  eager?: boolean;
}) {
  const alt = localizedText(media.alt, lang)?.text ?? '';
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images déjà réencodées en deux tailles par l'API ; aucun cache d'optimiseur qui survivrait à un retrait.
    <img
      src={media.url}
      srcSet={`${media.thumbUrl} 480w, ${media.url} ${media.width}w`}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
    />
  );
}

const THEMES: Record<string, { page: string; header: string; band: string }> = {
  CLASSIC: { page: 'bg-white', header: 'bg-[var(--site-primary)] text-white', band: 'bg-ivory' },
  MODERN: {
    page: 'bg-ivory',
    header: 'bg-white text-charcoal border-b border-line',
    band: 'bg-white',
  },
  WARM: {
    page: 'bg-[#FBF5EC]',
    header: 'bg-[var(--site-primary)] text-white',
    band: 'bg-[#F3E6D3]',
  },
};

export interface SchoolSiteChrome {
  lang: SchoolSiteLanguage;
  page: SchoolSitePage;
  /** Préfixe des liens internes : '' sur le sous-domaine du site, `/s/<slug>` ailleurs. */
  base: string;
  readOnlyUntil?: string | null;
  /** Prévisualisation : liens internes désactivés (aucune navigation hors de l'aperçu). */
  preview?: boolean;
}

function href(
  chrome: SchoolSiteChrome,
  lang: SchoolSiteLanguage,
  page: SchoolSitePage,
  news?: string,
) {
  const path = schoolSitePath(lang, page, news ?? null);
  return chrome.base ? `${chrome.base}${path === '/' ? '' : path}` : path;
}

/** Lien externe : nouvel onglet isolé (aucun accès à la page d'origine, aucun référent transmis). */
function External({
  href: to,
  label,
  children,
  className,
}: {
  href: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={to} target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>
      {children}
    </a>
  );
}

export function SocialLinks({
  links,
  lang,
  className = '',
}: {
  links: SchoolSitePublishedLink[];
  lang: SchoolSiteLanguage;
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <ul
      className={`flex flex-wrap gap-2 ${className}`}
      aria-label={ui(UI.follow, lang)}
      data-testid="site-socials"
    >
      {links.map((l, i) => (
        <li key={`${l.kind}-${i}`}>
          <External
            href={l.url}
            label={l.label}
            className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border border-current/20 px-3 text-sm hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <SocialIcon kind={l.kind} />
            {l.kind === 'OTHER' && <span dir="auto">{l.label}</span>}
          </External>
        </li>
      ))}
    </ul>
  );
}

/** Cadre commun : en-tête, navigation (clavier, mobile sans script), pied de page, bouton WhatsApp. */
export function SchoolSiteShell({
  data,
  chrome,
  children,
}: {
  data: SchoolSiteRenderData;
  chrome: SchoolSiteChrome;
  children: ReactNode;
}) {
  const { site } = data;
  const { lang } = chrome;
  const theme = THEMES[site.theme] ?? THEMES.CLASSIC!;
  const name = localizedText(site.name, lang);
  const other: SchoolSiteLanguage = lang === 'fr' ? 'ar' : 'fr';
  const navLink = (p: SchoolSitePage) => (
    <a
      href={chrome.preview ? undefined : href(chrome, lang, p)}
      aria-current={chrome.page === p ? 'page' : undefined}
      className="block rounded px-3 py-2 text-sm font-medium hover:bg-black/10 focus-visible:outline focus-visible:outline-2 aria-[current=page]:underline aria-[current=page]:underline-offset-4"
    >
      {ui(SCHOOL_SITE_PAGE_LABELS[p], lang)}
    </a>
  );
  return (
    <div
      lang={lang}
      dir={dirOf(lang)}
      data-school-site-lang={lang}
      className={`min-h-screen ${theme.page} text-charcoal ${lang === 'ar' ? 'font-[var(--font-arabic)]' : ''}`}
      style={{ '--site-primary': site.primaryColor } as CSSProperties}
    >
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {ui(UI.skip, lang)}
      </a>
      <header className={theme.header}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <a
            href={chrome.preview ? undefined : href(chrome, lang, 'home')}
            className="flex min-w-0 items-center gap-3"
          >
            {site.logo && (
              <SiteImg
                media={site.logo}
                lang={lang}
                sizes="48px"
                eager
                className="h-12 w-12 rounded-full bg-white object-contain"
              />
            )}
            {name && (
              <span
                lang={name.lang}
                dir={dirOf(name.lang)}
                className="truncate font-display text-lg font-bold"
                data-testid="site-name"
              >
                {name.text}
              </span>
            )}
          </a>
          <div className="flex items-center gap-2">
            {site.languages.includes(other) && (
              <a
                href={chrome.preview ? undefined : href(chrome, other, chrome.page)}
                lang={other}
                hrefLang={other}
                className="rounded border border-current/30 px-2.5 py-1 text-sm"
                data-testid="site-lang-switch"
              >
                {other === 'ar' ? 'العربية' : 'Français'}
              </a>
            )}
            <details className="relative md:hidden">
              <summary className="cursor-pointer list-none rounded border border-current/30 px-3 py-1 text-sm">
                {ui(UI.menu, lang)}
              </summary>
              <nav
                aria-label={ui(UI.menu, lang)}
                className="absolute end-0 z-20 mt-2 w-56 rounded-lg bg-white p-2 text-charcoal shadow-lg"
              >
                <ul>
                  {SCHOOL_SITE_PAGES.map((p) => (
                    <li key={p}>{navLink(p)}</li>
                  ))}
                </ul>
              </nav>
            </details>
          </div>
        </div>
        <nav aria-label={ui(UI.menu, lang)} className="mx-auto hidden max-w-6xl px-2 pb-2 md:block">
          <ul className="flex flex-wrap gap-1">
            {SCHOOL_SITE_PAGES.map((p) => (
              <li key={p}>{navLink(p)}</li>
            ))}
          </ul>
        </nav>
      </header>
      {chrome.readOnlyUntil && (
        <p className="bg-savanna/30 px-4 py-2 text-center text-sm" role="status">
          {ui(UI.readOnly, lang)}
        </p>
      )}
      <main id="contenu" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className={`${theme.band} border-t border-line`}>
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            {name && (
              <p className="font-semibold" lang={name.lang} dir={dirOf(name.lang)}>
                {name.text}
              </p>
            )}
            <LocalText text={site.content.practical.address} lang={lang} as="p" />
            {site.content.practical.phone && (
              <p>
                <a
                  href={`tel:${site.content.practical.phone.replace(/[^+\d]/g, '')}`}
                  dir="ltr"
                  className="underline-offset-2 hover:underline"
                >
                  {site.content.practical.phone}
                </a>
              </p>
            )}
            {site.content.practical.email && (
              <p>
                <a
                  href={`mailto:${site.content.practical.email}`}
                  dir="ltr"
                  className="underline-offset-2 hover:underline"
                >
                  {site.content.practical.email}
                </a>
              </p>
            )}
          </div>
          <div className="space-y-2 sm:justify-self-end">
            {data.links.length > 0 && (
              <p className="text-sm font-semibold">{ui(UI.follow, lang)}</p>
            )}
            <SocialLinks links={data.links} lang={lang} />
          </div>
        </div>
        <p className="pb-6 text-center text-xs text-muted">{ui(UI.footer, lang)}</p>
      </footer>
      {data.whatsapp && (
        <External
          href={`https://wa.me/${data.whatsapp}`}
          label={ui(UI.whatsapp, lang)}
          className="fixed bottom-4 end-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#1F8F4E] text-white shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <SocialIcon kind="WHATSAPP" className="h-7 w-7" />
        </External>
      )}
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function NewsCard({
  n,
  chrome,
}: {
  n: SchoolSiteRenderData['news'][number];
  chrome: SchoolSiteChrome;
}) {
  const { lang } = chrome;
  return (
    <article
      className="overflow-hidden rounded-xl border border-line bg-white"
      data-testid="site-news"
    >
      {n.image && (
        <SiteImg
          media={n.image}
          lang={lang}
          sizes="(min-width: 768px) 33vw, 100vw"
          className="aspect-[3/2] w-full object-cover"
        />
      )}
      <div className="p-4">
        <time dateTime={n.publishedOn} className="text-xs text-muted" dir="ltr">
          {n.publishedOn}
        </time>
        <h3 className="mt-1 font-semibold">
          <a
            href={chrome.preview ? undefined : href(chrome, lang, 'news', n.slug)}
            className="hover:underline"
          >
            <LocalText text={n.title} lang={lang} />
          </a>
        </h3>
      </div>
    </article>
  );
}

/** Contenu d'une page du site. */
export function SchoolSitePageContent({
  data,
  chrome,
  newsSlug,
}: {
  data: SchoolSiteRenderData;
  chrome: SchoolSiteChrome;
  newsSlug: string | null;
}) {
  const { site } = data;
  const { lang } = chrome;
  const c = site.content;
  const title = (p: SchoolSitePage) => (
    <h1 className="mb-6 font-display text-3xl font-bold">{ui(SCHOOL_SITE_PAGE_LABELS[p], lang)}</h1>
  );
  switch (chrome.page) {
    case 'home':
      return (
        <>
          {site.cover && (
            <SiteImg
              media={site.cover}
              lang={lang}
              eager
              className="mb-6 max-h-[420px] w-full rounded-2xl object-cover"
            />
          )}
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            <LocalText text={site.name} lang={lang} />
          </h1>
          <LocalText
            text={c.home.tagline}
            lang={lang}
            as="p"
            className="mt-2 text-lg text-[var(--site-primary)]"
          />
          <LocalText
            text={c.home.intro}
            lang={lang}
            multiline
            className="mt-6 max-w-3xl leading-relaxed"
          />
          {c.home.highlights.length > 0 && (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {c.home.highlights.map((h, i) => (
                <li key={i} className="rounded-xl border border-line bg-white p-4">
                  <LocalText text={h} lang={lang} />
                </li>
              ))}
            </ul>
          )}
          {data.news.length > 0 && (
            <Section title={ui(UI.latestNews, lang)}>
              <div className="mt-2 grid gap-4 sm:grid-cols-3">
                {data.news.slice(0, 3).map((n) => (
                  <NewsCard key={n.slug} n={n} chrome={chrome} />
                ))}
              </div>
            </Section>
          )}
        </>
      );
    case 'about':
      return (
        <>
          {title('about')}
          {(['overview', 'history', 'mission', 'values'] as const).map((k) =>
            localizedText(c.about[k], lang) ? (
              <Section key={k} title={ui(UI.about[k], lang)}>
                <LocalText text={c.about[k]} lang={lang} multiline />
              </Section>
            ) : null,
          )}
        </>
      );
    case 'teaching':
      return (
        <>
          {title('teaching')}
          {(['levels', 'programs', 'languages', 'pedagogy'] as const).map((k) =>
            localizedText(c.teaching[k], lang) ? (
              <Section key={k} title={ui(UI.teaching[k], lang)}>
                <LocalText text={c.teaching[k]} lang={lang} multiline />
              </Section>
            ) : null,
          )}
        </>
      );
    case 'gallery':
      return (
        <>
          {title('gallery')}
          {site.gallery.length === 0 ? (
            <p className="text-muted">{ui(UI.noPhotos, lang)}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="site-gallery">
              {site.gallery.map((g, i) => (
                <li key={i}>
                  <figure>
                    <SiteImg
                      media={g}
                      lang={lang}
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="aspect-[4/3] w-full rounded-xl object-cover"
                    />
                    <LocalText
                      text={g.caption}
                      lang={lang}
                      as="span"
                      className="mt-1 block text-sm text-muted"
                    />
                  </figure>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case 'news': {
      if (newsSlug) {
        const n = data.news.find((x) => x.slug === newsSlug);
        if (!n) return null;
        return (
          <article>
            <a
              href={chrome.preview ? undefined : href(chrome, lang, 'news')}
              className="text-sm underline"
            >
              {ui(UI.allNews, lang)}
            </a>
            <LocalText
              text={n.title}
              lang={lang}
              as="h1"
              className="mt-3 font-display text-3xl font-bold"
            />
            <time dateTime={n.publishedOn} className="text-sm text-muted" dir="ltr">
              {n.publishedOn}
            </time>
            {n.image && (
              <SiteImg
                media={n.image}
                lang={lang}
                eager
                className="my-4 max-h-[480px] w-full rounded-xl object-cover"
              />
            )}
            <LocalText
              text={n.body}
              lang={lang}
              multiline
              className="mt-4 max-w-3xl leading-relaxed"
            />
          </article>
        );
      }
      return (
        <>
          {title('news')}
          {data.news.length === 0 ? (
            <p className="text-muted">{ui(UI.noNews, lang)}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.news.map((n) => (
                <NewsCard key={n.slug} n={n} chrome={chrome} />
              ))}
            </div>
          )}
        </>
      );
    }
    case 'practical':
      return (
        <>
          {title('practical')}
          <dl className="grid gap-4 sm:grid-cols-2">
            {localizedText(c.practical.hours, lang) && (
              <div className="rounded-xl border border-line bg-white p-4">
                <dt className="font-semibold">{ui(UI.hours, lang)}</dt>
                <dd>
                  <LocalText text={c.practical.hours} lang={lang} multiline />
                </dd>
              </div>
            )}
            {localizedText(c.practical.address, lang) && (
              <div className="rounded-xl border border-line bg-white p-4">
                <dt className="font-semibold">{ui(UI.address, lang)}</dt>
                <dd>
                  <LocalText text={c.practical.address} lang={lang} multiline />
                  {c.practical.mapUrl && (
                    <External
                      href={c.practical.mapUrl}
                      label={ui(UI.map, lang)}
                      className="mt-2 inline-block underline"
                    >
                      {ui(UI.map, lang)}
                    </External>
                  )}
                </dd>
              </div>
            )}
            {c.practical.phone && (
              <div className="rounded-xl border border-line bg-white p-4">
                <dt className="font-semibold">{ui(UI.phone, lang)}</dt>
                <dd dir="ltr">
                  <a href={`tel:${c.practical.phone.replace(/[^+\d]/g, '')}`} className="underline">
                    {c.practical.phone}
                  </a>
                </dd>
              </div>
            )}
            {c.practical.email && (
              <div className="rounded-xl border border-line bg-white p-4">
                <dt className="font-semibold">{ui(UI.email, lang)}</dt>
                <dd dir="ltr">
                  <a href={`mailto:${c.practical.email}`} className="underline">
                    {c.practical.email}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </>
      );
    case 'contact':
      return (
        <>
          {title('contact')}
          <LocalText text={c.contact.intro} lang={lang} multiline className="mb-6 max-w-3xl" />
          <ul className="space-y-3" data-testid="site-contact">
            {c.practical.phone && (
              <li>
                <span className="font-semibold">{ui(UI.phone, lang)} : </span>
                <a
                  href={`tel:${c.practical.phone.replace(/[^+\d]/g, '')}`}
                  dir="ltr"
                  className="underline"
                >
                  {c.practical.phone}
                </a>
              </li>
            )}
            {c.practical.email && (
              <li>
                <span className="font-semibold">{ui(UI.email, lang)} : </span>
                <a href={`mailto:${c.practical.email}`} dir="ltr" className="underline">
                  {c.practical.email}
                </a>
              </li>
            )}
            {data.whatsapp && (
              <li>
                <External
                  href={`https://wa.me/${data.whatsapp}`}
                  label={ui(UI.whatsapp, lang)}
                  className="inline-flex items-center gap-2 rounded-full bg-[#1F8F4E] px-4 py-2 text-white"
                >
                  <SocialIcon kind="WHATSAPP" />
                  {ui(UI.whatsapp, lang)}
                </External>
              </li>
            )}
          </ul>
          {data.links.length > 0 && (
            <Section title={ui(UI.follow, lang)}>
              <SocialLinks links={data.links} lang={lang} />
            </Section>
          )}
        </>
      );
  }
}
