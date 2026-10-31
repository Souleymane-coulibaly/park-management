/**
 * Paiement en ligne des factures SaaS (Sprint 12A).
 *
 * - `none` (défaut) : paiement en ligne indisponible, seuls les règlements manuels existent.
 * - `simulated` : prestataire simulé, pour les tests et la démonstration ; interdit en production.
 * - `cinetpay` : réservé à l'adaptateur réel, pas encore livré (l'API du compte marchand reste à
 *   confirmer : Checkout V2 ou nouvelle API). Le démarrage est refusé tant qu'il n'existe pas.
 *
 * Les secrets du prestataire ne sont jamais exposés au navigateur.
 */
export interface OnlinePaymentsConfig {
  provider: 'none' | 'simulated' | 'cinetpay';
  /** Adresse publique de l'API, pour l'URL de notification (webhook) transmise au prestataire. */
  publicApiUrl: string;
  /** Adresse de l'application web, pour le retour du client après paiement. */
  webAppUrl: string;
  /** Délai après lequel un paiement non abouti peut être relancé (nouvelle référence). */
  pendingTtlMinutes: number;
}

export function loadOnlinePaymentsConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
): OnlinePaymentsConfig {
  const raw = (env.ONLINE_PAYMENT_PROVIDER ?? 'none').trim().toLowerCase();
  if (raw !== 'none' && raw !== 'simulated' && raw !== 'cinetpay') {
    throw new Error('ONLINE_PAYMENT_PROVIDER invalide : none, simulated ou cinetpay.');
  }
  if (raw === 'simulated' && nodeEnv === 'production') {
    throw new Error('Le prestataire de paiement simulé est interdit en production.');
  }
  if (raw === 'cinetpay') {
    throw new Error(
      'ONLINE_PAYMENT_PROVIDER=cinetpay : adaptateur réel non livré (API du compte marchand à confirmer).',
    );
  }
  const webAppUrl = (env.WEB_APP_URL ?? env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
  const publicApiUrl = (env.API_PUBLIC_URL ?? 'http://localhost:4000').trim().replace(/\/+$/, '');
  if (raw !== 'none' && nodeEnv === 'production' && !publicApiUrl.startsWith('https://')) {
    throw new Error('API_PUBLIC_URL doit être en https en production (notifications de paiement).');
  }
  const ttl = Number(env.ONLINE_PAYMENT_PENDING_TTL_MINUTES ?? 30);
  if (!Number.isInteger(ttl) || ttl < 5 || ttl > 24 * 60) {
    throw new Error('ONLINE_PAYMENT_PENDING_TTL_MINUTES invalide : entier entre 5 et 1440.');
  }
  return { provider: raw, publicApiUrl, webAppUrl, pendingTtlMinutes: ttl };
}
