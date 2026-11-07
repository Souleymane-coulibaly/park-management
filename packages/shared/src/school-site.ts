import { contractAccess, type ContractWindow } from './suite-contracts';
import { type SiteSlugError, siteSlugError } from './sites';

/**
 * Sites vitrines des établissements Ocall School (Sprint 10) : règles partagées par l'API, l'éditeur
 * et les pages publiques.
 *
 * Principes :
 * - un site par établissement, BROUILLON et PUBLIÉ séparés : le public ne voit que la version figée
 *   à la publication (actualités et liens : seulement les éléments publiés ou actifs) ;
 * - aucune donnée scolaire (élèves, notes, présences, finances, dossiers) n'entre dans un site : le
 *   contenu est saisi pour le site, rien n'est repris automatiquement de l'établissement ;
 * - texte brut uniquement (jamais de HTML), français et arabe distincts, repli explicite ;
 * - aucune inscription, aucun paiement, aucun portail parent public.
 */

// ─── Langues ───

export const SCHOOL_SITE_LANGUAGES = ['fr', 'ar'] as const;
export type SchoolSiteLanguage = (typeof SCHOOL_SITE_LANGUAGES)[number];

/** Texte en deux langues ; une langue vide est remplacée par l'autre à l'affichage (repli). */
export interface SchoolSiteText {
  fr: string;
  ar: string;
}

export const emptyText = (): SchoolSiteText => ({ fr: '', ar: '' });

/**
 * Règle de repli : le texte de la langue demandée, sinon celui de l'autre langue, avec SA langue
 * (l'affichage pose `lang` et `dir` de la langue réelle) ; null si les deux sont vides.
 */
export function localizedText(
  text: SchoolSiteText | undefined,
  lang: SchoolSiteLanguage,
): { text: string; lang: SchoolSiteLanguage; fallback: boolean } | null {
  if (!text) return null;
  const other: SchoolSiteLanguage = lang === 'fr' ? 'ar' : 'fr';
  if (text[lang].trim()) return { text: text[lang], lang, fallback: false };
  if (text[other].trim()) return { text: text[other], lang: other, fallback: true };
  return null;
}

// ─── Adresse publique ───

/**
 * Noms réservés propres aux sites School, en plus de ceux des sites Park : segments des routes
 * techniques de l'API publique School (`public/school-sites/sitemap`, `/resolve`).
 */
export const SCHOOL_SITE_RESERVED_SLUGS: readonly string[] = ['sitemap', 'resolve'];

/** Mêmes règles que les sites Ocall Park (format, longueur, noms réservés), autre domaine de base. */
export function schoolSiteSlugError(slug: string): SiteSlugError | null {
  const error = siteSlugError(slug);
  if (error) return error;
  return SCHOOL_SITE_RESERVED_SLUGS.includes(slug) ? 'SLUG_RESERVED' : null;
}

/** Pages publiques d'un site d'établissement : chemin de chaque page (français à la racine). */
export const SCHOOL_SITE_PAGES = [
  'home',
  'about',
  'teaching',
  'gallery',
  'news',
  'practical',
  'contact',
] as const;
export type SchoolSitePage = (typeof SCHOOL_SITE_PAGES)[number];

export const SCHOOL_SITE_PAGE_PATHS: Record<SchoolSitePage, string> = {
  home: '',
  about: 'a-propos',
  teaching: 'enseignement',
  gallery: 'galerie',
  news: 'actualites',
  practical: 'infos',
  contact: 'contact',
};

export const SCHOOL_SITE_PAGE_LABELS: Record<SchoolSitePage, SchoolSiteText> = {
  home: { fr: 'Accueil', ar: 'الرئيسية' },
  about: { fr: 'À propos', ar: 'من نحن' },
  teaching: { fr: 'Enseignement', ar: 'التعليم' },
  gallery: { fr: 'Galerie', ar: 'معرض الصور' },
  news: { fr: 'Actualités', ar: 'الأخبار' },
  practical: { fr: 'Informations pratiques', ar: 'معلومات عملية' },
  contact: { fr: 'Contact', ar: 'اتصل بنا' },
};

const NEWS_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const isNewsSlug = (s: string) => NEWS_SLUG.test(s) && !s.includes('--');

export interface SchoolSiteRoute {
  lang: SchoolSiteLanguage;
  page: SchoolSitePage;
  newsSlug: string | null;
}

/**
 * Chemin public → page du site ; null pour tout autre chemin (introuvable). Seuls ces chemins exacts
 * existent : `/`, `/a-propos`, …, `/actualites/<article>`, et les mêmes sous `/ar`.
 */
export function parseSchoolSitePath(path: string): SchoolSiteRoute | null {
  let rest = path;
  let lang: SchoolSiteLanguage = 'fr';
  if (rest === '/ar' || rest.startsWith('/ar/')) {
    lang = 'ar';
    rest = rest.slice(3) || '/';
  }
  if (rest === '/') return { lang, page: 'home', newsSlug: null };
  const parts = rest.split('/');
  if (parts[0] !== '' || parts.length > 3) return null;
  const page = SCHOOL_SITE_PAGES.find(
    (p) => p !== 'home' && SCHOOL_SITE_PAGE_PATHS[p] === parts[1],
  );
  if (!page) return null;
  if (parts.length === 2) return { lang, page, newsSlug: null };
  if (page === 'news' && isNewsSlug(parts[2]!)) return { lang, page, newsSlug: parts[2]! };
  return null;
}

/** Chemin public d'une page (relatif à la racine du site). */
export function schoolSitePath(
  lang: SchoolSiteLanguage,
  page: SchoolSitePage,
  newsSlug: string | null = null,
): string {
  const segment = SCHOOL_SITE_PAGE_PATHS[page];
  const base = lang === 'ar' ? '/ar' : '';
  const path = `${base}${segment ? `/${segment}` : ''}${newsSlug ? `/${newsSlug}` : ''}`;
  return path || '/';
}

// ─── Contenu du brouillon ───

export const SCHOOL_SITE_LIMITS = {
  short: 160,
  medium: 600,
  long: 4000,
  highlights: 6,
  gallery: 40,
  newsTitle: 160,
  newsBody: 8000,
  altText: 200,
  links: 20,
  linkLabel: 40,
  consentReference: 200,
} as const;

export interface SchoolSiteGalleryItem {
  mediaId: string;
  caption: SchoolSiteText;
}

export interface SchoolSiteContent {
  home: { tagline: SchoolSiteText; intro: SchoolSiteText; highlights: SchoolSiteText[] };
  about: {
    overview: SchoolSiteText;
    history: SchoolSiteText;
    mission: SchoolSiteText;
    values: SchoolSiteText;
  };
  teaching: {
    levels: SchoolSiteText;
    programs: SchoolSiteText;
    languages: SchoolSiteText;
    pedagogy: SchoolSiteText;
  };
  practical: {
    hours: SchoolSiteText;
    address: SchoolSiteText;
    phone: string;
    email: string;
    /** Lien cartographique https (OpenStreetMap, Google Maps…) ; aucun suivi intégré à la page. */
    mapUrl: string;
  };
  contact: { intro: SchoolSiteText };
  media: { logoId: string | null; coverId: string | null; gallery: SchoolSiteGalleryItem[] };
}

export function emptySchoolSiteContent(): SchoolSiteContent {
  return {
    home: { tagline: emptyText(), intro: emptyText(), highlights: [] },
    about: {
      overview: emptyText(),
      history: emptyText(),
      mission: emptyText(),
      values: emptyText(),
    },
    teaching: {
      levels: emptyText(),
      programs: emptyText(),
      languages: emptyText(),
      pedagogy: emptyText(),
    },
    practical: { hours: emptyText(), address: emptyText(), phone: '', email: '', mapUrl: '' },
    contact: { intro: emptyText() },
    media: { logoId: null, coverId: null, gallery: [] },
  };
}

/** Identifiants des médias cités par un contenu (logo, couverture, galerie). */
export function schoolSiteMediaIds(c: SchoolSiteContent): string[] {
  return [
    ...(c.media.logoId ? [c.media.logoId] : []),
    ...(c.media.coverId ? [c.media.coverId] : []),
    ...c.media.gallery.map((g) => g.mediaId),
  ];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Caractères de contrôle interdits (sauf saut de ligne et tabulation).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PHONE = /^\+?[0-9 ().-]{6,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valide un brouillon reçu : clés exactes, textes bornés, téléphone, e-mail, lien https, identifiants
 * de médias. Renvoie le contenu nettoyé (espaces de bord retirés) ou les erreurs.
 */
export function validateSchoolSiteContent(
  input: unknown,
): { content: SchoolSiteContent } | { errors: string[] } {
  const errors: string[] = [];
  const L = SCHOOL_SITE_LIMITS;
  const exact = (v: unknown, keys: string[], label: string): Record<string, unknown> => {
    if (!isObj(v)) {
      errors.push(`${label} : objet attendu.`);
      return {};
    }
    for (const k of Object.keys(v))
      if (!keys.includes(k)) errors.push(`${label}.${k} : champ inconnu.`);
    return v;
  };
  const str = (v: unknown, max: number, label: string): string => {
    if (typeof v !== 'string') {
      errors.push(`${label} : texte attendu.`);
      return '';
    }
    const t = v.trim();
    if (t.length > max) errors.push(`${label} : ${max} caractères au plus.`);
    if (CONTROL.test(t)) errors.push(`${label} : caractères non autorisés.`);
    return t;
  };
  const text = (v: unknown, max: number, label: string): SchoolSiteText => {
    const o = exact(v, ['fr', 'ar'], label);
    return { fr: str(o.fr ?? '', max, `${label}.fr`), ar: str(o.ar ?? '', max, `${label}.ar`) };
  };
  const group = <K extends string>(
    v: unknown,
    label: string,
    fields: Record<K, number>,
  ): Record<K, SchoolSiteText> => {
    const o = exact(v, Object.keys(fields), label);
    const out = {} as Record<K, SchoolSiteText>;
    for (const [k, max] of Object.entries(fields) as [K, number][])
      out[k] = text(o[k], max, `${label}.${k}`);
    return out;
  };
  const mediaRef = (v: unknown, label: string): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string' || !UUID.test(v)) {
      errors.push(`${label} : identifiant invalide.`);
      return null;
    }
    return v.toLowerCase();
  };

  const root = exact(
    input,
    ['home', 'about', 'teaching', 'practical', 'contact', 'media'],
    'contenu',
  );
  const homeIn = exact(root.home, ['tagline', 'intro', 'highlights'], 'home');
  const highlightsIn = Array.isArray(homeIn.highlights) ? homeIn.highlights : [];
  if (!Array.isArray(homeIn.highlights)) errors.push('home.highlights : liste attendue.');
  if (highlightsIn.length > L.highlights) errors.push(`home.highlights : ${L.highlights} au plus.`);
  const home = {
    tagline: text(homeIn.tagline, L.short, 'home.tagline'),
    intro: text(homeIn.intro, L.long, 'home.intro'),
    highlights: highlightsIn
      .slice(0, L.highlights)
      .map((h, i) => text(h, L.short, `home.highlights.${i}`)),
  };
  const about = group(root.about, 'about', {
    overview: L.long,
    history: L.long,
    mission: L.long,
    values: L.long,
  });
  const teaching = group(root.teaching, 'teaching', {
    levels: L.long,
    programs: L.long,
    languages: L.medium,
    pedagogy: L.long,
  });
  const pIn = exact(root.practical, ['hours', 'address', 'phone', 'email', 'mapUrl'], 'practical');
  const phone = str(pIn.phone ?? '', 30, 'practical.phone');
  if (phone && !PHONE.test(phone)) errors.push('practical.phone : numéro invalide.');
  const email = str(pIn.email ?? '', 254, 'practical.email');
  if (email && !EMAIL.test(email)) errors.push('practical.email : adresse invalide.');
  const mapUrl = str(pIn.mapUrl ?? '', 500, 'practical.mapUrl');
  if (mapUrl && !safeHttpsUrl(mapUrl)) {
    errors.push('practical.mapUrl : adresse https:// valide attendue.');
  }
  const practical = {
    hours: text(pIn.hours, L.medium, 'practical.hours'),
    address: text(pIn.address, L.medium, 'practical.address'),
    phone,
    email,
    mapUrl,
  };
  const contact = {
    intro: text(exact(root.contact, ['intro'], 'contact').intro, L.medium, 'contact.intro'),
  };
  const mIn = exact(root.media, ['logoId', 'coverId', 'gallery'], 'media');
  const galleryIn = Array.isArray(mIn.gallery) ? mIn.gallery : [];
  if (!Array.isArray(mIn.gallery)) errors.push('media.gallery : liste attendue.');
  if (galleryIn.length > L.gallery) errors.push(`media.gallery : ${L.gallery} images au plus.`);
  const gallery: SchoolSiteGalleryItem[] = [];
  for (const [i, g] of galleryIn.slice(0, L.gallery).entries()) {
    const o = exact(g, ['mediaId', 'caption'], `media.gallery.${i}`);
    const mediaId = mediaRef(o.mediaId, `media.gallery.${i}.mediaId`);
    const caption = text(o.caption, L.altText, `media.gallery.${i}.caption`);
    if (mediaId && !gallery.some((x) => x.mediaId === mediaId)) gallery.push({ mediaId, caption });
  }
  const media = {
    logoId: mediaRef(mIn.logoId ?? null, 'media.logoId'),
    coverId: mediaRef(mIn.coverId ?? null, 'media.coverId'),
    gallery,
  };
  if (errors.length) return { errors };
  return { content: { home, about, teaching, practical, contact, media } };
}

// ─── Liens externes et réseaux sociaux ───

export const SCHOOL_SITE_LINK_KINDS = [
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
  'WHATSAPP',
  'LINKEDIN',
  'OTHER',
] as const;
export type SchoolSiteLinkKind = (typeof SCHOOL_SITE_LINK_KINDS)[number];

export const SCHOOL_SITE_LINK_LABELS: Record<SchoolSiteLinkKind, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  WHATSAPP: 'WhatsApp',
  LINKEDIN: 'LinkedIn',
  OTHER: 'Autre lien',
};

/** Domaines acceptés par réseau (le domaine lui-même ou un sous-domaine). */
const LINK_HOSTS: Partial<Record<SchoolSiteLinkKind, string[]>> = {
  FACEBOOK: ['facebook.com', 'fb.com', 'fb.me'],
  INSTAGRAM: ['instagram.com'],
  TIKTOK: ['tiktok.com'],
  YOUTUBE: ['youtube.com', 'youtu.be'],
  LINKEDIN: ['linkedin.com'],
};

const LOCAL_TLDS = ['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'lan', 'home'];

/**
 * Adresse https publique : protocole https, sans identifiants ni port, nom d'hôte complet (pas
 * d'adresse IP ni de nom local), 500 caractères au plus. Renvoie l'URL normalisée, sinon null.
 */
export function safeHttpsUrl(input: string): string | null {
  const t = input.trim();
  if (!t || t.length > 500 || CONTROL.test(t) || /\s/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((l) => !l)) return null;
  if (/^\d+$/.test(labels.at(-1)!) || host.startsWith('[')) return null;
  if (LOCAL_TLDS.includes(labels.at(-1)!)) return null;
  return u.toString();
}

/** Chiffres d'un numéro international (indicatif compris, 8 à 15 chiffres, sans 0 initial). */
function internationalDigits(digits: string): string | null {
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/**
 * Numéro WhatsApp saisi : format international explicite (`+` ou `00` suivi de l'indicatif pays),
 * séparateurs ignorés. Un numéro local (« 77 000 00 00 ») est refusé : le pays serait deviné et la
 * conversation pourrait s'ouvrir avec un inconnu.
 */
export function whatsappDigits(input: string): string | null {
  const t = input.trim();
  if (!/^(\+|00)[0-9 ().-]{8,24}$/.test(t)) return null;
  return internationalDigits(t.replace(/^00/, '').replace(/\D/g, ''));
}

export const whatsappUrl = (digits: string) => `https://wa.me/${digits}`;

/**
 * Valide un lien saisi pour un réseau : https sur le domaine du réseau ; WhatsApp : numéro
 * international, ou lien wa.me / api.whatsapp.com déjà formé. Renvoie l'adresse publiée.
 */
export function validateSchoolSiteLink(
  kind: SchoolSiteLinkKind,
  value: string,
): { url: string } | { error: string } {
  if (kind === 'WHATSAPP') {
    const direct = whatsappDigits(value);
    if (direct) return { url: whatsappUrl(direct) };
    const url = safeHttpsUrl(value);
    if (url) {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      const fromPath = host === 'wa.me' ? u.pathname.slice(1) : null;
      const fromQuery =
        host === 'api.whatsapp.com' && u.pathname === '/send' ? u.searchParams.get('phone') : null;
      // Lien wa.me ou api.whatsapp.com : le numéro y est déjà au format international, sans « + ».
      const digits = internationalDigits((fromPath ?? fromQuery ?? '').replace(/^\+/, ''));
      if (digits) return { url: whatsappUrl(digits) };
    }
    return { error: 'Numéro WhatsApp international attendu (ex. +221 77 000 00 00).' };
  }
  const url = safeHttpsUrl(value);
  if (!url) return { error: 'Adresse https:// valide attendue.' };
  const hosts = LINK_HOSTS[kind];
  if (hosts) {
    const host = new URL(url).hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { error: `Adresse ${SCHOOL_SITE_LINK_LABELS[kind]} attendue (${hosts[0]}).` };
    }
  }
  return { url };
}

// ─── Version publiée ───

export interface SchoolSitePublishedMedia {
  url: string;
  thumbUrl: string;
  alt: SchoolSiteText;
  width: number;
  height: number;
}

export interface SchoolSitePublishedLink {
  kind: SchoolSiteLinkKind;
  label: string;
  url: string;
}

export interface SchoolSitePublishedNews {
  slug: string;
  title: SchoolSiteText;
  body: SchoolSiteText;
  publishedOn: string;
  image: SchoolSitePublishedMedia | null;
}

/** Version figée à la publication : seule donnée lue par le public (aucun identifiant interne). */
export interface SchoolSitePublished {
  slug: string;
  name: SchoolSiteText;
  languages: SchoolSiteLanguage[];
  defaultLanguage: SchoolSiteLanguage;
  theme: SchoolSiteTheme;
  primaryColor: string;
  publishedAt: string;
  content: Omit<SchoolSiteContent, 'media'>;
  logo: SchoolSitePublishedMedia | null;
  cover: SchoolSitePublishedMedia | null;
  gallery: (SchoolSitePublishedMedia & { caption: SchoolSiteText })[];
}

export type SchoolSitePublicResponse =
  | {
      state: 'PUBLISHED';
      site: SchoolSitePublished;
      links: SchoolSitePublishedLink[];
      /** Numéro officiel du bouton WhatsApp (premier lien WhatsApp actif), sinon null. */
      whatsapp: string | null;
      news: SchoolSitePublishedNews[];
      canonicalUrl: string;
      /** Contrat suspendu ou expiré : site maintenu temporairement, jusqu'à cette date. */
      readOnlyUntil: string | null;
    }
  | { state: 'UNAVAILABLE'; name: SchoolSiteText };

export const SCHOOL_SITE_THEMES = ['CLASSIC', 'MODERN', 'WARM'] as const;
export type SchoolSiteTheme = (typeof SCHOOL_SITE_THEMES)[number];
export const SCHOOL_SITE_THEME_LABELS: Record<SchoolSiteTheme, string> = {
  CLASSIC: 'Classique',
  MODERN: 'Moderne',
  WARM: 'Chaleureux',
};
export const SCHOOL_SITE_DEFAULT_COLOR = '#176B53';

// ─── Disponibilité selon le contrat ───

export const SCHOOL_SITE_DEFAULT_GRACE_DAYS = 30;

export type SchoolSiteAvailability =
  | { online: true; canPublish: boolean; readOnlyUntil: Date | null }
  | { online: false; canPublish: false; reason: 'NO_CONTRACT' | 'TERMINATED' | 'GRACE_ENDED' };

/**
 * Le site publié reste en ligne avec un contrat valide ; contrat suspendu ou expiré : maintenu en
 * lecture seule `graceDays` jours après le passage en lecture seule (aucune nouvelle publication) ;
 * contrat résilié ou absent : hors ligne immédiatement (le contenu reste exportable par le client).
 */
export function schoolSiteAvailability(
  contract: (ContractWindow & { readOnlySince: Date | null }) | null,
  graceDays: number,
  now: Date = new Date(),
): SchoolSiteAvailability {
  if (!contract) return { online: false, canPublish: false, reason: 'NO_CONTRACT' };
  if (contract.status === 'TERMINATED')
    return { online: false, canPublish: false, reason: 'TERMINATED' };
  const access = contractAccess(contract, now);
  if (access === 'full') return { online: true, canPublish: true, readOnlyUntil: null };
  if (access === 'none') return { online: false, canPublish: false, reason: 'NO_CONTRACT' };
  // Contrat actif dont la date de fin est passée : lecture seule dès le lendemain de la fin.
  // Contrat suspendu ou expiré : date du changement de statut, fournie par l'appelant ; inconnue,
  // le maintien est refusé (aucun site maintenu sans borne).
  const since =
    contract.status === 'ACTIVE'
      ? new Date(new Date(contract.endsOn).getTime() + 86_400_000)
      : contract.readOnlySince;
  if (!since) return { online: false, canPublish: false, reason: 'GRACE_ENDED' };
  const until = new Date(since.getTime() + graceDays * 86_400_000);
  if (now.getTime() >= until.getTime()) {
    return { online: false, canPublish: false, reason: 'GRACE_ENDED' };
  }
  return { online: true, canPublish: false, readOnlyUntil: until };
}

/**
 * Disponibilité d'un site couvert par plusieurs contrats (renouvellement, ancien contrat résilié) :
 * la plus favorable l'emporte — publication permise, sinon maintien le plus long ; hors ligne
 * seulement si aucun contrat ne permet le maintien. Indépendante de l'ordre des contrats.
 */
export function bestSchoolSiteAvailability(
  contracts: readonly (ContractWindow & { readOnlySince: Date | null })[],
  graceDays: number,
  now: Date = new Date(),
): SchoolSiteAvailability {
  let best: SchoolSiteAvailability = { online: false, canPublish: false, reason: 'NO_CONTRACT' };
  const until = (a: SchoolSiteAvailability) =>
    a.online ? (a.canPublish ? Infinity : (a.readOnlyUntil?.getTime() ?? 0)) : -1;
  const offlineRank = { NO_CONTRACT: 0, GRACE_ENDED: 1, TERMINATED: 2 } as const;
  for (const c of contracts) {
    const a = schoolSiteAvailability(c, graceDays, now);
    if (until(a) > until(best)) best = a;
    // Hors ligne des deux côtés : le motif le plus explicite (résiliation, fin du maintien).
    else if (!a.online && !best.online && offlineRank[a.reason] > offlineRank[best.reason])
      best = a;
  }
  return best;
}
