import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/app-config';

const SENSITIVE_ROUTE = 'sensitiveRoute';

/** Marque une route sensible (connexion, inscription, mot de passe) : limite stricte par IP. */
export const SensitiveRoute = () => SetMetadata(SENSITIVE_ROUTE, true);

function isSensitive(context: ExecutionContext): boolean {
  return Reflect.getMetadata(SENSITIVE_ROUTE, context.getHandler()) === true;
}

/**
 * Deux limites par IP : une limite large sur toute l'API, et une limite stricte
 * appliquée uniquement aux routes @SensitiveRoute(). Complète le verrouillage
 * de compte après échecs répétés (voir AuthService).
 */
export function throttlerOptions(config: AppConfig): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: 'global', ttl: 60_000, limit: 600 },
      {
        name: 'sensitive',
        ttl: config.loginThrottleTtlSeconds * 1000,
        limit: config.loginThrottleLimit,
        skipIf: (context) => !isSensitive(context),
      },
    ],
    errorMessage: 'Trop de requêtes. Réessayez dans quelques instants.',
  };
}
