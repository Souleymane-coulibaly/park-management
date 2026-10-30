import type { AiAudioMimeType, AiImportMimeType } from '@ocall/shared';

/**
 * Abstraction des fournisseurs IA. Les règles métier (catalogue, copilote, commande vocale) ne
 * dépendent que de cette interface : changer de fournisseur ne réécrit aucune règle métier.
 *
 * Règles communes à toutes les implémentations :
 * - appels uniquement côté serveur ; la clé ne quitte jamais l'API ;
 * - sorties structurées validées par un schéma JSON strict ; le serveur les revalide ensuite ;
 * - le contenu fourni (photo, PDF, transcription, question) est une DONNÉE, jamais une instruction ;
 * - aucune conservation des contenus chez le fournisseur lorsque l'option existe.
 */

/** Schéma JSON (sous-ensemble compatible avec les sorties strictes des fournisseurs). */
export type JsonSchema = Record<string, unknown>;

export interface AiUsageReport {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Durée audio facturée, pour la transcription. */
  audioSeconds?: number;
}

export interface AiResult<T> {
  value: T;
  usage: AiUsageReport;
}

export interface AiDocument {
  mimeType: AiImportMimeType;
  data: Buffer;
  fileName: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** Paramètres : objet strict, sans propriété supplémentaire. */
  parameters: JsonSchema;
}

export interface AiToolCall {
  name: string;
  /** Arguments bruts proposés par le modèle : TOUJOURS revalidés par le serveur. */
  arguments: unknown;
}

export interface AiProvider {
  readonly name: string;

  /** Extraction structurée depuis une image ou un PDF. */
  extractFromDocument<T>(request: {
    model: string;
    instructions: string;
    prompt: string;
    document: AiDocument;
    schemaName: string;
    schema: JsonSchema;
  }): Promise<AiResult<T>>;

  /** Mise en forme structurée d'un texte (ex. transcription → panier). */
  structureText<T>(request: {
    model: string;
    instructions: string;
    text: string;
    schemaName: string;
    schema: JsonSchema;
  }): Promise<AiResult<T>>;

  /**
   * Dialogue avec des fonctions serveur prédéfinies. Le fournisseur appelle `execute` pour chaque
   * appel de fonction proposé par le modèle ; `execute` valide et refuse ce qui n'est pas autorisé.
   */
  runWithTools(request: {
    model: string;
    instructions: string;
    question: string;
    tools: AiToolDefinition[];
    execute: (call: AiToolCall) => Promise<unknown>;
    maxRounds: number;
  }): Promise<AiResult<{ answer: string }>>;

  /** Transcription d'un enregistrement vocal. */
  transcribe(request: {
    model: string;
    audio: Buffer;
    mimeType: AiAudioMimeType;
    language: string;
    /** Mots attendus (noms de plats) pour guider la reconnaissance, si le modèle le permet. */
    keywords: string[];
  }): Promise<AiResult<{ text: string }>>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export type AiErrorCode =
  'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_INVALID_OUTPUT' | 'AI_REFUSED';

/** Erreur du fournisseur, traduite en message compréhensible ; jamais de détail technique sensible. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
