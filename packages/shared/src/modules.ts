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
    description: 'Vente de tickets adultes, enfants et groupes avec QR Code.',
    status: 'upcoming',
    activities: ['PARK'],
    permission: 'dashboard.read',
  },
  {
    key: 'gate-control',
    label: 'Contrôle des entrées',
    description: 'Validation des tickets QR Code à l’entrée.',
    status: 'upcoming',
    activities: ['PARK'],
    permission: 'dashboard.read',
  },
  {
    key: 'pos',
    label: 'Caisse POS',
    description: 'Encaissement sur terminal Android, impression thermique et tiroir-caisse.',
    status: 'upcoming',
    activities: ['RESTAURANT'],
    permission: 'dashboard.read',
  },
  {
    key: 'catalog',
    label: 'Catalogue',
    description: 'Produits, menus, catégories et prix.',
    status: 'upcoming',
    activities: ['RESTAURANT'],
    permission: 'dashboard.read',
  },
  {
    key: 'orders',
    label: 'Commandes',
    description: 'Commandes au comptoir, à table et par QR Code.',
    status: 'upcoming',
    activities: ['RESTAURANT'],
    permission: 'dashboard.read',
  },
  {
    key: 'kitchen',
    label: 'Cuisine KDS',
    description: 'Écran de préparation en cuisine.',
    status: 'upcoming',
    activities: ['RESTAURANT'],
    permission: 'dashboard.read',
  },
  {
    key: 'stock',
    label: 'Stocks',
    description: 'Suivi des stocks et des approvisionnements.',
    status: 'upcoming',
    activities: ['RESTAURANT'],
    permission: 'dashboard.read',
  },
  {
    key: 'crm',
    label: 'CRM',
    description: 'Clients et programmes de fidélité Parc et Restaurant.',
    status: 'upcoming',
    activities: [],
    permission: 'dashboard.read',
  },
  {
    key: 'hr-planning',
    label: 'Planning RH',
    description: 'Plannings journaliers, hebdomadaires et mensuels, affectation des postes.',
    status: 'upcoming',
    activities: [],
    permission: 'dashboard.read',
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
