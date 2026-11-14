/**
 * Ocall Stock — S7 : site vitrine (présentation, catalogue public facultatif, demandes). Règles partagées
 * par l'API et le web. Les mécanismes communs des vitrines (adresses, domaines, images, anti-spam,
 * WhatsApp) viennent de `sites.ts`, `school-site.ts` et `commercial.ts` : rien n'est recopié ici.
 *
 * Jamais publiés : prix d'achat, marges, quantités, fournisseurs, clients. La disponibilité n'est qu'un
 * badge « Disponible » / « Sur commande », sans chiffre.
 */

export const STOCK_SHOWCASE_REQUEST_KINDS = ['CONTACT', 'QUOTE'] as const;
export type StockShowcaseRequestKind = (typeof STOCK_SHOWCASE_REQUEST_KINDS)[number];

export const STOCK_SHOWCASE_REQUEST_KIND_LABELS: Record<StockShowcaseRequestKind, string> = {
  CONTACT: 'Renseignement',
  QUOTE: 'Demande de devis',
};

export const STOCK_SHOWCASE_REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'SPAM'] as const;
export type StockShowcaseRequestStatus = (typeof STOCK_SHOWCASE_REQUEST_STATUSES)[number];

export const STOCK_SHOWCASE_REQUEST_STATUS_LABELS: Record<StockShowcaseRequestStatus, string> = {
  NEW: 'Nouvelle',
  IN_PROGRESS: 'En cours',
  DONE: 'Traitée',
  SPAM: 'Indésirable',
};

export const STOCK_SHOWCASE_MEDIA_KINDS = ['LOGO', 'COVER', 'GALLERY'] as const;
export type StockShowcaseMediaKind = (typeof STOCK_SHOWCASE_MEDIA_KINDS)[number];
export const STOCK_SHOWCASE_MAX_GALLERY = 12;
/** Articles par page du catalogue public, articles joints à une demande. */
export const STOCK_SHOWCASE_PAGE_SIZE = 24;
export const STOCK_SHOWCASE_MAX_REQUEST_ITEMS = 20;

/** Contenu d'une vitrine (brouillon modifiable ; la version publiée en est une copie figée). */
export interface StockShowcaseContent {
  headline: string;
  tagline: string | null;
  about: string | null;
  phone: string | null;
  /** Numéro WhatsApp international (bouton « Écrire sur WhatsApp »). */
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  /** Horaires, texte libre (« Lun–Sam 8 h–19 h »). */
  hours: string | null;
  /** Lien https vers une carte. */
  mapUrl: string | null;
  seoDescription: string | null;
  /**
   * Couleur principale de la vitrine (#RRGGBB, boutons et bandeaux à texte blanc lisible) ; null = couleur
   * Ocall par défaut. Même règle que les sites Park.
   */
  primaryColor?: string | null;
  /** Catalogue public (articles cochés « Publier sur la vitrine »). */
  showCatalog: boolean;
  /** Prix de vente TTC affichés ; sinon « Prix sur demande ». */
  showPrices: boolean;
  /** Formulaires proposés aux visiteurs. */
  forms: StockShowcaseRequestKind[];
}

/** Version publiée : contenu figé, nom de l'entreprise, images. Le catalogue est lu en direct. */
export interface StockShowcasePublished extends StockShowcaseContent {
  businessName: string;
  logo: string | null;
  cover: string | null;
  gallery: { key: string; caption: string | null }[];
  publishedAt: string;
}

/** Badge de disponibilité publié : jamais une quantité. */
export type StockShowcaseAvailability = 'AVAILABLE' | 'ON_ORDER';

export const STOCK_SHOWCASE_AVAILABILITY_LABELS: Record<StockShowcaseAvailability, string> = {
  AVAILABLE: 'Disponible',
  ON_ORDER: 'Sur commande',
};

/** Article du catalogue public : seulement des données de vente. */
export interface StockShowcaseProduct {
  id: string;
  name: string;
  description: string | null;
  category: { id: string; name: string } | null;
  brand: string | null;
  unit: string;
  /** Prix de vente TTC (plus bas des variantes) ; null si les prix ne sont pas affichés. */
  priceTtc: number | null;
  /** Plusieurs prix selon la variante : « à partir de ». */
  priceFrom: boolean;
  availability: StockShowcaseAvailability;
  /** Photos (identifiants publics). */
  images: string[];
  /** Parmi elles, les illustrations générées par IA (S8), affichées avec leur mention. */
  illustrations: string[];
}

/**
 * Adresse canonique d'une vitrine Stock : domaine personnalisé ACTIF, sinon sous-domaine des vitrines
 * Stock (si activé), sinon `<origine>/m/<slug>`. Préfixe `/m/` distinct des sites Park (`/e/`), School
 * (`/s/`) et Facture (`/v/`).
 */
export function stockShowcaseCanonicalUrl(input: {
  slug: string;
  activeDomain: string | null;
  baseDomain: string | null;
  subdomainsEnabled: boolean;
  publicOrigin: string;
}): string {
  if (input.activeDomain) return `https://${input.activeDomain}`;
  if (input.subdomainsEnabled && input.baseDomain) {
    return `https://${input.slug}.${input.baseDomain}`;
  }
  return `${input.publicOrigin.replace(/\/$/, '')}/m/${input.slug}`;
}

/** Pages d'une vitrine Stock servies sur son hôte : accueil, catalogue, fiche article. */
export function parseStockShowcasePath(
  path: string,
): { page: 'home' } | { page: 'catalog' } | { page: 'product'; id: string } | null {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return { page: 'home' };
  if (p === '/catalogue') return { page: 'catalog' };
  const m = /^\/article\/([0-9a-f-]{36})$/i.exec(p);
  return m ? { page: 'product', id: m[1]!.toLowerCase() } : null;
}

const address = (site: StockShowcasePublished) =>
  site.address || site.city
    ? {
        '@type': 'PostalAddress',
        ...(site.address ? { streetAddress: site.address } : {}),
        ...(site.city ? { addressLocality: site.city } : {}),
        addressCountry: 'ML',
      }
    : undefined;

/** Données structurées schema.org `Store` (référencement local), données publiées seulement. */
export function stockShowcaseStoreJsonLd(
  site: StockShowcasePublished,
  url: string,
  mediaUrl: (key: string) => string,
) {
  const addr = address(site);
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: site.businessName,
    url,
    ...(site.seoDescription || site.tagline
      ? { description: site.seoDescription ?? site.tagline }
      : {}),
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.email ? { email: site.email } : {}),
    ...(addr ? { address: addr } : {}),
    ...(site.hours ? { openingHours: site.hours } : {}),
    ...(site.logo ? { logo: mediaUrl(site.logo) } : {}),
    ...(site.cover || site.logo ? { image: mediaUrl((site.cover ?? site.logo)!) } : {}),
  };
}

/**
 * Données structurées `Product` et `Offer` d'une fiche article : prix seulement s'il est affiché,
 * disponibilité en stock ou sur commande, vendeur = l'entreprise.
 */
export function stockShowcaseProductJsonLd(
  site: StockShowcasePublished,
  product: StockShowcaseProduct,
  url: string,
  imageUrl: (id: string) => string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    ...(product.description ? { description: product.description } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(product.category ? { category: product.category.name } : {}),
    ...(product.images.length ? { image: product.images.map(imageUrl) } : {}),
    offers: {
      '@type': 'Offer',
      url,
      availability:
        product.availability === 'AVAILABLE'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/BackOrder',
      seller: { '@type': 'Organization', name: site.businessName },
      ...(product.priceTtc !== null ? { price: product.priceTtc, priceCurrency: 'XOF' } : {}),
    },
  };
}
