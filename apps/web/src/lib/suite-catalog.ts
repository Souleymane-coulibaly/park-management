import {
  Building2,
  FileText,
  GraduationCap,
  type LucideIcon,
  Stethoscope,
  Sun,
  Users,
  UtensilsCrossed,
  Waves,
} from 'lucide-react';

/** Produit du catalogue public, tel que renvoyé par l'API (statut décidé par le serveur). */
export interface PublicProduct {
  code: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  status: 'ACTIVE' | 'PILOT' | 'COMING_SOON';
  statusLabel: string;
  subscribable: boolean;
  appUrl: string | null;
  availableAt: string | null;
  plans: { name: string; monthlyPrice: number; setupFee: number; currency: string }[];
}

const API = () => process.env.API_URL ?? 'http://localhost:4000';

/** Catalogue public (cache 5 min) ; null si l'API est momentanément indisponible. */
export async function loadCatalog(): Promise<PublicProduct[] | null> {
  try {
    const res = await fetch(`${API()}/api/v1/public/suite/products`, { next: { revalidate: 300 } });
    return res.ok ? ((await res.json()) as PublicProduct[]) : null;
  } catch {
    return null;
  }
}

export async function loadProduct(slug: string): Promise<PublicProduct | null | 'unavailable'> {
  try {
    const res = await fetch(`${API()}/api/v1/public/suite/products/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as PublicProduct) : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export const PRODUCT_ICONS: Record<string, LucideIcon> = {
  'ocall-park': Waves,
  'ocall-restaurant': UtensilsCrossed,
  'ocall-school': GraduationCap,
  'ocall-clinic': Stethoscope,
  'ocall-rh': Users,
  'ocall-solar': Sun,
  'ocall-docs': FileText,
};
export const productIcon = (slug: string): LucideIcon => PRODUCT_ICONS[slug] ?? Building2;

/**
 * Contenu commercial des pages produits. Seules les fonctionnalités réellement développées et
 * testées sont présentées pour les produits commercialisés ; les produits futurs n'ont qu'une
 * présentation de projet, sans tarif ni date.
 */
export interface ProductContent {
  /** Public visé. */
  audience: string;
  features: { title: string; text: string }[];
  /** Précisions honnêtes affichées sous les fonctionnalités. */
  note?: string;
}

export const PRODUCT_CONTENT: Record<string, ProductContent> = {
  'ocall-park': {
    audience: 'Parcs aquatiques et espaces de loisirs',
    features: [
      {
        title: 'Billetterie',
        text: 'Catégories de billets, tarifs, horaires et jours d’ouverture.',
      },
      {
        title: 'QR codes et contrôle d’accès',
        text: 'Billets à QR code, scan à l’entrée, refus du double passage.',
      },
      {
        title: 'Caisse (POS)',
        text: 'Ventes, encaissement espèces et mobile money saisi, sessions de caisse.',
      },
      {
        title: 'Restauration du parc',
        text: 'Commandes, écran cuisine (KDS) et stocks avec l’offre Parc + Restaurant.',
      },
      { title: 'Clients et fidélité', text: 'Fichier clients, points de fidélité, historique.' },
      { title: 'Planning du personnel', text: 'Postes et affectations des équipes.' },
      {
        title: 'Analyses',
        text: 'Chiffre d’affaires, fréquentation, heures de pointe, exports CSV.',
      },
      {
        title: 'Intelligence artificielle',
        text: 'Copilote en lecture seule sur vos chiffres, import assisté du catalogue.',
      },
      {
        title: 'Site vitrine',
        text: 'Un site public pour votre parc, avec vos tarifs et horaires.',
      },
    ],
    note: 'Imprimantes, tiroirs-caisses et lecteurs sont validés lors de l’installation sur site.',
  },
  'ocall-restaurant': {
    audience: 'Restaurants, maquis et cafés',
    features: [
      { title: 'Caisse (POS)', text: 'Ventes rapides, encaissement, tickets, sessions de caisse.' },
      { title: 'Commandes et tables', text: 'Sur place, à emporter, au comptoir ; plan de salle.' },
      {
        title: 'Écran cuisine (KDS)',
        text: 'Commandes en temps réel, préparation, commandes prêtes.',
      },
      { title: 'Commande QR à table', text: 'Le client commande, le personnel valide.' },
      { title: 'Stocks', text: 'Mouvements, recettes, alertes de seuil.' },
      { title: 'Réservations et bornes', text: 'Réservations de tables, bornes de commande.' },
      { title: 'Clients et fidélité', text: 'Fichier clients et points de fidélité.' },
      { title: 'Analyses et IA', text: 'Marges, produits phares, copilote en lecture seule.' },
      { title: 'Site vitrine', text: 'Votre carte et vos horaires en ligne.' },
    ],
    note: 'Ocall Restaurant est une offre de la plateforme Ocall Park, avec son propre tarif.',
  },
  'ocall-school': {
    audience: 'Écoles primaires et secondaires',
    features: [
      {
        title: 'Projet en préparation',
        text: 'Une solution dédiée à la gestion des écoles primaires et secondaires.',
      },
    ],
  },
  'ocall-clinic': {
    audience: 'Cliniques et cabinets médicaux',
    features: [
      { title: 'Projet futur', text: 'Une solution dédiée aux cliniques et cabinets médicaux.' },
    ],
  },
  'ocall-rh': {
    audience: 'Entreprises de toutes tailles',
    features: [{ title: 'Projet futur', text: 'Une solution de gestion des ressources humaines.' }],
  },
  'ocall-solar': {
    audience: 'Entreprises du solaire',
    features: [
      {
        title: 'Projet futur',
        text: 'Une solution pour les installateurs et distributeurs solaires.',
      },
    ],
  },
  'ocall-docs': {
    audience: 'Organisations publiques et privées',
    features: [
      { title: 'Projet futur', text: 'Une solution de gestion électronique des documents.' },
    ],
  },
};
