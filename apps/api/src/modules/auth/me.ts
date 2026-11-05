import {
  ROLE_PERMISSIONS,
  navigationFor,
  type Permission,
  type PlatformPermission,
  platformPermissionsOf,
} from '@ocall/shared';
import type { AuthContext } from '../../common/auth-context';

/** Profil de la session courante, avec permissions et navigation calculées côté serveur. */
export interface MeResponse {
  user: AuthContext['user'];
  organization: { id: string; name: string; businessType: string; timezone: string } | null;
  role: string | null;
  permissions: Permission[];
  /** Permissions des comptes internes Ocall (vide pour un membre d'organisation). */
  platformPermissions: PlatformPermission[];
  mfa: AuthContext['mfa'];
  /**
   * Type de compte : membre d'une organisation, compte interne Ocall, partenaire (Sprint 12B) ou
   * responsable d'élève sur le portail parents d'Ocall School (Sprint 6).
   */
  accountKind: 'member' | 'internal' | 'partner' | 'guardian';
  partner: AuthContext['partner'];
  navigation: { key: string; label: string; status: string; href: string | null }[];
}

export function toMe(auth: AuthContext): MeResponse {
  const m = auth.membership;
  return {
    user: auth.user,
    organization: m
      ? {
          id: m.organizationId,
          name: m.organizationName,
          businessType: m.businessType,
          timezone: m.timezone,
        }
      : null,
    role: m?.role ?? (auth.portal ? null : auth.user.platformRole),
    permissions: m ? [...ROLE_PERMISSIONS[m.role]] : [],
    platformPermissions:
      m || auth.partner || auth.portal ? [] : platformPermissionsOf(auth.user.platformRole),
    mfa: auth.mfa,
    accountKind: m ? 'member' : auth.partner ? 'partner' : auth.portal ? 'guardian' : 'internal',
    partner: auth.partner,
    navigation: m
      ? navigationFor(m.businessType, m.role).map((mod) => ({
          key: mod.key,
          label: mod.label,
          status: mod.status,
          href: mod.href ?? null,
        }))
      : [],
  };
}
