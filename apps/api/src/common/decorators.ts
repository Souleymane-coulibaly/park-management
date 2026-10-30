import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Activity, Permission } from '@ocall/shared';
import type { AuthContext } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const REQUIRED_ACTIVITY = 'requiredActivity';
export const SUPER_ADMIN_ONLY = 'superAdminOnly';

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

/** Route réservée au SUPER_ADMIN de la plateforme. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Injecte le contexte d'authentification résolu par l'AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().auth as AuthContext;
});
