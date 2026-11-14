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
  /**
   * Plafonds mensuels Ocall de l'IA (S8), par organisation et par fonctionnalité : le gérant règle les siens
   * en dessous. Illustrations à part (une image coûte plus qu'un texte).
   */
  ai: { monthlyCeiling: number; imageMonthlyCeiling: number };
}

const ceiling = (env: NodeJS.ProcessEnv, key: string, fallback: number) => {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`${key} invalide : entier de 0 à 100 000.`);
  }
  return value;
};

export function loadStockConfig(env: NodeJS.ProcessEnv): StockConfig {
  const enabled = env.STOCK_ENABLED === 'true';
  const baseDomain = env.STOCK_SITES_BASE_DOMAIN?.trim().toLowerCase() || null;
  const sites = {
    baseDomain,
    subdomainsEnabled: env.STOCK_SITES_SUBDOMAINS_ENABLED === 'true' && baseDomain !== null,
  };
  const ai = {
    monthlyCeiling: ceiling(env, 'STOCK_AI_MAX_MONTHLY_CALLS', 150),
    imageMonthlyCeiling: ceiling(env, 'STOCK_AI_MAX_MONTHLY_IMAGES', 20),
  };
  if (!enabled) return { enabled, databaseUrl: null, sites, ai };
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
  return { enabled, databaseUrl, sites, ai };
}
