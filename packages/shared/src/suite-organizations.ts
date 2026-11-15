/**
 * Ocall Suite — Sprint 2, étape C : appartenance d'un même compte à plusieurs organisations. Une personne
 * qui a déjà un compte est invitée par une autre organisation ; elle accepte depuis son propre compte, puis
 * passe d'une organisation à l'autre. Règles pures partagées par l'API et le web.
 */
import { type MemberRole, hasOrganizationWideScope } from './rbac';

/** Durée de validité d'une invitation. */
export const INVITATION_TTL_DAYS = 7;

/** Rôles qu'une invitation peut donner : jamais propriétaire (la propriété ne se transmet pas ainsi). */
export const INVITABLE_ROLES: readonly MemberRole[] = [
  'ADMIN',
  'SUPERVISOR',
  'CASHIER',
  'KITCHEN',
  'GATE_AGENT',
  'PRODUCT_USER',
];

export const INVITATION_ROLE_LABELS: Partial<Record<MemberRole, string>> = {
  ADMIN: 'Administrateur',
  SUPERVISOR: 'Superviseur',
  CASHIER: 'Caissier',
  KITCHEN: 'Cuisine',
  GATE_AGENT: 'Agent d’entrée',
  PRODUCT_USER: 'Applications seulement (rôles donnés par chaque application)',
};

/**
 * Rôles qu'un membre peut proposer : le propriétaire, tous les rôles invitables ; un administrateur, ni
 * administrateur ni propriétaire. Les autres rôles n'invitent personne.
 */
export function invitableRolesFor(actor: MemberRole): MemberRole[] {
  if (actor === 'OWNER') return [...INVITABLE_ROLES];
  if (actor === 'ADMIN') return INVITABLE_ROLES.filter((r) => r !== 'ADMIN');
  return [];
}

/** Un rôle limité à ses établissements (hors propriétaire, administrateur et applications seulement). */
export function invitationNeedsEstablishments(role: MemberRole): boolean {
  return role !== 'PRODUCT_USER' && !hasOrganizationWideScope(role);
}

/** E-mail en minuscules, identifiant en majuscules ; chaîne vide si la saisie est inexploitable. */
export function normalizeInvitationIdentifier(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : '';
  return /^[A-Za-z0-9-]{3,40}$/.test(v) ? v.toUpperCase() : '';
}

export type InvitationState = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';

/** État affiché : une invitation en attente dont l'échéance est passée est échue (rien n'est écrit). */
export function invitationState(
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED',
  expiresAt: Date | string,
  now: Date = new Date(),
): InvitationState {
  if (status === 'PENDING' && new Date(expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return status;
}
