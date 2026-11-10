import { databaseIdentity } from '@ocall/database';

/**
 * Configuration d'Ocall Facture : désactivé par défaut, jamais sur la base Ocall Suite ni sur la base
 * Ocall School. Sans `FACTURE_ENABLED=true`, l'application est invisible et ses routes introuvables.
 */
export interface FactureConfig {
  enabled: boolean;
  databaseUrl: string | null;
}

export function loadFactureConfig(env: NodeJS.ProcessEnv): FactureConfig {
  const enabled = env.FACTURE_ENABLED === 'true';
  if (!enabled) return { enabled, databaseUrl: null };
  const databaseUrl = env.FACTURE_DATABASE_URL?.trim() || null;
  if (!databaseUrl) throw new Error('FACTURE_ENABLED=true exige FACTURE_DATABASE_URL.');
  const facture = databaseIdentity(databaseUrl);
  const others = [env.DATABASE_URL, env.DIRECT_URL, env.SCHOOL_DATABASE_URL]
    .filter((u): u is string => Boolean(u?.trim()))
    .map(databaseIdentity);
  if (others.includes(facture)) {
    throw new Error(
      'FACTURE_DATABASE_URL doit désigner une base distincte des bases Ocall Suite et Ocall School.',
    );
  }
  return { enabled, databaseUrl };
}
