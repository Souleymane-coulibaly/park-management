import { databaseIdentity } from '@ocall/database';
import { FACTURE_AI_PLATFORM_MONTHLY_CEILING } from '@ocall/shared';

/**
 * Configuration d'Ocall Facture : désactivé par défaut, jamais sur la base Ocall Suite ni sur la base
 * Ocall School. Sans `FACTURE_ENABLED=true`, l'application est invisible et ses routes introuvables.
 */
export interface FactureConfig {
  enabled: boolean;
  databaseUrl: string | null;
  /**
   * Fournisseur WhatsApp des notifications de rendez-vous (F4) : `disabled` par défaut (aucun envoi
   * WhatsApp, e-mail en secours) ; `simulated` pour les tests, interdit en production. Le fournisseur
   * réel sera branché derrière la même interface, une fois choisi.
   */
  whatsapp: 'disabled' | 'simulated';
  /**
   * Plafond plateforme Ocall des appels IA, par organisation, fonctionnalité et mois (F6A) : le gérant
   * règle ses plafonds en dessous.
   */
  aiMonthlyCeiling: number;
}

export function loadFactureConfig(env: NodeJS.ProcessEnv): FactureConfig {
  const enabled = env.FACTURE_ENABLED === 'true';
  const whatsapp = (env.FACTURE_WHATSAPP_PROVIDER ?? 'disabled').trim();
  if (whatsapp !== 'disabled' && whatsapp !== 'simulated') {
    throw new Error('FACTURE_WHATSAPP_PROVIDER invalide : disabled ou simulated.');
  }
  if (whatsapp === 'simulated' && env.NODE_ENV === 'production') {
    throw new Error('FACTURE_WHATSAPP_PROVIDER=simulated est interdit en production.');
  }
  const ceiling = Number(env.FACTURE_AI_MAX_MONTHLY_CALLS ?? FACTURE_AI_PLATFORM_MONTHLY_CEILING);
  if (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > 100_000) {
    throw new Error('FACTURE_AI_MAX_MONTHLY_CALLS invalide : entier de 0 à 100 000.');
  }
  const aiMonthlyCeiling = ceiling;
  if (!enabled) return { enabled, databaseUrl: null, whatsapp, aiMonthlyCeiling };
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
  return { enabled, databaseUrl, whatsapp, aiMonthlyCeiling };
}
