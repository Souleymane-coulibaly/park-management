import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ProductAccess } from '@ocall/shared';
import type { AuthContext, TenantContext } from './auth-context';

/**
 * Ocall Suite Sprint 2D : étapes communes des gardes des applications à base séparée (School, Facture,
 * Stock), dans le même ordre partout : application activée, adhésion à l'organisation (session déjà
 * contrôlée : adhésion active, non suspendue, organisation active), droit commercial, lecture seule, rôle
 * dans l'application (le propriétaire de l'organisation est responsable d'office), permission. Seules les
 * règles propres à chaque application (contrat School, sites Stock…) restent dans sa garde.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Lecture (GET, HEAD, OPTIONS) : seule opération permise en lecture seule. */
export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

/** Application désactivée par configuration : la route n'existe pas. */
export function assertAppEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
  }
}

/** Refus uniforme : aucune indication sur ce qui manque (rôle, membre, permission). */
export function appDenied(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: "Vous n'avez pas les droits nécessaires.",
  });
}

/** Contexte d'organisation de la requête ; refus pour un compte sans adhésion (interne, partenaire…). */
export function appTenant(auth: AuthContext | undefined): TenantContext {
  if (!auth?.membership) throw appDenied();
  return auth as TenantContext;
}

/** Abonnement ou essai : application non activée pour l'organisation. */
export function assertAppActivated(access: ProductAccess, appName: string): void {
  if (access === 'none') {
    throw new ForbiddenException({
      code: 'PRODUCT_NOT_ENABLED',
      message: `${appName} n’est pas activé pour votre organisation.`,
    });
  }
}

/** Essai échu, abonnement expiré ou suspendu : consultation uniquement, aucune donnée supprimée. */
export function assertSubscriptionWritable(
  access: ProductAccess,
  method: string,
  appName: string,
): void {
  if (access === 'read_only' && !isSafeMethod(method)) {
    throw new ForbiddenException({
      code: 'SUBSCRIPTION_READ_ONLY',
      message: `Votre abonnement ${appName} ne permet plus que la consultation.`,
    });
  }
}

/** Propriétaire de l'organisation : responsable d'office de chaque application, sans ligne membre. */
export function isOrganizationOwner(auth: TenantContext): boolean {
  return auth.membership.role === 'OWNER';
}
