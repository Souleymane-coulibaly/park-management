import { databaseIdentity } from '@ocall/database';

/**
 * Configuration Ocall Stock. Application à base séparée, comme Ocall School et Ocall Facture : sans
 * `STOCK_ENABLED=true`, l'application est invisible et ses routes introuvables ; la base n'est jamais
 * contactée.
 */
export interface StockConfig {
  enabled: boolean;
  databaseUrl: string | null;
}

export function loadStockConfig(env: NodeJS.ProcessEnv): StockConfig {
  const enabled = env.STOCK_ENABLED === 'true';
  if (!enabled) return { enabled, databaseUrl: null };
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
  return { enabled, databaseUrl };
}
