import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/app-config';

const SENSITIVE_ROUTE = 'sensitiveRoute';
const PUBLIC_ORDER_ROUTE = 'publicOrderRoute';
const ANALYTICS_ROUTE = 'analyticsRoute';
const EXPORT_ROUTE = 'exportRoute';

/** Marque une route sensible (connexion, inscription, mot de passe) : limite stricte par IP. */
export const SensitiveRoute = () => SetMetadata(SENSITIVE_ROUTE, true);

/** Marque l'envoi d'une demande de commande publique (QR code) : limite dédiée par IP. */
export const PublicOrderRoute = () => SetMetadata(PUBLIC_ORDER_ROUTE, true);

/** Marque une analyse (agrégations coûteuses) : limite dédiée par IP, en plus des délais SQL. */
export const AnalyticsRoute = () => SetMetadata(ANALYTICS_ROUTE, true);

/** Marque un export de données : limite stricte par IP. */
export const ExportRoute = () => SetMetadata(EXPORT_ROUTE, true);

function hasFlag(context: ExecutionContext, flag: string): boolean {
  return Reflect.getMetadata(flag, context.getHandler()) === true;
}

/**
 * Limites par IP : une limite large sur toute l'API, une limite stricte appliquée uniquement
 * aux routes @SensitiveRoute(), et une limite dédiée aux demandes de commande publiques
 * @PublicOrderRoute() (les clients d'un restaurant partagent souvent le même Wi-Fi : limite plus
 * large, complétée par un plafond de demandes en attente par table), une limite pour les analyses
 * @AnalyticsRoute() et une pour les exports @ExportRoute(). Complète le verrouillage de
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
      {
        name: 'analytics',
        ttl: 60_000,
        limit: 120,
        skipIf: (context) => !hasFlag(context, ANALYTICS_ROUTE),
      },
      {
        name: 'export',
        ttl: 10 * 60_000,
        limit: 30,
        skipIf: (context) => !hasFlag(context, EXPORT_ROUTE),
      },
    ],
    errorMessage: 'Trop de requêtes. Réessayez dans quelques instants.',
  };
}
