import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@ocall/shared';
import type { AuthContext } from './auth-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const SUPER_ADMIN_ONLY = 'superAdminOnly';

/** Route accessible sans session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route accessible même si le mot de passe initial n'a pas encore été changé. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Route réservée aux membres d'organisation disposant de la permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/** Route réservée au SUPER_ADMIN de la plateforme. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_ONLY, true);

/** Injecte le contexte d'authentification résolu par l'AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().auth as AuthContext;
});
