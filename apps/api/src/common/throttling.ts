import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/app-config';

const SENSITIVE_ROUTE = 'sensitiveRoute';
const PUBLIC_ORDER_ROUTE = 'publicOrderRoute';
const ANALYTICS_ROUTE = 'analyticsRoute';
const EXPORT_ROUTE = 'exportRoute';
const PUBLIC_SITE_ROUTE = 'publicSiteRoute';
const PUBLIC_LEAD_ROUTE = 'publicLeadRoute';
const PAYMENT_NOTIFY_ROUTE = 'paymentNotifyRoute';

/** Marque une route sensible (connexion, inscription, mot de passe) : limite stricte par IP. */
export const SensitiveRoute = () => SetMetadata(SENSITIVE_ROUTE, true);

/** Marque l'envoi d'une demande de commande publique (QR code) : limite dédiée par IP. */
export const PublicOrderRoute = () => SetMetadata(PUBLIC_ORDER_ROUTE, true);

/** Marque une analyse (agrégations coûteuses) : limite dédiée par IP, en plus des délais SQL. */
export const AnalyticsRoute = () => SetMetadata(ANALYTICS_ROUTE, true);

/** Marque un export de données : limite stricte par IP. */
export const ExportRoute = () => SetMetadata(EXPORT_ROUTE, true);

/**
 * Marque l'API publique des sites vitrines : limite dédiée par IP. Les pages sont servies depuis
 * le cache du frontend : l'API n'est sollicitée qu'à la régénération et pour les images.
 */
export const PublicSiteRoute = () => SetMetadata(PUBLIC_SITE_ROUTE, true);

/** Marque un formulaire commercial public (demande de démonstration) : limite stricte par IP. */
export const PublicLeadRoute = () => SetMetadata(PUBLIC_LEAD_ROUTE, true);

/** Marque la réception des notifications d'un prestataire de paiement : limite dédiée. */
export const PaymentNotifyRoute = () => SetMetadata(PAYMENT_NOTIFY_ROUTE, true);

function hasFlag(context: ExecutionContext, flag: string): boolean {
  return (
    Reflect.getMetadata(flag, context.getHandler()) === true ||
    Reflect.getMetadata(flag, context.getClass()) === true
  );
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
      {
        name: 'publicSite',
        ttl: 60_000,
        limit: 1200,
        skipIf: (context) => !hasFlag(context, PUBLIC_SITE_ROUTE),
      },
      {
        name: 'publicLead',
        ttl: 10 * 60_000,
        limit: config.publicLeadThrottleLimit,
        skipIf: (context) => !hasFlag(context, PUBLIC_LEAD_ROUTE),
      },
      {
        name: 'paymentNotify',
        ttl: 60_000,
        limit: 300,
        skipIf: (context) => !hasFlag(context, PAYMENT_NOTIFY_ROUTE),
      },
    ],
    errorMessage: 'Trop de requêtes. Réessayez dans quelques instants.',
  };
}
