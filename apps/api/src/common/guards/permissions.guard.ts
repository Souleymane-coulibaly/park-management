import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type Activity,
  coversActivity,
  hasPermission,
  hasPlatformPermission,
  type Permission,
  type PlatformPermission,
} from '@ocall/shared';
import {
  PLATFORM_PERMISSION,
  REQUIRED_ACTIVITY,
  REQUIRED_PERMISSION,
  SUPER_ADMIN_ONLY,
} from '../decorators';

/**
 * Applique le RBAC après l'AuthGuard :
 * - @SuperAdminOnly() exige un compte interne Ocall (rôle plateforme) ; @RequirePlatformPermission()
 *   exige en plus la permission plateforme correspondante (matrice de platform.ts) ;
 * - @RequirePermission() exige une adhésion d'organisation dont le rôle porte la permission ;
 * - @RequireActivity() exige que le métier de l'organisation couvre l'activité.
 * Un compte interne n'a pas d'adhésion : il n'accède donc à aucune donnée métier d'un client.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) return true; // route publique : l'AuthGuard a déjà tranché

    const platformPermission = this.reflector.getAllAndOverride<PlatformPermission | undefined>(
      PLATFORM_PERMISSION,
      targets,
    );
    if (
      platformPermission ||
      this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_ONLY, targets)
    ) {
      if (!auth.user.platformRole || auth.membership) throw this.denied();
      if (
        platformPermission &&
        !hasPlatformPermission(auth.user.platformRole, platformPermission)
      ) {
        throw this.denied();
      }
      return true;
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (permission) {
      if (!auth.membership || !hasPermission(auth.membership.role, permission)) throw this.denied();
    }

    const activities = this.reflector.getAllAndOverride<Activity[] | undefined>(
      REQUIRED_ACTIVITY,
      targets,
    );
    const membership = auth.membership;
    if (
      activities &&
      (!membership || !activities.some((a) => coversActivity(membership.businessType, a)))
    ) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: "Ce module n'est pas inclus dans le métier de votre organisation.",
      });
    }
    return true;
  }

  private denied(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires.",
    });
  }
}
