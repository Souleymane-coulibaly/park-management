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
import { type Activity, coversActivity } from '@ocall/shared';
import { ALLOW_IN_PARK_READ_ONLY, REQUIRED_ACTIVITY } from '../decorators';
import { loadActivityAccess, loadParkAccess } from '../park-access';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Contrôleurs hors du périmètre métier Ocall Park : jamais restreints par cette garde.
 * - sécurité et compte : `auth` ; santé : `health` ;
 * - Ocall (plateforme), sites publics, partenaires : `platform*`, `public*`, `partner` ;
 * - Ocall School (garde de contrat propre) : `school*` ; portail Ocall Suite : `suite` ;
 * - Ocall Print (garde propre, accès autonome gratuit sans abonnement) : `ocall-print` ;
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
  'ocall-print',
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
    // Sprint 7 : droit de l'activité de la route (Ocall Parc ou Ocall Restaurant, ou contrat combiné).
    // Route commune aux deux activités (caisse, ventes, clients…) : un droit actif sur l'une suffit.
    const declared =
      this.reflector.getAllAndOverride<Activity[] | undefined>(REQUIRED_ACTIVITY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const activities = declared.filter((a) => coversActivity(membership.businessType, a));
    // Refus sécurisé : une erreur de lecture des droits n'accorde jamais l'écriture.
    let full = false;
    try {
      full = activities.length
        ? (
            await Promise.all(
              activities.map((a) => loadActivityAccess(this.prisma, membership.organizationId, a)),
            )
          ).includes('full')
        : (await loadParkAccess(this.prisma, membership.organizationId)) === 'full';
    } catch {
      full = false;
    }
    if (full) return true;
    throw parkReadOnlyError(activities.length === 1 ? activities[0]! : null);
  }
}

/**
 * Refus d'écriture d'une activité sans droit actif (code inchangé `PARK_READ_ONLY` pour les écrans
 * existants ; `activity` précise l'application concernée depuis le sprint 7).
 */
export function parkReadOnlyError(activity: Activity | null): ForbiddenException {
  const app =
    activity === 'RESTAURANT'
      ? 'Ocall Restaurant'
      : activity === 'PARK'
        ? 'Ocall Parc'
        : 'Ocall Park';
  return new ForbiddenException({
    code: 'PARK_READ_ONLY',
    activity,
    message:
      `Votre essai ou votre abonnement ${app} est échu, suspendu ou absent : cette partie de l’application est en lecture seule. ` +
      'Vos données sont conservées ; demandez l’activation de votre abonnement depuis le portail Ocall Suite.',
  });
}
