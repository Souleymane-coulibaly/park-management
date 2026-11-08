/**
 * Configuration d'Ocall AI Core, lue une seule fois depuis l'environnement, commune à toutes les
 * applications métier (Park, School et les suivantes).
 *
 * - `none` (défaut) : aucune fonctionnalité IA ; les applications fonctionnent normalement sans elle.
 * - `simulated` : fournisseur déterministe, sans réseau ni coût, pour le développement et les tests.
 *   Refusé en production.
 * - `openai` : appels réels, facturés. Exige la clé ET `AI_REAL_CALLS_ENABLED=true`, pour qu'aucun
 *   appel payant ne parte par simple oubli d'une variable.
 *
 * La clé n'est lue que côté serveur et n'est jamais renvoyée au navigateur ni journalisée.
 *
 * Modèles : `OPENAI_MODEL` par défaut, surchargé par fonctionnalité avec `OPENAI_MODEL_<FONCTIONNALITÉ>`
 * (ex. `OPENAI_MODEL_COPILOT`, `OPENAI_MODEL_SCHOOL_TEACHING`) ; une nouvelle fonctionnalité n'exige
 * aucune modification de ce fichier.
 */
export interface AiConfig {
  provider: 'none' | 'simulated' | 'openai';
  openaiApiKey: string | null;
  /** Modèle par défaut des fonctionnalités sans réglage propre. */
  defaultModel: string;
  /** Modèles réglés explicitement, par fonctionnalité (hors transcription). */
  models: Record<string, string>;
  transcribeModel: string;
  timeoutMs: number;
  /** Taux indicatif USD → FCFA pour l'affichage des coûts estimés. */
  usdXofRate: number;
  /** Limitation de débit IA, par minute : par utilisateur et par organisation d'une application. */
  rateLimit: { perUserPerMinute: number; perOrganizationPerMinute: number };
  /** Au-delà de ce délai, une réservation restée « en cours » (processus interrompu) est libérée. */
  orphanAfterMs: number;
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

/**
 * Alias historiques d'Ocall Park : l'import de tarifs utilise le modèle de l'import de carte
 * (contrat de configuration du Sprint 8 conservé).
 */
const MODEL_ALIASES: Record<string, string> = { TICKET_IMPORT: 'CATALOG_IMPORT' };

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
  const models: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^OPENAI_MODEL_([A-Z][A-Z0-9_]*)$/.exec(key);
    if (match && match[1] !== 'TRANSCRIBE' && value?.trim()) models[match[1]!] = value.trim();
  }
  const timeoutMs = positiveInt(env, 'AI_TIMEOUT_MS', 60_000);
  return {
    provider,
    openaiApiKey,
    defaultModel,
    models,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe',
    timeoutMs,
    usdXofRate: positiveInt(env, 'AI_USD_XOF_RATE', 600),
    rateLimit: {
      perUserPerMinute: positiveInt(env, 'AI_RATE_LIMIT_USER_PER_MINUTE', 60),
      perOrganizationPerMinute: positiveInt(env, 'AI_RATE_LIMIT_ORG_PER_MINUTE', 300),
    },
    // Par défaut : quatre fois le délai d'appel (le copilote fait jusqu'à quatre tours), plus une minute.
    orphanAfterMs: positiveInt(env, 'AI_ORPHAN_AFTER_MS', timeoutMs * 4 + 60_000),
  };
}

/** Modèle d'une fonctionnalité : réglage propre, alias historique, sinon modèle par défaut. */
export function modelFor(config: AiConfig, feature: string): string {
  return (
    config.models[feature] ?? config.models[MODEL_ALIASES[feature] ?? ''] ?? config.defaultModel
  );
}
