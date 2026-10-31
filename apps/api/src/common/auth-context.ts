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
  /**
   * Second facteur (comptes internes Ocall) : requis selon le rôle, enrôlé ou non, validé ou non
   * pour cette session.
   */
  mfa: { required: boolean; enrolled: boolean; verified: boolean };
  /**
   * Compte partenaire commercial (Sprint 12B), exclusif d'une adhésion et d'un rôle interne. Un
   * partenaire suspendu n'a plus de session.
   */
  partner: {
    id: string;
    code: string;
    companyName: string;
    status: 'PENDING_VERIFICATION' | 'ACTIVE';
  } | null;
  /** Absent pour un compte interne Ocall, qui n'est membre d'aucune organisation. */
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

/** Contexte d'un partenaire commercial : seule source fiable du partnerId. */
export type PartnerContext = AuthContext & { partner: NonNullable<AuthContext['partner']> };

/**
 * Restreint un contexte à un partenaire. Par défaut, le partenaire doit être vérifié (actif) ; un
 * partenaire en attente de vérification n'accède qu'à son profil.
 */
export function requirePartner(
  auth: AuthContext,
  options: { allowPending?: boolean } = {},
): PartnerContext {
  if (!auth.partner || auth.membership || auth.user.platformRole) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }
  if (auth.partner.status !== 'ACTIVE' && !options.allowPending) {
    throw new ForbiddenException({
      code: 'PARTNER_NOT_VERIFIED',
      message: 'Votre profil partenaire est en cours de vérification par Ocall.',
    });
  }
  return auth as PartnerContext;
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
