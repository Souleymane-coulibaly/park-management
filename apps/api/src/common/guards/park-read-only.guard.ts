import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_IN_PARK_READ_ONLY } from '../decorators';
import { loadParkAccess } from '../park-access';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Contrôleurs hors du périmètre métier Ocall Park : jamais restreints par cette garde.
 * - sécurité et compte : `auth` ; santé : `health` ;
 * - Ocall (plateforme), sites publics, partenaires : `platform*`, `public*`, `partner` ;
 * - Ocall School (garde de contrat propre) : `school*` ; portail Ocall Suite : `suite` ;
 * - administration nécessaire : `organization` (membres), `roles`, `billing`, `online-payments`
 *   (factures, règlement), `support` (assistance).
 */
const EXEMPT_PREFIXES = [
  'auth',
  'health',
  'platform',
  'public',
  'partner',
  'school',
  'suite',
  'organization',
  'roles',
  'billing',
  'online-payments',
  'support',
];

export const isParkReadOnlyExempt = (controllerPath: string): boolean => {
  const path = controllerPath.replace(/^\/+/, '');
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
};

/**
 * Lecture seule Ocall Park (socle S1, décision D3), appliquée par le serveur après l'authentification
 * et le RBAC : quand l'essai ou l'abonnement Park de l'organisation est échu, suspendu ou résilié,
 * toute écriture métier Park est refusée (403 `PARK_READ_ONLY`). Les consultations et exports (GET)
 * restent ouverts ; aucune donnée n'est supprimée. Les routes nécessaires à la sécurité et à
 * l'administration sont exemptées (préfixes ci-dessus ou `@AllowInParkReadOnly()`).
 * Un compte sans adhésion (plateforme, public, borne) n'est pas concerné.
 */
@Injectable()
export class ParkReadOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const membership = request.auth?.membership;
    if (!membership) return true;
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_IN_PARK_READ_ONLY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const controllerPath =
      (Reflect.getMetadata(PATH_METADATA, context.getClass()) as string | undefined) ?? '';
    if (isParkReadOnlyExempt(controllerPath)) return true;
    // Refus sécurisé : une erreur de lecture des droits n'accorde jamais l'écriture.
    let access: 'full' | 'read_only' | 'none';
    try {
      access = await loadParkAccess(this.prisma, membership.organizationId);
    } catch {
      access = 'read_only';
    }
    if (access === 'full') return true;
    throw new ForbiddenException({
      code: 'PARK_READ_ONLY',
      message:
        'Votre essai ou votre abonnement Ocall Park est échu ou suspendu : l’application est en lecture seule. ' +
        'Vos données sont conservées ; demandez l’activation de votre abonnement depuis le portail Ocall Suite.',
    });
  }
}
