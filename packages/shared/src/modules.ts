import { type Activity, type BusinessType, coversActivity } from './business';
import { type MemberRole, type Permission, hasPermission } from './rbac';

export type ModuleStatus = 'available' | 'upcoming';

export interface ModuleDefinition {
  key: string;
  label: string;
  description: string;
  status: ModuleStatus;
  /** Activités donnant accès au module ; vide = commun à tous les métiers. */
  activities: readonly Activity[];
  /** Permission requise pour voir le module. */
  permission: Permission;
  /** Route frontend des modules disponibles. */
  href?: string;
}

/**
 * Catalogue des modules. Un module « upcoming » est annoncé mais non opérationnel :
 * il ne doit jamais être présenté comme disponible.
 */
export const MODULES: readonly ModuleDefinition[] = [
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    description: "Vue d'ensemble de votre activité.",
    status: 'available',
    activities: [],
    permission: 'dashboard.read',
    href: '/app',
  },
  {
    key: 'ticketing',
    label: 'Billetterie',
    description: 'Vente de billets adultes, enfants, famille et groupe avec QR code individuel.',
    status: 'available',
    activities: ['PARK'],
    permission: 'pos.sell',
    href: '/app/billetterie',
  },
  {
    key: 'gate-control',
    label: 'Contrôle des entrées',
    description: 'Scan des billets QR à l’entrée, avec historique des passages.',
    status: 'available',
    activities: ['PARK'],
    permission: 'access.scan',
    href: '/app/controle-acces',
  },
  {
    key: 'pos',
    label: 'Caisse POS',
    description: 'Encaissement tactile, sessions de caisse et historique des ventes.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'pos.sell',
    href: '/app/caisse',
  },
  {
    key: 'catalog',
    label: 'Catalogue',
    description: 'Produits, catégories, variantes et tarifs par établissement.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'catalog.read',
    href: '/app/catalogue',
  },
  {
    key: 'orders',
    label: 'Commandes',
    description: 'Commandes sur place, à emporter, au comptoir et par QR code ; envoi en cuisine.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'pos.sell',
    href: '/app/commandes',
  },
  {
    key: 'kitchen',
    label: 'Cuisine KDS',
    description: 'Écran de préparation en cuisine, en temps réel.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'kitchen.view',
    href: '/app/cuisine',
  },
  {
    key: 'reservations',
    label: 'Réservations',
    description: 'Réservations de tables, vue liste et calendrier, sans double réservation.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'reservation.manage',
    href: '/app/reservations',
  },
  {
    key: 'tables',
    label: 'Salles et tables',
    description: 'Salles, terrasses, bords de piscine, tables et QR codes de commande.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'tables.manage',
    href: '/app/restaurant/tables',
  },
  {
    key: 'stock',
    label: 'Stocks',
    description: 'Ingrédients, entrées, sorties, inventaires, recettes et alertes de stock.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'stock.read',
    href: '/app/stocks',
  },
  {
    key: 'kiosks',
    label: 'Bornes de commande',
    description:
      'Bornes libre-service : appairage sécurisé, révocation, commandes en attente de paiement.',
    status: 'available',
    activities: ['RESTAURANT'],
    permission: 'kiosk.manage',
    href: '/app/bornes',
  },
  {
    key: 'crm',
    label: 'Clients et fidélité',
    description: 'Fiches clients, consentement, historique, fidélité Parc et Restaurant.',
    status: 'available',
    activities: [],
    permission: 'customer.read',
    href: '/app/clients',
  },
  {
    key: 'hr-planning',
    label: 'Planning',
    description: 'Plannings journaliers, hebdomadaires et mensuels, affectation des postes.',
    status: 'available',
    activities: [],
    permission: 'dashboard.read',
    href: '/app/personnel/planning',
  },
  {
    key: 'site',
    label: 'Site web',
    description:
      'Site vitrine public de chaque établissement : présentation, photos, horaires, menu et tarifs indicatifs.',
    status: 'available',
    activities: [],
    permission: 'site.manage',
    href: '/app/site-web',
  },
  {
    key: 'analytics',
    label: 'Analyses',
    description:
      'Chiffre d’affaires, ventes par produit et par heure, fréquentation, marges estimées et exports.',
    status: 'available',
    activities: [],
    permission: 'analytics.read',
    href: '/app/analytics',
  },
  {
    key: 'copilot',
    label: 'Copilote IA',
    description:
      'Questions en français sur votre activité, en lecture seule, calculées sur vos données réelles.',
    status: 'available',
    activities: [],
    permission: 'ai.copilot',
    href: '/app/copilot',
  },
  {
    key: 'employees',
    label: 'Employés',
    description: 'Comptes nominatifs, rôles et affectations.',
    status: 'available',
    activities: [],
    permission: 'employee.read',
    href: '/app/employes',
  },
  {
    key: 'support',
    label: 'Support Ocall',
    description: 'Demandes d’assistance à l’équipe Ocall : suivi, réponses, pièces jointes.',
    status: 'available',
    activities: [],
    permission: 'support.use',
    href: '/app/support',
  },
  {
    key: 'settings',
    label: 'Paramètres',
    description: 'Organisation, établissements, rôles, abonnement et compte.',
    status: 'available',
    activities: [],
    permission: 'organization.read',
    href: '/app/parametres',
  },
];

export function findModule(key: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.key === key);
}

/** Un module est accessible si le métier couvre au moins une de ses activités. */
export function isModuleAvailableFor(
  module: ModuleDefinition,
  businessType: BusinessType,
): boolean {
  return (
    module.activities.length === 0 || module.activities.some((a) => coversActivity(businessType, a))
  );
}

/** Modules affichés dans la navigation, selon le métier ET le rôle. */
export function navigationFor(businessType: BusinessType, role: MemberRole): ModuleDefinition[] {
  return MODULES.filter(
    (m) => isModuleAvailableFor(m, businessType) && hasPermission(role, m.permission),
  );
}
