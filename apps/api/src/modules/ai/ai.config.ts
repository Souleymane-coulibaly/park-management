import type { AiFeature } from '@ocall/shared';

/**
 * Configuration IA, lue une seule fois depuis l'environnement.
 *
 * - `none` (défaut) : aucune fonctionnalité IA ; l'application fonctionne normalement sans elle.
 * - `simulated` : fournisseur déterministe, sans réseau ni coût, pour le développement et les tests.
 *   Refusé en production.
 * - `openai` : appels réels, facturés. Exige la clé ET `AI_REAL_CALLS_ENABLED=true`, pour qu'aucun
 *   appel payant ne parte par simple oubli d'une variable.
 *
 * La clé n'est lue que côté serveur et n'est jamais renvoyée au navigateur ni journalisée.
 */
export interface AiConfig {
  provider: 'none' | 'simulated' | 'openai';
  openaiApiKey: string | null;
  /** Modèle de langage par fonctionnalité (hors transcription). */
  models: Record<AiFeature, string>;
  transcribeModel: string;
  timeoutMs: number;
  /** Taux indicatif USD → FCFA pour l'affichage des coûts estimés. */
  usdXofRate: number;
}

const positiveInt = (env: NodeJS.ProcessEnv, key: string, fallback: number) => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variable d'environnement ${key} invalide : entier positif attendu.`);
  }
  return value;
};

export function loadAiConfig(env: NodeJS.ProcessEnv, nodeEnv: string): AiConfig {
  const provider = env.AI_PROVIDER?.trim() || 'none';
  if (provider !== 'none' && provider !== 'simulated' && provider !== 'openai') {
    throw new Error('AI_PROVIDER invalide : none, simulated ou openai.');
  }
  if (provider === 'simulated' && nodeEnv === 'production') {
    throw new Error('AI_PROVIDER=simulated est interdit en production.');
  }
  const openaiApiKey = env.OPENAI_API_KEY?.trim() || null;
  if (provider === 'openai') {
    if (!openaiApiKey) throw new Error('AI_PROVIDER=openai exige OPENAI_API_KEY.');
    if (env.AI_REAL_CALLS_ENABLED !== 'true') {
      throw new Error(
        'AI_PROVIDER=openai exige AI_REAL_CALLS_ENABLED=true (appels réels facturés, à autoriser explicitement).',
      );
    }
  }
  const defaultModel = env.OPENAI_MODEL?.trim() || 'gpt-5';
  const model = (key: string) => env[key]?.trim() || defaultModel;
  return {
    provider,
    openaiApiKey,
    models: {
      CATALOG_IMPORT: model('OPENAI_MODEL_CATALOG_IMPORT'),
      TICKET_IMPORT: model('OPENAI_MODEL_CATALOG_IMPORT'),
      COPILOT: model('OPENAI_MODEL_COPILOT'),
      VOICE_ORDER: model('OPENAI_MODEL_VOICE_ORDER'),
    },
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe',
    timeoutMs: positiveInt(env, 'AI_TIMEOUT_MS', 60_000),
    usdXofRate: positiveInt(env, 'AI_USD_XOF_RATE', 600),
  };
}
