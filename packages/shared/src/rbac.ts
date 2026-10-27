import { type BusinessType, coversActivity } from './business';

/** Rôles au sein d'une organisation cliente. */
export const MemberRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  CASHIER: 'CASHIER',
  KITCHEN: 'KITCHEN',
  GATE_AGENT: 'GATE_AGENT',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export const MEMBER_ROLES: readonly MemberRole[] = Object.values(MemberRole);

/**
 * Rôle plateforme, distinct des rôles d'organisation : un SUPER_ADMIN gère le SaaS
 * mais n'est membre d'aucune organisation et n'accède pas à leurs données métier.
 */
export const PlatformRole = { SUPER_ADMIN: 'SUPER_ADMIN' } as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export const ROLE_LABELS: Record<MemberRole | PlatformRole, string> = {
  SUPER_ADMIN: 'Super administrateur',
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  SUPERVISOR: 'Superviseur',
  CASHIER: 'Caissier',
  KITCHEN: 'Cuisine',
  GATE_AGENT: "Agent d'entrée",
};

export const Permission = {
  DASHBOARD_READ: 'dashboard.read',
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_UPDATE: 'organization.update',
  ORGANIZATION_CHANGE_BUSINESS_TYPE: 'organization.change_business_type',
  ESTABLISHMENT_READ: 'establishment.read',
  ESTABLISHMENT_MANAGE: 'establishment.manage',
  EMPLOYEE_READ: 'employee.read',
  EMPLOYEE_MANAGE: 'employee.manage',
  ROLE_READ: 'role.read',
  ROLE_ASSIGN: 'role.assign',
  SUBSCRIPTION_READ: 'subscription.read',
  AUDIT_READ: 'audit.read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const PERMISSIONS: readonly Permission[] = Object.values(Permission);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.read': 'Consulter le tableau de bord',
  'organization.read': "Consulter l'organisation",
  'organization.update': "Modifier l'organisation",
  'organization.change_business_type': 'Faire évoluer le métier',
  'establishment.read': 'Consulter les établissements',
  'establishment.manage': 'Gérer les établissements',
  'employee.read': 'Consulter les employés',
  'employee.manage': 'Gérer les employés',
  'role.read': 'Consulter les rôles',
  'role.assign': 'Attribuer les rôles',
  'subscription.read': "Consulter l'abonnement",
  'audit.read': "Consulter le journal d'audit",
};

const P = Permission;
const OPERATOR_BASE: readonly Permission[] = [P.DASHBOARD_READ, P.ORGANIZATION_READ];

/** Matrice RBAC unique : appliquée par l'API, reflétée par le frontend. */
export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS.filter((p) => p !== P.ORGANIZATION_CHANGE_BUSINESS_TYPE),
  SUPERVISOR: [...OPERATOR_BASE, P.ESTABLISHMENT_READ, P.EMPLOYEE_READ, P.ROLE_READ],
  CASHIER: OPERATOR_BASE,
  KITCHEN: OPERATOR_BASE,
  GATE_AGENT: OPERATOR_BASE,
};

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Rôles qui voient toute l'organisation, et pas seulement leurs établissements affectés. */
export function hasOrganizationWideScope(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Rôles qu'un membre peut attribuer : un ADMIN ne crée ni ADMIN ni OWNER. */
export function assignableRoles(actor: MemberRole): MemberRole[] {
  if (actor === 'OWNER') return [...MEMBER_ROLES];
  if (actor === 'ADMIN') return ['SUPERVISOR', 'CASHIER', 'KITCHEN', 'GATE_AGENT'];
  return [];
}

/** Un membre ne gère que les comptes dont il pourrait attribuer le rôle. */
export function canManageRole(actor: MemberRole, target: MemberRole): boolean {
  return assignableRoles(actor).includes(target);
}

/** KITCHEN exige une activité restaurant, GATE_AGENT une activité parc. */
export function isRoleAvailableFor(role: MemberRole, businessType: BusinessType): boolean {
  if (role === 'KITCHEN') return coversActivity(businessType, 'RESTAURANT');
  if (role === 'GATE_AGENT') return coversActivity(businessType, 'PARK');
  return true;
}
