import { ForbiddenException } from '@nestjs/common';
import type { BusinessType, MemberRole, PlatformRole } from '@ocall/shared';

/** Contexte d'authentification résolu côté serveur à partir du cookie de session. */
export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    loginId: string;
    mustChangePassword: boolean;
    platformRole: PlatformRole | null;
  };
  /** Absent pour un SUPER_ADMIN, qui n'est membre d'aucune organisation. */
  membership: {
    id: string;
    role: MemberRole;
    organizationId: string;
    organizationName: string;
    businessType: BusinessType;
    timezone: string;
  } | null;
}

/** Contexte d'un membre d'organisation : seule source fiable de l'organizationId. */
export type TenantContext = AuthContext & { membership: NonNullable<AuthContext['membership']> };

/**
 * Restreint un contexte à un membre d'organisation. Les routes @RequirePermission()
 * le garantissent déjà ; cette vérification protège contre un oubli de décorateur.
 */
export function requireTenant(auth: AuthContext): TenantContext {
  if (!auth.membership) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }
  return auth as TenantContext;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Renseigné par l'AuthGuard sur les routes authentifiées. */
      auth?: AuthContext;
    }
  }
}
