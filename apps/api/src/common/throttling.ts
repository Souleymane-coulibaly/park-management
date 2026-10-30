import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/app-config';

const SENSITIVE_ROUTE = 'sensitiveRoute';
const PUBLIC_ORDER_ROUTE = 'publicOrderRoute';

/** Marque une route sensible (connexion, inscription, mot de passe) : limite stricte par IP. */
export const SensitiveRoute = () => SetMetadata(SENSITIVE_ROUTE, true);

/** Marque l'envoi d'une demande de commande publique (QR code) : limite dédiée par IP. */
export const PublicOrderRoute = () => SetMetadata(PUBLIC_ORDER_ROUTE, true);

function hasFlag(context: ExecutionContext, flag: string): boolean {
  return Reflect.getMetadata(flag, context.getHandler()) === true;
}

/**
 * Trois limites par IP : une limite large sur toute l'API, une limite stricte appliquée uniquement
 * aux routes @SensitiveRoute(), et une limite dédiée aux demandes de commande publiques
 * @PublicOrderRoute() (les clients d'un restaurant partagent souvent le même Wi-Fi : limite plus
 * large, complétée par un plafond de demandes en attente par table). Complète le verrouillage de
 * compte après échecs répétés (voir AuthService).
 */
export function throttlerOptions(config: AppConfig): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: 'global', ttl: 60_000, limit: 600 },
      {
        name: 'sensitive',
        ttl: config.loginThrottleTtlSeconds * 1000,
        limit: config.loginThrottleLimit,
        skipIf: (context) => !hasFlag(context, SENSITIVE_ROUTE),
      },
      {
        name: 'publicOrder',
        ttl: 10 * 60_000,
        limit: config.publicOrderThrottleLimit,
        skipIf: (context) => !hasFlag(context, PUBLIC_ORDER_ROUTE),
      },
    ],
    errorMessage: 'Trop de requêtes. Réessayez dans quelques instants.',
  };
}
