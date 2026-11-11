/**
 * Ocall Facture — site vitrine professionnel (F5) : contenu publié, demandes reçues (contact, devis,
 * intervention, rendez-vous), adresse canonique, données structurées LocalBusiness. Règles partagées par
 * l'API et le web. Les mécanismes communs des vitrines (adresses, domaines, images, anti-spam) viennent
 * de `sites.ts`, `school-site.ts` et `commercial.ts` : rien n'est recopié ici.
 */

export const FACTURE_REQUEST_KINDS = ['CONTACT', 'QUOTE', 'INTERVENTION', 'APPOINTMENT'] as const;
export type FactureRequestKind = (typeof FACTURE_REQUEST_KINDS)[number];

export const FACTURE_REQUEST_KIND_LABELS: Record<FactureRequestKind, string> = {
  CONTACT: 'Contact',
  QUOTE: 'Demande de devis',
  INTERVENTION: 'Demande d’intervention',
  APPOINTMENT: 'Demande de rendez-vous',
};

export const FACTURE_REQUEST_STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'SPAM'] as const;
export type FactureRequestStatus = (typeof FACTURE_REQUEST_STATUSES)[number];

export const FACTURE_REQUEST_STATUS_LABELS: Record<FactureRequestStatus, string> = {
  NEW: 'Nouvelle',
  IN_PROGRESS: 'En cours',
  DONE: 'Traitée',
  SPAM: 'Indésirable',
};

/** Limites du contenu publié. */
export const FACTURE_SITE_MAX_SERVICES = 30;
export const FACTURE_SITE_MAX_GALLERY = 12;
export const FACTURE_SITE_MEDIA_KINDS = ['LOGO', 'COVER', 'GALLERY'] as const;
export type FactureSiteMediaKind = (typeof FACTURE_SITE_MEDIA_KINDS)[number];

/** Contenu d'une vitrine (brouillon modifiable ; la version publiée en est une copie figée). */
export interface FactureSiteContent {
  headline: string;
  tagline: string | null;
  about: string | null;
  /** Prestations du catalogue mises en avant ; prix affiché seulement si demandé. */
  services: { itemId: string; showPrice: boolean }[];
  phone: string | null;
  /** Numéro WhatsApp international (bouton « Écrire sur WhatsApp »). */
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  /** Horaires, texte libre (« Lun–Ven 8 h–18 h, sam. 8 h–13 h »). */
  hours: string | null;
  /** Lien https vers une carte (Google Maps, OpenStreetMap…). */
  mapUrl: string | null;
  seoDescription: string | null;
  /** Formulaires proposés aux visiteurs. */
  forms: FactureRequestKind[];
}

/** Version publiée : contenu, prestations résolues depuis le catalogue (libellés et prix figés). */
export interface FactureSitePublished extends Omit<FactureSiteContent, 'services'> {
  businessName: string;
  services: {
    itemId: string;
    name: string;
    description: string | null;
    unit: string;
    /** Prix TTC en FCFA, seulement si l'entreprise a choisi de l'afficher. */
    priceTtc: number | null;
  }[];
  logo: string | null;
  cover: string | null;
  gallery: { key: string; caption: string | null }[];
  publishedAt: string;
}

/**
 * Adresse canonique d'une vitrine Facture : domaine personnalisé ACTIF, sinon sous-domaine Ocall des
 * vitrines Facture (si activé), sinon `<origine>/v/<slug>`. Préfixe `/v/` distinct des sites Park (`/e/`)
 * et School (`/s/`).
 */
export function factureSiteCanonicalUrl(input: {
  slug: string;
  activeDomain: string | null;
  baseDomain: string | null;
  subdomainsEnabled: boolean;
  publicOrigin: string;
}): string {
  if (input.activeDomain) return `https://${input.activeDomain}`;
  if (input.subdomainsEnabled && input.baseDomain)
    return `https://${input.slug}.${input.baseDomain}`;
  return `${input.publicOrigin.replace(/\/$/, '')}/v/${input.slug}`;
}

/**
 * Données structurées schema.org `LocalBusiness` (SEO et référencement local) : seulement des données
 * publiées par l'entreprise, aucune donnée interne.
 */
export function factureSiteJsonLd(
  site: FactureSitePublished,
  url: string,
  mediaUrl: (key: string) => string,
) {
  const address =
    site.address || site.city
      ? {
          '@type': 'PostalAddress',
          ...(site.address ? { streetAddress: site.address } : {}),
          ...(site.city ? { addressLocality: site.city } : {}),
          addressCountry: 'ML',
        }
      : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: site.businessName,
    url,
    ...(site.seoDescription || site.tagline
      ? { description: site.seoDescription ?? site.tagline }
      : {}),
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.email ? { email: site.email } : {}),
    ...(address ? { address } : {}),
    ...(site.hours ? { openingHours: site.hours } : {}),
    ...(site.logo ? { logo: mediaUrl(site.logo) } : {}),
    ...(site.cover || site.logo ? { image: mediaUrl((site.cover ?? site.logo)!) } : {}),
    ...(site.services.length
      ? {
          makesOffer: site.services.map((s) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: s.name },
            ...(s.priceTtc !== null ? { price: s.priceTtc, priceCurrency: 'XOF' } : {}),
          })),
        }
      : {}),
  };
}
