import type { Activity, BusinessType } from './business';
import { activitiesOf } from './business';

/**
 * Sites vitrines publics (Sprint 10) : règles partagées par l'API, l'éditeur et les pages publiques.
 *
 * Principes :
 * - un site par établissement, BROUILLON et PUBLIÉ séparés : le public ne voit que la dernière
 *   version publiée, figée au moment de la publication ;
 * - rien n'est publié par défaut (produits, tarifs) ; aucune donnée interne (coûts, stocks, ventes,
 *   personnel) n'entre dans la version publiée ;
 * - contenus en TEXTE BRUT uniquement (jamais de HTML) ;
 * - aucune vente, réservation, commande ni paiement en ligne.
 */

// ─── Adresse publique (slug) ───

export const SITE_SLUG_MIN = 3;
export const SITE_SLUG_MAX = 40;

/**
 * Noms réservés : sous-domaines techniques, espaces de l'application, marques. Un slug réservé ne
 * peut être attribué à aucun établissement.
 */
export const RESERVED_SITE_SLUGS: readonly string[] = [
  'www',
  'app',
  'api',
  'admin',
  'administrateur',
  'superadmin',
  'root',
  'mail',
  'email',
  'smtp',
  'imap',
  'pop',
  'ftp',
  'ns',
  'ns1',
  'ns2',
  'dns',
  'cdn',
  'static',
  'assets',
  'media',
  'medias',
  'img',
  'images',
  'files',
  'docs',
  'doc',
  'help',
  'aide',
  'support',
  'status',
  'blog',
  'shop',
  'boutique',
  'store',
  'market',
  'marketplace',
  'pay',
  'paiement',
  'payment',
  'billing',
  'facturation',
  'compte',
  'account',
  'login',
  'connexion',
  'inscription',
  'signup',
  'auth',
  'oauth',
  'sso',
  'dashboard',
  'tableau-de-bord',
  'test',
  'tests',
  'staging',
  'preprod',
  'dev',
  'demo',
  'sandbox',
  'internal',
  'interne',
  'ocall',
  'ocallpark',
  'ocall-park',
  'ocall-suite',
  'ocallsuite',
  'clinic',
  'clinique',
  'rh',
  'solar',
  'solaire',
  'solutions',
  'contact',
  'a-propos',
  'mentions-legales',
  'partenaires',
  'partners',
  'suite',
  'school',
  'ecole',
  'restaurant',
  'parc',
  'park',
  'e',
  'site',
  'sites',
  'kiosk',
  'commande',
  'tarifs',
  'legal',
  'cgu',
  'cgv',
  'confidentialite',
  'privacy',
  'security',
  'securite',
  'autoconfig',
  'autodiscover',
  'webmail',
  'localhost',
  'wpad',
  '_acme-challenge',
];

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SiteSlugError = 'SLUG_FORMAT' | 'SLUG_LENGTH' | 'SLUG_RESERVED';

export const SITE_SLUG_ERRORS: Record<SiteSlugError, string> = {
  SLUG_FORMAT:
    'Lettres minuscules non accentuées, chiffres et tirets uniquement, sans tiret au début ni à la fin.',
  SLUG_LENGTH: `Entre ${SITE_SLUG_MIN} et ${SITE_SLUG_MAX} caractères.`,
  SLUG_RESERVED: 'Cette adresse est réservée.',
};

/** Erreur de format d'une adresse publique ; null si elle est valide (unicité vérifiée en base). */
export function siteSlugError(slug: string): SiteSlugError | null {
  if (slug.length < SITE_SLUG_MIN || slug.length > SITE_SLUG_MAX) return 'SLUG_LENGTH';
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return 'SLUG_FORMAT';
  if (RESERVED_SITE_SLUGS.includes(slug)) return 'SLUG_RESERVED';
  return null;
}

/** Propose une adresse à partir d'un nom : « Maquis Le Baobab » → « maquis-le-baobab ». */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SITE_SLUG_MAX)
    .replace(/-+$/g, '');
}

// ─── Domaines personnalisés ───

export const SITE_DOMAIN_STATUSES = [
  'PENDING',
  'VERIFYING',
  'VERIFIED',
  'ACTIVE',
  'ERROR',
] as const;
export type SiteDomainStatus = (typeof SITE_DOMAIN_STATUSES)[number];

export const SITE_DOMAIN_STATUS_LABELS: Record<SiteDomainStatus, string> = {
  PENDING: 'En attente de configuration DNS',
  VERIFYING: 'Vérification en cours',
  VERIFIED: 'Propriété vérifiée — activation par Ocall',
  ACTIVE: 'Actif',
  ERROR: 'Erreur',
};

/** Enregistrement TXT prouvant la propriété : `_ocallpark-verify.<domaine>`. */
export const SITE_DOMAIN_TXT_PREFIX = '_ocallpark-verify';
export const SITE_DOMAIN_TXT_VALUE_PREFIX = 'ocallpark-site-verification=';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type SiteDomainError =
  'DOMAIN_FORMAT' | 'DOMAIN_IP' | 'DOMAIN_PLATFORM' | 'DOMAIN_TOO_LONG' | 'DOMAIN_LOCAL';

export const SITE_DOMAIN_ERRORS: Record<SiteDomainError, string> = {
  DOMAIN_FORMAT: 'Nom de domaine invalide (ex. www.monrestaurant.ml).',
  DOMAIN_IP: 'Une adresse IP ne peut pas servir de domaine.',
  DOMAIN_PLATFORM:
    'Les adresses Ocall sont gérées automatiquement : saisissez votre propre domaine.',
  DOMAIN_TOO_LONG: 'Nom de domaine trop long.',
  DOMAIN_LOCAL: 'Domaine local ou réservé.',
};

/**
 * Normalise un domaine saisi (« https://WWW.MonResto.ml/ » → « www.monresto.ml ») ; renvoie une
 * erreur plutôt qu'un domaine approximatif. Les domaines internationalisés doivent être saisis en
 * punycode (xn--…). Les domaines de la plateforme (`platformDomains`) sont refusés.
 */
export function normalizeCustomDomain(
  input: string,
  platformDomains: string[] = [],
): { hostname: string } | { error: SiteDomainError } {
  let host = input.trim().toLowerCase();
  host = host
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/?#]/)[0]!
    .replace(/\.$/, '');
  if (host.includes(':')) host = host.split(':')[0]!;
  if (host.length > 253) return { error: 'DOMAIN_TOO_LONG' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return { error: 'DOMAIN_IP' };
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels.at(-1)!)) {
    return { error: 'DOMAIN_FORMAT' };
  }
  if (['localhost', 'local', 'internal', 'test', 'invalid', 'example'].includes(labels.at(-1)!)) {
    return { error: 'DOMAIN_LOCAL' };
  }
  if (platformDomains.some((p) => p && (host === p || host.endsWith(`.${p}`)))) {
    return { error: 'DOMAIN_PLATFORM' };
  }
  return { hostname: host };
}

// ─── Thèmes et sections ───

/** Thèmes sélectionnables (valeurs enregistrées en base). */
export const SITE_THEMES = ['CLASSIC', 'MODERN', 'WARM', 'AQUA_PREMIUM'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];

export const SITE_THEME_LABELS: Record<SiteTheme, string> = {
  CLASSIC: 'Classique — sobre, fond clair',
  MODERN: 'Moderne — grandes images, titres marqués',
  WARM: 'Chaleureux — fond ivoire, accents terre cuite',
  AQUA_PREMIUM: 'Ocall Aqua Premium — immersif, pour parcs aquatiques',
};

/**
 * Catalogue des thèmes, y compris ceux annoncés mais pas encore développés (non sélectionnables).
 * Ajouter un thème : une valeur d'énumération, un composant de rendu, une entrée ici.
 */
export const SITE_THEME_CATALOG: readonly {
  key: string;
  label: string;
  description: string;
  available: boolean;
}[] = [
  {
    key: 'AQUA_PREMIUM',
    label: 'Ocall Aqua Premium',
    description: 'Accueil plein écran, attractions en photos, bouton WhatsApp permanent.',
    available: true,
  },
  { key: 'CLASSIC', label: 'Classique', description: 'Sobre, fond clair.', available: true },
  {
    key: 'MODERN',
    label: 'Moderne',
    description: 'Grandes images, titres marqués.',
    available: true,
  },
  {
    key: 'WARM',
    label: 'Chaleureux',
    description: 'Fond ivoire, accents terre cuite.',
    available: true,
  },
  { key: 'AQUA_FAMILY', label: 'Aqua Family', description: 'À venir.', available: false },
  { key: 'AQUA_LUXURY', label: 'Aqua Luxury', description: 'À venir.', available: false },
  { key: 'AQUA_TROPICAL', label: 'Aqua Tropical', description: 'À venir.', available: false },
];

export const SITE_DEFAULT_COLOR = '#176B53';
/** Couleur d'accent par défaut (thème Aqua Premium) : boutons et chiffres clés à texte sombre. */
export const SITE_DEFAULT_ACCENT = '#F5C94B';
/** Texte sombre posé sur la couleur d'accent. */
export const SITE_ACCENT_TEXT = '#0B1F2E';

/** Couleur hexadécimale #RRGGBB. */
export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Luminance relative WCAG d'une couleur #RRGGBB. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

/**
 * Couleur principale utilisable : boutons à texte blanc lisibles (contraste ≥ 4,5:1, WCAG AA).
 * Une couleur trop claire est refusée plutôt que corrigée en silence.
 */
export function isAccessibleBrandColor(hex: string): boolean {
  return isHexColor(hex) && contrastRatio(hex, '#FFFFFF') >= 4.5;
}

/** Couleur d'accent utilisable : texte sombre lisible dessus (contraste ≥ 4,5:1). */
export function isAccessibleAccentColor(hex: string): boolean {
  return isHexColor(hex) && contrastRatio(hex, SITE_ACCENT_TEXT) >= 4.5;
}

export const SITE_SECTIONS = [
  'about',
  'gallery',
  'attractions',
  'menu',
  'prices',
  'services',
  'hours',
  'safety',
  'practical',
  'contact',
] as const;
export type SiteSection = (typeof SITE_SECTIONS)[number];

export const SITE_SECTION_LABELS: Record<SiteSection, string> = {
  about: 'Présentation',
  gallery: 'Galerie photos',
  attractions: 'Attractions et activités',
  menu: 'Menu',
  prices: 'Tarifs d’entrée',
  services: 'Services',
  hours: 'Horaires',
  safety: 'Informations de sécurité',
  practical: 'Informations pratiques',
  contact: 'Contact et accès',
};

/** Activité exigée par une section (absente = toutes). */
const SECTION_ACTIVITY: Partial<Record<SiteSection, Activity>> = {
  attractions: 'PARK',
  prices: 'PARK',
  safety: 'PARK',
  menu: 'RESTAURANT',
};

/** Sections proposées selon le métier de l'établissement (PARK, RESTAURANT, PARK_RESTAURANT). */
export function sectionsFor(businessType: BusinessType): SiteSection[] {
  const activities = activitiesOf(businessType);
  return SITE_SECTIONS.filter((s) => {
    const a = SECTION_ACTIVITY[s];
    return !a || activities.includes(a);
  });
}

// ─── Contenu du site (brouillon) ───

export const SITE_LIMITS = {
  publicName: 80,
  tagline: 140,
  description: 2000,
  address: 200,
  text: 1500,
  services: 20,
  serviceLength: 60,
  attractions: 30,
  attractionName: 80,
  attractionDescription: 300,
  gallery: 24,
  menuItems: 200,
  ticketItems: 30,
  altText: 140,
  heroHighlights: 4,
  highlightLength: 40,
  keyFacts: 4,
  keyFactLength: 30,
  restaurantPhotos: 6,
} as const;

export interface SiteHours {
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  weekday: number;
  closed: boolean;
  opens: string | null;
  closes: string | null;
}

export interface SiteContent {
  publicName: string;
  tagline: string;
  description: string;
  address: string;
  city: string;
  /** Coordonnées GPS facultatives (lien de carte, sans script tiers). */
  latitude: number | null;
  longitude: number | null;
  phone: string;
  whatsapp: string;
  email: string;
  socials: { facebook: string; instagram: string; tiktok: string; website: string };
  hours: SiteHours[];
  hoursNote: string;
  services: string[];
  /** Attractions ; photo facultative (image de la galerie du site). */
  attractions: { name: string; description: string; mediaId: string | null }[];
  safetyInfo: string;
  practicalInfo: string;
  /** Produits publiés au menu (rien n'est publié par défaut) ; prix indicatif facultatif. */
  menu: { productId: string; displayPrice: number | null }[];
  /** Catégories de billets publiées (tarifs indicatifs) ; prix indicatif facultatif. */
  tickets: { ticketCategoryId: string; displayPrice: number | null }[];
  media: { logoId: string | null; coverId: string | null; galleryIds: string[] };
  sections: { order: SiteSection[]; hidden: SiteSection[] };
  /** Étiquettes affichées sur la photo d'accueil (ex. « Familles », « Anniversaires »). */
  heroHighlights: string[];
  /** Chiffres clés sous l'accueil (ex. « Entrée » / « 3 000 FCFA »), saisis par l'établissement. */
  keyFacts: { label: string; value: string }[];
  /** Section restaurant : texte et photos (images de la galerie du site). */
  restaurant: { description: string; mediaIds: string[] };
}

/** Champs ajoutés après le Sprint 10 : valeurs par défaut pour les contenus antérieurs. */
export const SITE_CONTENT_DEFAULTS: Pick<
  SiteContent,
  'heroHighlights' | 'keyFacts' | 'restaurant'
> = {
  heroHighlights: [],
  keyFacts: [],
  restaurant: { description: '', mediaIds: [] },
};

/** Complète un contenu enregistré avant l'ajout des champs du thème premium (lecture seule). */
export function withContentDefaults(raw: SiteContent): SiteContent {
  return {
    ...SITE_CONTENT_DEFAULTS,
    ...raw,
    attractions: (raw.attractions ?? []).map((a) => ({ ...a, mediaId: a.mediaId ?? null })),
    restaurant: raw.restaurant ?? SITE_CONTENT_DEFAULTS.restaurant,
  };
}

/** Identifiants des images utilisées par un contenu (logo, couverture, galerie, attractions, restaurant). */
export function contentMediaIds(c: SiteContent): string[] {
  return [
    ...new Set(
      [
        c.media.logoId,
        c.media.coverId,
        ...c.media.galleryIds,
        ...c.attractions.map((a) => a.mediaId),
        ...c.restaurant.mediaIds,
      ].filter((x): x is string => !!x),
    ),
  ];
}

export function emptySiteContent(name: string, businessType: BusinessType): SiteContent {
  return {
    publicName: name.slice(0, SITE_LIMITS.publicName),
    tagline: '',
    description: '',
    address: '',
    city: '',
    latitude: null,
    longitude: null,
    phone: '',
    whatsapp: '',
    email: '',
    socials: { facebook: '', instagram: '', tiktok: '', website: '' },
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      closed: false,
      opens: '10:00',
      closes: '18:00',
    })),
    hoursNote: '',
    services: [],
    attractions: [],
    safetyInfo: '',
    practicalInfo: '',
    menu: [],
    tickets: [],
    media: { logoId: null, coverId: null, galleryIds: [] },
    sections: { order: sectionsFor(businessType), hidden: [] },
    heroHighlights: [],
    keyFacts: [],
    restaurant: { description: '', mediaIds: [] },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Caractères de contrôle interdits (sauf saut de ligne et tabulation). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Valide un contenu de brouillon reçu (clés exactes, types, longueurs, URL https, téléphones,
 * horaires, identifiants). Renvoie le contenu nettoyé (espaces de bord retirés) ou la liste des
 * erreurs. Aucun HTML n'est interprété : le texte est affiché tel quel.
 */
export function validateSiteContent(
  input: unknown,
  businessType: BusinessType,
): { content: SiteContent } | { errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { errors: ['Contenu invalide.'] };
  const KEYS: (keyof SiteContent)[] = [
    'publicName',
    'tagline',
    'description',
    'address',
    'city',
    'latitude',
    'longitude',
    'phone',
    'whatsapp',
    'email',
    'socials',
    'hours',
    'hoursNote',
    'services',
    'attractions',
    'safetyInfo',
    'practicalInfo',
    'menu',
    'tickets',
    'media',
    'sections',
    'heroHighlights',
    'keyFacts',
    'restaurant',
  ];
  for (const k of Object.keys(input))
    if (!KEYS.includes(k as keyof SiteContent)) errors.push(`Champ inconnu : ${k}.`);

  const text = (key: string, max: number, required = false): string => {
    const v = input[key];
    if (typeof v !== 'string') {
      errors.push(`${key} : texte attendu.`);
      return '';
    }
    const t = v.trim();
    if (required && !t) errors.push(`${key} : obligatoire.`);
    if (t.length > max) errors.push(`${key} : ${max} caractères au plus.`);
    if (CONTROL.test(t)) errors.push(`${key} : caractères non autorisés.`);
    return t;
  };
  const phone = (key: string): string => {
    const t = text(key, 30);
    if (t && !/^\+?[0-9 ().-]{6,30}$/.test(t)) errors.push(`${key} : numéro invalide.`);
    return t;
  };
  const url = (v: unknown, label: string): string => {
    if (typeof v !== 'string') {
      errors.push(`${label} : texte attendu.`);
      return '';
    }
    const t = v.trim();
    if (!t) return '';
    try {
      const u = new URL(t);
      if (u.protocol !== 'https:' || t.length > 300) throw new Error();
    } catch {
      errors.push(`${label} : adresse https:// valide attendue.`);
    }
    return t;
  };
  const coord = (key: string, limit: number): number | null => {
    const v = input[key];
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) {
      errors.push(`${key} : coordonnée invalide.`);
      return null;
    }
    return Math.round(v * 1e6) / 1e6;
  };

  const email = text('email', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email : adresse invalide.');

  const socialsIn = isObj(input.socials) ? input.socials : {};
  if (!isObj(input.socials)) errors.push('socials : objet attendu.');
  const socials = {
    facebook: url(socialsIn.facebook ?? '', 'Facebook'),
    instagram: url(socialsIn.instagram ?? '', 'Instagram'),
    tiktok: url(socialsIn.tiktok ?? '', 'TikTok'),
    website: url(socialsIn.website ?? '', 'Site web'),
  };

  const hours: SiteHours[] = [];
  if (!Array.isArray(input.hours) || input.hours.length !== 7) {
    errors.push('hours : 7 jours attendus.');
  } else {
    for (const [i, h] of input.hours.entries()) {
      if (!isObj(h) || h.weekday !== i + 1 || typeof h.closed !== 'boolean') {
        errors.push(`Horaires du jour ${i + 1} invalides.`);
        continue;
      }
      const opens = h.closed ? null : h.opens;
      const closes = h.closed ? null : h.closes;
      if (
        !h.closed &&
        (typeof opens !== 'string' ||
          typeof closes !== 'string' ||
          !TIME.test(opens) ||
          !TIME.test(closes))
      ) {
        errors.push(`Horaires du jour ${i + 1} : heures HH:MM attendues.`);
        continue;
      }
      hours.push({
        weekday: i + 1,
        closed: h.closed,
        opens: (opens as string | null) ?? null,
        closes: (closes as string | null) ?? null,
      });
    }
  }

  const strings = (key: string, maxItems: number, maxLen: number): string[] => {
    const v = input[key];
    if (!Array.isArray(v) || v.length > maxItems || !v.every((s) => typeof s === 'string')) {
      errors.push(`${key} : liste de ${maxItems} textes au plus.`);
      return [];
    }
    const out = (v as string[]).map((s) => s.trim()).filter(Boolean);
    if (out.some((s) => s.length > maxLen || CONTROL.test(s)))
      errors.push(`${key} : ${maxLen} caractères au plus par élément.`);
    return out;
  };

  const attractions: SiteContent['attractions'] = [];
  if (!Array.isArray(input.attractions) || input.attractions.length > SITE_LIMITS.attractions) {
    errors.push(`attractions : ${SITE_LIMITS.attractions} au plus.`);
  } else {
    for (const a of input.attractions) {
      if (!isObj(a) || typeof a.name !== 'string' || typeof a.description !== 'string') {
        errors.push('Attraction invalide.');
        continue;
      }
      const name = a.name.trim();
      const description = a.description.trim();
      if (
        !name ||
        name.length > SITE_LIMITS.attractionName ||
        description.length > SITE_LIMITS.attractionDescription ||
        CONTROL.test(name + description)
      ) {
        errors.push(
          `Attraction « ${name.slice(0, 30)} » : nom obligatoire, textes trop longs ou invalides.`,
        );
        continue;
      }
      // Photo facultative (absente des contenus antérieurs).
      let attractionMedia: string | null = null;
      if (a.mediaId !== undefined && a.mediaId !== null) {
        if (typeof a.mediaId === 'string' && UUID.test(a.mediaId)) attractionMedia = a.mediaId;
        else errors.push(`Attraction « ${name.slice(0, 30)} » : photo invalide.`);
      }
      attractions.push({ name, description, mediaId: attractionMedia });
    }
  }

  // ─── Champs du thème premium (facultatifs : absents des contenus antérieurs) ───
  const heroHighlights: string[] = [];
  if (input.heroHighlights !== undefined) {
    const v = input.heroHighlights;
    if (
      !Array.isArray(v) ||
      v.length > SITE_LIMITS.heroHighlights ||
      !v.every((x) => typeof x === 'string')
    ) {
      errors.push(`heroHighlights : ${SITE_LIMITS.heroHighlights} étiquettes au plus.`);
    } else {
      for (const x of (v as string[]).map((t) => t.trim()).filter(Boolean)) {
        if (x.length > SITE_LIMITS.highlightLength || CONTROL.test(x)) {
          errors.push(
            `Étiquette « ${x.slice(0, 20)} » : ${SITE_LIMITS.highlightLength} caractères au plus.`,
          );
        } else heroHighlights.push(x);
      }
    }
  }
  const keyFacts: SiteContent['keyFacts'] = [];
  if (input.keyFacts !== undefined) {
    const v = input.keyFacts;
    if (!Array.isArray(v) || v.length > SITE_LIMITS.keyFacts) {
      errors.push(`keyFacts : ${SITE_LIMITS.keyFacts} chiffres clés au plus.`);
    } else {
      for (const f of v) {
        if (!isObj(f) || typeof f.label !== 'string' || typeof f.value !== 'string') {
          errors.push('Chiffre clé invalide.');
          continue;
        }
        const label = f.label.trim();
        const value = f.value.trim();
        if (!label && !value) continue;
        if (
          !label ||
          !value ||
          label.length > SITE_LIMITS.keyFactLength ||
          value.length > SITE_LIMITS.keyFactLength ||
          CONTROL.test(label + value)
        ) {
          errors.push(
            `Chiffre clé « ${label.slice(0, 20)} » : libellé et valeur obligatoires, ${SITE_LIMITS.keyFactLength} caractères au plus.`,
          );
          continue;
        }
        keyFacts.push({ label, value });
      }
    }
  }
  const restaurant: SiteContent['restaurant'] = { description: '', mediaIds: [] };
  if (input.restaurant !== undefined) {
    const r = input.restaurant;
    if (!isObj(r) || typeof r.description !== 'string' || !Array.isArray(r.mediaIds)) {
      errors.push('restaurant : description et photos attendues.');
    } else {
      restaurant.description = r.description.trim();
      if (
        restaurant.description.length > SITE_LIMITS.text ||
        CONTROL.test(restaurant.description)
      ) {
        errors.push(`restaurant : ${SITE_LIMITS.text} caractères au plus.`);
      }
      if (
        r.mediaIds.length > SITE_LIMITS.restaurantPhotos ||
        !r.mediaIds.every((m) => typeof m === 'string' && UUID.test(m))
      ) {
        errors.push(`restaurant : ${SITE_LIMITS.restaurantPhotos} photos au plus.`);
      } else restaurant.mediaIds = [...new Set(r.mediaIds as string[])];
    }
  }

  const priced = <K extends string>(key: string, idKey: K, max: number) => {
    const v = input[key];
    const out: ({ [P in K]: string } & { displayPrice: number | null })[] = [];
    if (!Array.isArray(v) || v.length > max) {
      errors.push(`${key} : ${max} éléments au plus.`);
      return out;
    }
    const seen = new Set<string>();
    for (const item of v) {
      const id = isObj(item) ? item[idKey] : undefined;
      const price = isObj(item) ? item.displayPrice : undefined;
      if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) {
        errors.push(`${key} : identifiant invalide ou en double.`);
        continue;
      }
      if (
        price !== null &&
        (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 100_000_000)
      ) {
        errors.push(`${key} : prix indicatif entier en FCFA attendu.`);
        continue;
      }
      seen.add(id);
      out.push({ [idKey]: id, displayPrice: price as number | null } as { [P in K]: string } & {
        displayPrice: number | null;
      });
    }
    return out;
  };

  const mediaIn = isObj(input.media) ? input.media : null;
  if (!mediaIn) errors.push('media : objet attendu.');
  const mediaId = (v: unknown, label: string): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string' || !UUID.test(v)) {
      errors.push(`${label} : identifiant de média invalide.`);
      return null;
    }
    return v;
  };
  const galleryIn = mediaIn?.galleryIds;
  const galleryIds =
    Array.isArray(galleryIn) && galleryIn.length <= SITE_LIMITS.gallery
      ? (galleryIn.map((g) => mediaId(g, 'Galerie')).filter(Boolean) as string[])
      : (errors.push(`Galerie : ${SITE_LIMITS.gallery} photos au plus.`), []);

  const allowed = sectionsFor(businessType);
  const sectionsIn = isObj(input.sections) ? input.sections : null;
  const order = Array.isArray(sectionsIn?.order) ? (sectionsIn!.order as unknown[]) : [];
  const hidden = Array.isArray(sectionsIn?.hidden) ? (sectionsIn!.hidden as unknown[]) : [];
  const validOrder =
    order.length === allowed.length &&
    new Set(order).size === order.length &&
    order.every((s) => allowed.includes(s as SiteSection));
  if (!validOrder) errors.push('sections : ordre invalide pour ce type d’établissement.');
  if (!hidden.every((s) => allowed.includes(s as SiteSection)))
    errors.push('sections : section masquée inconnue.');

  const content: SiteContent = {
    publicName: text('publicName', SITE_LIMITS.publicName, true),
    tagline: text('tagline', SITE_LIMITS.tagline),
    description: text('description', SITE_LIMITS.description),
    address: text('address', SITE_LIMITS.address),
    city: text('city', 80),
    latitude: coord('latitude', 90),
    longitude: coord('longitude', 180),
    phone: phone('phone'),
    whatsapp: phone('whatsapp'),
    email,
    socials,
    hours,
    hoursNote: text('hoursNote', 300),
    services: strings('services', SITE_LIMITS.services, SITE_LIMITS.serviceLength),
    attractions,
    safetyInfo: text('safetyInfo', SITE_LIMITS.text),
    practicalInfo: text('practicalInfo', SITE_LIMITS.text),
    menu: priced('menu', 'productId', SITE_LIMITS.menuItems),
    tickets: priced('tickets', 'ticketCategoryId', SITE_LIMITS.ticketItems),
    media: {
      logoId: mediaId(mediaIn?.logoId, 'Logo'),
      coverId: mediaId(mediaIn?.coverId, 'Couverture'),
      galleryIds: [...new Set(galleryIds)],
    },
    sections: {
      order: validOrder ? (order as SiteSection[]) : allowed,
      hidden: [...new Set(hidden as SiteSection[])],
    },
    heroHighlights,
    keyFacts,
    restaurant,
  };
  if ((content.latitude === null) !== (content.longitude === null)) {
    errors.push('Coordonnées : latitude et longitude vont ensemble.');
  }
  return errors.length ? { errors } : { content };
}

// ─── Médias ───

export const SITE_MEDIA_KINDS = ['LOGO', 'COVER', 'GALLERY'] as const;
export type SiteMediaKind = (typeof SITE_MEDIA_KINDS)[number];
export const SITE_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const SITE_MEDIA_MAX_DIMENSION = 6000;
export const SITE_MEDIA_MIN_DIMENSION = 64;
export const SITE_MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SiteMediaMimeType = (typeof SITE_MEDIA_MIME_TYPES)[number];

/**
 * Type et dimensions réels d'une image, lus dans son contenu (jamais d'après l'extension ou le
 * type annoncé). null = format refusé ou fichier corrompu.
 */
export function inspectImage(
  bytes: Uint8Array,
): { mime: SiteMediaMimeType; width: number; height: number } | null {
  const u16be = (o: number) => (bytes[o]! << 8) | bytes[o + 1]!;
  const u32be = (o: number) =>
    ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  const u16le = (o: number) => bytes[o]! | (bytes[o + 1]! << 8);
  const u24le = (o: number) => bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
  const at = (sig: number[], o = 0) => sig.every((b, i) => bytes[o + i] === b);

  if (
    bytes.length >= 24 &&
    at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    at([0x49, 0x48, 0x44, 0x52], 12)
  ) {
    return { mime: 'image/png', width: u32be(16), height: u32be(20) };
  }
  if (bytes.length >= 4 && at([0xff, 0xd8, 0xff])) {
    // Parcours des segments jusqu'au marqueur SOF (dimensions de l'image).
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null;
      const marker = bytes[o + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      const len = u16be(o + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', height: u16be(o + 5), width: u16be(o + 7) };
      }
      o += 2 + len;
    }
    return null;
  }
  if (bytes.length >= 30 && at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) {
    if (at([0x56, 0x50, 0x38, 0x20], 12)) {
      return { mime: 'image/webp', width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    }
    if (at([0x56, 0x50, 0x38, 0x4c], 12) && bytes[20] === 0x2f) {
      const b = bytes;
      return {
        mime: 'image/webp',
        width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
        height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
      };
    }
    if (at([0x56, 0x50, 0x38, 0x58], 12)) {
      return { mime: 'image/webp', width: 1 + u24le(24), height: 1 + u24le(27) };
    }
  }
  return null;
}

// ─── Version publiée (seule donnée lue par le public) ───

export interface PublishedMedia {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface PublishedSite {
  slug: string;
  businessType: BusinessType;
  theme: SiteTheme;
  primaryColor: string;
  /** Couleur d'accent (thème Aqua Premium) ; absente des versions publiées avant ce thème. */
  accentColor?: string;
  publishedAt: string;
  /**
   * Textes publiés. Les photos d'attractions et du restaurant y sont résolues en URL publiques
   * (aucun identifiant de média). Les champs du thème premium sont absents des versions publiées
   * avant son introduction : le rendu les traite comme vides.
   */
  content: Omit<
    SiteContent,
    'menu' | 'tickets' | 'media' | 'attractions' | 'restaurant' | 'heroHighlights' | 'keyFacts'
  > & {
    attractions: { name: string; description: string; image?: PublishedMedia | null }[];
    heroHighlights?: string[];
    keyFacts?: { label: string; value: string }[];
    restaurant?: { description: string; photos: PublishedMedia[] };
  };
  logo: PublishedMedia | null;
  cover: PublishedMedia | null;
  gallery: PublishedMedia[];
  /** Menu publié : noms et prix figés à la publication ; aucun coût, stock ni identifiant interne. */
  menu: {
    category: string;
    items: { name: string; description: string | null; price: number | null }[];
  }[];
  /** Tarifs d'entrée indicatifs figés à la publication. */
  tickets: {
    name: string;
    description: string | null;
    conditions: string | null;
    price: number | null;
    peopleIncluded: number;
  }[];
}

/** Réponse publique : site publié, ou indisponible (suspension, expiration) sans perte de contenu. */
export type PublicSiteResponse =
  | { state: 'PUBLISHED'; site: PublishedSite; canonicalUrl: string }
  | { state: 'UNAVAILABLE'; publicName: string };

export const SITE_STATUS_LABELS = {
  DRAFT: 'Brouillon (jamais publié)',
  PUBLISHED: 'Publié',
  UNPUBLISHED: 'Dépublié',
} as const;
export type SiteStatus = keyof typeof SITE_STATUS_LABELS;

/**
 * Adresse canonique d'un site : domaine personnalisé ACTIF, sinon sous-domaine Ocall (si activé),
 * sinon `<origine>/e/<slug>`. Les autres adresses redirigent vers celle-ci (pas de contenu dupliqué).
 */
export function canonicalSiteUrl(input: {
  slug: string;
  activeDomain: string | null;
  sitesBaseDomain: string | null;
  subdomainsEnabled: boolean;
  publicOrigin: string;
}): string {
  if (input.activeDomain) return `https://${input.activeDomain}`;
  if (input.subdomainsEnabled && input.sitesBaseDomain) {
    return `https://${input.slug}.${input.sitesBaseDomain}`;
  }
  return `${input.publicOrigin.replace(/\/$/, '')}/e/${input.slug}`;
}

/** Slug porté par un hôte `slug.<domaine de base>` ; null sinon (www, app… réservés). */
export function slugFromHost(host: string, sitesBaseDomain: string | null): string | null {
  if (!sitesBaseDomain) return null;
  const h = host.toLowerCase().split(':')[0]!;
  const suffix = `.${sitesBaseDomain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  return siteSlugError(label) === null ? label : null;
}
