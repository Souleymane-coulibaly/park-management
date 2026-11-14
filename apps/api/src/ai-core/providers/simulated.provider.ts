import {
  type AiProvider,
  AiProviderError,
  attachAiUsage,
  type AiResult,
  type AiToolCall,
  type AiToolDefinition,
  type AiUsageReport,
  type JsonSchema,
} from '../ai-provider';

/**
 * Fournisseur SIMULÉ d'Ocall AI Core : déterministe, sans réseau ni coût, pour le développement et les
 * tests automatisés de toutes les applications. Il ne prétend à aucune qualité : il sert à éprouver les
 * règles du serveur (validation, isolation, quotas, confirmation humaine).
 *
 * Conventions communes :
 * - un contenu (fichier, audio, question, texte) contenant `OCALL-SIM:` suivi d'un JSON (terminé par
 *   `:FIN` ou la fin du texte) fait renvoyer exactement ce JSON : réponse valide, incertaine, invalide
 *   ou malveillante du modèle ;
 * - `OCALL-SIM-DOWN` simule une panne du fournisseur ;
 * - sans marqueur : les scénarios inscrits par les applications (`registerAiSimulation`) répondent ;
 *   sinon, document illisible, transcription vide ou réponse illisible.
 */
export const SIM_MARKER = 'OCALL-SIM:';
export const SIM_DOWN = 'OCALL-SIM-DOWN';

/**
 * Retire les consignes de simulation (`OCALL-SIM:…:FIN`) d'un texte : la réponse imposée par une
 * consigne ne doit pas compter parmi les données autorisées d'un contrôle des chiffres.
 */
export function stripSimulationDirectives(text: string): string {
  return text.replace(/OCALL-SIM:[\s\S]*?(?::FIN|$)/g, ' ');
}

export const SIMULATED_USAGE: AiUsageReport = {
  inputTokens: 1000,
  cachedInputTokens: 0,
  outputTokens: 200,
};

/** Scénario de simulation d'une application : undefined = « ce n'est pas pour moi ». */
export interface AiSimulation {
  structureText?(request: { instructions: string; text: string; schemaName: string }): unknown;
  /** Lecture d'un document (photo, PDF) sans consigne `OCALL-SIM:` (ex. image réencodée). */
  extractFromDocument?(request: { prompt: string; schemaName: string }): unknown;
  runWithTools?(request: {
    instructions: string;
    question: string;
    tools: AiToolDefinition[];
  }): { calls: AiToolCall[]; answer: string } | undefined;
}

const simulations: AiSimulation[] = [];

/** Inscrit le scénario de simulation d'une application (idempotent). */
export function registerAiSimulation(simulation: AiSimulation) {
  if (!simulations.includes(simulation)) simulations.push(simulation);
}

function marker(content: string): unknown {
  if (content.includes(SIM_DOWN)) {
    throw new AiProviderError('AI_UNAVAILABLE', 'Le service IA est momentanément indisponible.');
  }
  const at = content.indexOf(SIM_MARKER);
  if (at < 0) return undefined;
  const raw = content.slice(at + SIM_MARKER.length);
  const end = raw.indexOf(':FIN');
  try {
    return JSON.parse(end >= 0 ? raw.slice(0, end) : raw);
  } catch {
    throw new AiProviderError('AI_INVALID_OUTPUT', 'Réponse IA illisible. Réessayez.');
  }
}

export class SimulatedAiProvider implements AiProvider {
  readonly name = 'simulated';

  /**
   * Illustration simulée : image unie (couleur tirée de la description), aucune qualité prétendue.
   * `OCALL-SIM-DOWN` dans la description simule une panne.
   */
  async generateImage(request: {
    prompt: string;
  }): Promise<AiResult<{ image: Buffer; mimeType: 'image/png' }>> {
    if (request.prompt.includes(SIM_DOWN)) {
      throw new AiProviderError('AI_UNAVAILABLE', 'Le service IA est momentanément indisponible.');
    }
    let hash = 0;
    for (const c of request.prompt) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    const { default: sharp } = await import('sharp');
    const image = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: hash & 0xff, g: (hash >> 8) & 0xff, b: (hash >> 16) & 0xff },
      },
    })
      .png()
      .toBuffer();
    return { value: { image, mimeType: 'image/png' }, usage: SIMULATED_USAGE };
  }

  async extractFromDocument<T>(request: {
    prompt: string;
    document: { data: Buffer };
    schemaName: string;
    schema: JsonSchema;
  }): Promise<AiResult<T>> {
    const value = marker(request.document.data.toString('latin1')) ?? marker(request.prompt);
    if (value !== undefined) return { value: value as T, usage: SIMULATED_USAGE };
    for (const s of simulations) {
      const simulated = s.extractFromDocument?.(request);
      if (simulated !== undefined) return { value: simulated as T, usage: SIMULATED_USAGE };
    }
    return { value: { readable: false, items: [] } as T, usage: SIMULATED_USAGE };
  }

  async structureText<T>(request: {
    instructions: string;
    text: string;
    schemaName: string;
  }): Promise<AiResult<T>> {
    const value = marker(request.text);
    if (value !== undefined) return { value: value as T, usage: SIMULATED_USAGE };
    for (const s of simulations) {
      const simulated = s.structureText?.(request);
      if (simulated !== undefined) return { value: simulated as T, usage: SIMULATED_USAGE };
    }
    throw new AiProviderError('AI_INVALID_OUTPUT', 'Réponse IA illisible. Réessayez.');
  }

  async runWithTools(request: {
    instructions: string;
    question: string;
    tools: AiToolDefinition[];
    execute: (call: AiToolCall) => Promise<unknown>;
  }): Promise<AiResult<{ answer: string }>> {
    const scripted = marker(request.question) as
      { calls?: AiToolCall[]; answer?: string } | undefined;
    const plan =
      scripted !== undefined
        ? { calls: scripted.calls ?? [], answer: scripted.answer ?? '' }
        : simulations.map((s) => s.runWithTools?.(request)).find((p) => p !== undefined);
    if (!plan) {
      return { value: { answer: 'Pouvez-vous préciser votre question ?' }, usage: SIMULATED_USAGE };
    }
    try {
      for (const call of plan.calls) await request.execute(call);
    } catch (error) {
      // Comme le fournisseur réel : l'appel simulé a « consommé » avant l'erreur de l'outil.
      attachAiUsage(error, SIMULATED_USAGE);
      throw error;
    }
    return { value: { answer: plan.answer }, usage: SIMULATED_USAGE };
  }

  async transcribe(request: { audio: Buffer }): Promise<AiResult<{ text: string }>> {
    const content = request.audio.toString('latin1');
    if (content.includes(SIM_DOWN)) {
      throw new AiProviderError('AI_UNAVAILABLE', 'Le service IA est momentanément indisponible.');
    }
    const at = content.indexOf(SIM_MARKER);
    const text =
      at < 0
        ? ''
        : content
            .slice(at + SIM_MARKER.length)
            .split(':FIN')[0]!
            .trim();
    return {
      value: { text },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, audioSeconds: 5 },
    };
  }
}
