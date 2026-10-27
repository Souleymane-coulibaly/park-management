import type { Prisma } from '@ocall/database';
import { hasOrganizationWideScope } from '@ocall/shared';
import type { TenantContext } from './auth-context';

/**
 * Filtre des établissements visibles : toujours restreint à l'organisation de la session,
 * et, hors OWNER/ADMIN, aux seuls établissements affectés au membre.
 */
export function establishmentScope(auth: TenantContext): Prisma.EstablishmentWhereInput {
  const where: Prisma.EstablishmentWhereInput = { organizationId: auth.membership.organizationId };
  if (!hasOrganizationWideScope(auth.membership.role)) {
    where.assignments = { some: { membershipId: auth.membership.id } };
  }
  return where;
}

/** Filtre des membres visibles : ceux de l'organisation, et hors OWNER/ADMIN, ceux qui partagent un établissement. */
export function membershipScope(auth: TenantContext): Prisma.OrganizationMembershipWhereInput {
  const where: Prisma.OrganizationMembershipWhereInput = {
    organizationId: auth.membership.organizationId,
  };
  if (!hasOrganizationWideScope(auth.membership.role)) {
    where.assignments = {
      some: { establishment: { assignments: { some: { membershipId: auth.membership.id } } } },
    };
  }
  return where;
}
