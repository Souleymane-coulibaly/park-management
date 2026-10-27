import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  MEMBER_ROLES,
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  assignableRoles,
  isRoleAvailableFor,
} from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';

/**
 * Matrice RBAC. Les rôles et leurs permissions sont définis dans le code (versionnés et testés),
 * et non éditables par organisation au Sprint 1 : c'est le garde-fou le plus sûr pour un socle multi-tenant.
 */
@ApiTags('Rôles et permissions')
@Controller('roles')
export class RolesController {
  @RequirePermission('role.read')
  @Get()
  matrix(@CurrentAuth() auth: AuthContext) {
    const { membership } = requireTenant(auth);
    const assignable = assignableRoles(membership.role);
    return {
      permissions: PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] })),
      roles: MEMBER_ROLES.filter((role) => isRoleAvailableFor(role, membership.businessType)).map(
        (role) => ({
          role,
          label: ROLE_LABELS[role],
          permissions: ROLE_PERMISSIONS[role],
          assignable: assignable.includes(role),
        }),
      ),
    };
  }
}
