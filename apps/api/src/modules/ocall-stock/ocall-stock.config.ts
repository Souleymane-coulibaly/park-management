import { databaseIdentity } from '@ocall/database';

/**
 * Configuration Ocall Stock. Application à base séparée, comme Ocall School et Ocall Facture : sans
 * `STOCK_ENABLED=true`, l'application est invisible et ses routes introuvables ; la base n'est jamais
 * contactée.
 */
export interface StockConfig {
  enabled: boolean;
  databaseUrl: string | null;
  /** Vitrines (S7) : sous-domaines `<slug>.<domaine>` si activés, sinon adresses `/m/<slug>`. */
  sites: { baseDomain: string | null; subdomainsEnabled: boolean };
}

export function loadStockConfig(env: NodeJS.ProcessEnv): StockConfig {
  const enabled = env.STOCK_ENABLED === 'true';
  const baseDomain = env.STOCK_SITES_BASE_DOMAIN?.trim().toLowerCase() || null;
  const sites = {
    baseDomain,
    subdomainsEnabled: env.STOCK_SITES_SUBDOMAINS_ENABLED === 'true' && baseDomain !== null,
  };
  if (!enabled) return { enabled, databaseUrl: null, sites };
  const databaseUrl = env.STOCK_DATABASE_URL?.trim() || null;
  if (!databaseUrl) throw new Error('STOCK_ENABLED=true exige STOCK_DATABASE_URL.');
  const stock = databaseIdentity(databaseUrl);
  const others = [
    env.DATABASE_URL,
    env.DIRECT_URL,
    env.SCHOOL_DATABASE_URL,
    env.FACTURE_DATABASE_URL,
  ]
    .filter((u): u is string => Boolean(u?.trim()))
    .map(databaseIdentity);
  if (others.includes(stock)) {
    throw new Error(
      'STOCK_DATABASE_URL doit désigner une base distincte des bases Ocall Suite, School et Facture.',
    );
  }
  return { enabled, databaseUrl, sites };
}
