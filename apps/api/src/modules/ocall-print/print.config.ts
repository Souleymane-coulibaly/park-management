import { databaseIdentity } from '@ocall/database';

/**
 * Configuration Ocall Print. Application à base séparée, comme Ocall School, Facture et Stock : sans
 * `PRINT_ENABLED=true`, l'application est invisible, ses routes introuvables, et les fonctions de carte
 * des autres applications répondent « indisponible » ; la base n'est jamais contactée.
 */
export interface PrintConfig {
  enabled: boolean;
  databaseUrl: string | null;
}

export function loadPrintConfig(env: NodeJS.ProcessEnv): PrintConfig {
  const enabled = env.PRINT_ENABLED === 'true';
  if (!enabled) return { enabled, databaseUrl: null };
  const databaseUrl = env.PRINT_DATABASE_URL?.trim() || null;
  if (!databaseUrl) throw new Error('PRINT_ENABLED=true exige PRINT_DATABASE_URL.');
  const print = databaseIdentity(databaseUrl);
  const others = [
    env.DATABASE_URL,
    env.DIRECT_URL,
    env.SCHOOL_DATABASE_URL,
    env.FACTURE_DATABASE_URL,
    env.STOCK_DATABASE_URL,
  ]
    .filter((u): u is string => Boolean(u?.trim()))
    .map(databaseIdentity);
  if (others.includes(print)) {
    throw new Error(
      'PRINT_DATABASE_URL doit désigner une base distincte des bases Ocall Suite, School, Facture et Stock.',
    );
  }
  return { enabled, databaseUrl };
}
