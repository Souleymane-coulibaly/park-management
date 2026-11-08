/**
 * Contenu commercial de la page d'accueil Ocall Suite (SUITE-S01), séparé des composants.
 *
 * Règles : aucun chiffre commercial inventé (gains, revenus), aucun tarif global (les tarifs
 * appartiennent aux pages de chaque logiciel), aucune fonctionnalité présentée comme disponible si
 * elle ne l'est pas. Ajouter un logiciel = ajouter une entrée à `SUITE_PRODUCTS`.
 */

/**
 * Essai gratuit : le moteur d'essai (14 jours par organisation et par application) n'existe pas
 * encore. En attendant, le bouton mène à la VRAIE demande de démonstration, traitée par l'équipe
 * Ocall. Le jour où le parcours d'essai existe, seule cette constante change.
 */
export const TRIAL_HREF = '/demo';
export const TRIAL_DAYS = 14;
export const DEMO_HREF = '/demo';

export type BenefitIcon = 'clock' | 'ai' | 'shield' | 'growth';

export interface SuiteBenefit {
  icon: BenefitIcon;
  title: string;
  text: string;
  tone: 'green' | 'clay' | 'wine' | 'gold';
}

export const SUITE_BENEFITS: SuiteBenefit[] = [
  {
    icon: 'clock',
    title: 'Gagnez du temps',
    text: 'Automatisez vos opérations, réduisez les tâches répétitives et concentrez-vous sur l’essentiel.',
    tone: 'green',
  },
  {
    icon: 'ai',
    title: 'Intelligence artificielle intégrée',
    text: 'Analysez vos données, obtenez des réponses rapides et prenez de meilleures décisions grâce aux assistants IA disponibles.',
    tone: 'clay',
  },
  {
    icon: 'shield',
    title: 'Sécurité des données',
    text: 'Protégez vos informations grâce aux contrôles d’accès, aux permissions par rôle et à l’isolation des organisations.',
    tone: 'wine',
  },
  {
    icon: 'growth',
    title: 'Développez vos revenus',
    text: 'Suivez vos performances, améliorez votre gestion et identifiez de nouvelles opportunités de croissance.',
    tone: 'gold',
  },
];

export type ProductIcon = 'school' | 'park' | 'invoice' | 'stock';
export type ProductStatus = 'available' | 'preproduction' | 'soon';

export interface SuiteProduct {
  slug: string;
  name: string;
  icon: ProductIcon;
  tagline: string;
  features: string[];
  status: ProductStatus;
  /** Lien vers la page du logiciel (tarifs inclus) ; absent pour un produit à venir. */
  href?: string;
  cta?: string;
  /** Assistants IA disponibles dans ce logiciel. */
  ai?: boolean;
  /** Visuel réel (capture avec données fictives ou photo sous licence) ; absent tant qu'il manque. */
  image?: { src: string; alt: string };
  tone: 'green' | 'clay' | 'wine' | 'gold';
}

export const SUITE_PRODUCTS: SuiteProduct[] = [
  {
    slug: 'ocall-school',
    name: 'Ocall School',
    icon: 'school',
    tagline: 'Gestion des établissements scolaires.',
    features: ['Élèves et enseignants', 'Notes et bulletins', 'Finances', 'Portail parents'],
    status: 'preproduction',
    href: '/solutions/ocall-school',
    cta: 'Découvrir School',
    ai: true,
    tone: 'green',
  },
  {
    slug: 'ocall-park',
    name: 'Ocall Park',
    icon: 'park',
    tagline: 'Gestion des parcs, restaurants et activités de loisirs.',
    features: ['Billetterie et réservations', 'Caisse et cuisine', 'Personnel', 'Reporting'],
    status: 'available',
    href: '/solutions/ocall-park',
    cta: 'Découvrir Park',
    ai: true,
    tone: 'clay',
  },
  {
    slug: 'ocall-facture',
    name: 'Ocall Facture',
    icon: 'invoice',
    tagline: 'Devis, factures, pro forma et bons de commande.',
    features: ['Devis et pro forma', 'Factures', 'Bons de commande'],
    status: 'soon',
    tone: 'wine',
  },
  {
    slug: 'ocall-stock',
    name: 'Ocall Stock',
    icon: 'stock',
    tagline: 'Stocks, fournisseurs, achats, ventes et point de vente.',
    features: ['Stocks', 'Fournisseurs et achats', 'Ventes et point de vente'],
    status: 'soon',
    tone: 'gold',
  },
];

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  available: 'Disponible',
  preproduction: 'En préproduction',
  soon: 'Bientôt disponible',
};

/** Fonctionnalités IA RÉELLEMENT livrées (Ocall AI Core) ; pas d'assistant central multi-produits. */
export const SUITE_AI_FEATURES: { product: string; title: string; text: string }[] = [
  {
    product: 'Ocall School',
    title: 'Copilote de gestion scolaire',
    text: 'Posez vos questions sur les effectifs, les résultats ou les finances de votre établissement.',
  },
  {
    product: 'Ocall School',
    title: 'Assistance pédagogique',
    text: 'Préparez des contenus pédagogiques avec l’aide de l’IA, relus et validés par l’enseignant.',
  },
  {
    product: 'Ocall School',
    title: 'Analyse des résultats',
    text: 'Aide à l’interprétation des notes et des indicateurs d’une classe ou d’une période.',
  },
  {
    product: 'Ocall Park',
    title: 'Copilote analytique',
    text: 'Analysez vos ventes, vos entrées et votre activité en langage naturel.',
  },
  {
    product: 'Ocall Park',
    title: 'Import intelligent',
    text: 'Transformez une carte de restaurant ou une grille de tarifs en catalogue, à vérifier avant validation.',
  },
  {
    product: 'Ocall Park',
    title: 'Commande vocale',
    text: 'Saisissez une commande à la voix, confirmée par le personnel avant envoi.',
  },
];

/** Vision du portail central : présentée comme une orientation, pas comme un service disponible. */
export const SUITE_PORTAL_POINTS: string[] = [
  'Gestion de vos organisations',
  'Accès aux logiciels souscrits',
  'Suivi des contrats et abonnements',
  'Gestion des utilisateurs',
  'Essais gratuits',
  'Accès aux applications métiers indépendantes',
];

/** Visuels manquants : remplacés par des emplacements explicitement identifiés. */
export const SUITE_HERO_IMAGE: { src: string; alt: string } | null = null;
