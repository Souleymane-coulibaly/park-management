import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Activity, Permission, PlatformPermission } from '@ocall/shared';
import type { AuthContext } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const REQUIRED_ACTIVITY = 'requiredActivity';
export const SUPER_ADMIN_ONLY = 'superAdminOnly';
export const PARTNER_ONLY = 'partnerOnly';
export const PLATFORM_PERMISSION = 'platformPermission';
export const ALLOW_MFA_PENDING = 'allowMfaPending';

/** Route accessible sans session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route accessible même si le mot de passe initial n'a pas encore été changé. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Route réservée aux membres d'organisation disposant de la permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/**
 * Route réservée aux organisations dont le métier couvre au moins une des activités (ex. RESTAURANT
 * pour le catalogue, RESTAURANT ou PARK pour les sessions de caisse et les paiements). Vérifiée côté serveur à chaque requête, indépendamment de l'interface.
 */
export const RequireActivity = (...activities: Activity[]) =>
  SetMetadata(REQUIRED_ACTIVITY, activities);

/** Route réservée aux comptes internes Ocall (tout rôle plateforme). */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/**
 * Route du portail partenaires (Sprint 12B) : réservée aux comptes partenaires, jamais à un membre
 * d'organisation ni à un compte interne. Le service filtre toujours sur le partenaire de la session.
 */
export const PartnerOnly = () => SetMetadata(PARTNER_ONLY, true);

/** Route réservée aux comptes internes portant la permission plateforme (Sprint 11A). */
export const RequirePlatformPermission = (permission: PlatformPermission) =>
  SetMetadata(PLATFORM_PERMISSION, permission);

/**
 * Route accessible avant validation du second facteur (connexion, profil, déconnexion, changement
 * de mot de passe, enrôlement et vérification MFA). Toutes les autres l'exigent.
 */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** Injecte le contexte d'authentification résolu par l'AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().auth as AuthContext;
});
