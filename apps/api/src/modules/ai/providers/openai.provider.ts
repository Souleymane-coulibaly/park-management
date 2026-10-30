import OpenAI, { toFile } from 'openai';
import type {
  Response,
  ResponseInputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import {
  type AiProvider,
  AiProviderError,
  type AiResult,
  type AiToolCall,
  type AiToolDefinition,
  type AiUsageReport,
  type JsonSchema,
} from './ai-provider';

/**
 * Fournisseur OpenAI : API Responses pour le modèle de langage (GPT-5 par défaut), API de
 * transcription audio pour la voix.
 *
 * - `store: false` : les réponses ne sont pas conservées côté OpenAI pour être réutilisées ;
 *   l'état du dialogue avec fonctions est donc renvoyé à chaque tour (éléments de raisonnement
 *   chiffrés compris).
 * - Sorties en JSON strict (`json_schema`, `strict: true`) et fonctions strictes.
 * - Une seule nouvelle tentative du SDK, délai maximal configuré : en cas d'indisponibilité,
 *   l'utilisateur est prévenu et continue sans IA.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string, timeoutMs: number) {
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async extractFromDocument<T>(request: {
    model: string;
    instructions: string;
    prompt: string;
    document: { mimeType: string; data: Buffer; fileName: string };
    schemaName: string;
    schema: JsonSchema;
  }): Promise<AiResult<T>> {
    const base64 = request.document.data.toString('base64');
    const dataUrl = `data:${request.document.mimeType};base64,${base64}`;
    const file =
      request.document.mimeType === 'application/pdf'
        ? ({ type: 'input_file', filename: request.document.fileName, file_data: dataUrl } as const)
        : ({ type: 'input_image', image_url: dataUrl, detail: 'high' } as const);
    const response = await this.call(() =>
      this.client.responses.create({
        model: request.model,
        instructions: request.instructions,
        store: false,
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.prompt }, file] }],
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: request.schema,
            strict: true,
          },
        },
      }),
    );
    return { value: parseJson<T>(response), usage: usageOf(response.usage) };
  }

  async structureText<T>(request: {
    model: string;
    instructions: string;
    text: string;
    schemaName: string;
    schema: JsonSchema;
  }): Promise<AiResult<T>> {
    const response = await this.call(() =>
      this.client.responses.create({
        model: request.model,
        instructions: request.instructions,
        store: false,
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.text }] }],
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: request.schema,
            strict: true,
          },
        },
      }),
    );
    return { value: parseJson<T>(response), usage: usageOf(response.usage) };
  }

  async runWithTools(request: {
    model: string;
    instructions: string;
    question: string;
    tools: AiToolDefinition[];
    execute: (call: AiToolCall) => Promise<unknown>;
    maxRounds: number;
  }): Promise<AiResult<{ answer: string }>> {
    const total: AiUsageReport = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    const input: ResponseInputItem[] = [
      { role: 'user', content: [{ type: 'input_text', text: request.question }] },
    ];
    for (let round = 0; round <= request.maxRounds; round++) {
      const response = await this.call(() =>
        this.client.responses.create({
          model: request.model,
          instructions: request.instructions,
          store: false,
          include: ['reasoning.encrypted_content'],
          parallel_tool_calls: true,
          // Au dernier tour, plus de fonction : le modèle doit répondre avec ce qu'il a.
          tool_choice: round === request.maxRounds ? 'none' : 'auto',
          tools: request.tools.map((t) => ({
            type: 'function' as const,
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            strict: true,
          })),
          input,
        }),
      );
      addUsage(total, usageOf(response.usage));
      assertNotRefused(response);
      const calls = response.output.filter((item) => item.type === 'function_call');
      if (calls.length === 0) return { value: { answer: response.output_text }, usage: total };
      // Sans stockage côté OpenAI : on renvoie les éléments produits (raisonnement, appels) puis
      // les résultats des fonctions, calculés et autorisés par le serveur.
      input.push(...(response.output as ResponseInputItem[]));
      for (const call of calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = null;
        }
        const output = await request.execute({ name: call.name, arguments: args });
        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
      }
    }
    throw new AiProviderError('AI_INVALID_OUTPUT', 'Le copilote n’a pas pu conclure sa réponse.');
  }

  async transcribe(request: {
    model: string;
    audio: Buffer;
    mimeType: string;
    language: string;
    keywords: string[];
  }): Promise<AiResult<{ text: string }>> {
    const extension =
      request.mimeType.split('/')[1] === 'mpeg' ? 'mp3' : request.mimeType.split('/')[1];
    const file = await toFile(request.audio, `commande.${extension}`, { type: request.mimeType });
    const result = await this.call(() =>
      this.client.audio.transcriptions.create({
        file,
        model: request.model,
        language: request.language,
        // Les mots-clés (noms de plats) ne sont pris en charge que par gpt-transcribe.
        ...(request.model === 'gpt-transcribe' && request.keywords.length
          ? { keywords: request.keywords.slice(0, 100) }
          : {}),
      }),
    );
    const usage: AiUsageReport = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    if (result.usage?.type === 'tokens') {
      usage.inputTokens = result.usage.input_tokens;
      usage.outputTokens = result.usage.output_tokens;
    } else if (result.usage?.type === 'duration') {
      usage.audioSeconds = Math.ceil(result.usage.seconds);
    }
    return { value: { text: result.text }, usage };
  }

  /** Traduit les erreurs du SDK : aucun détail technique (ni clé) n'est renvoyé au client. */
  private async call<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new AiProviderError(
          'AI_TIMEOUT',
          'Le service IA ne répond pas. Réessayez plus tard.',
        );
      }
      if (error instanceof OpenAI.RateLimitError) {
        throw new AiProviderError(
          'AI_RATE_LIMITED',
          'Le service IA est saturé. Réessayez dans quelques minutes.',
        );
      }
      throw new AiProviderError('AI_UNAVAILABLE', 'Le service IA est momentanément indisponible.');
    }
  }
}

function usageOf(usage: ResponseUsage | undefined): AiUsageReport {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

function addUsage(total: AiUsageReport, usage: AiUsageReport) {
  total.inputTokens += usage.inputTokens;
  total.cachedInputTokens += usage.cachedInputTokens;
  total.outputTokens += usage.outputTokens;
}

function assertNotRefused(response: Response) {
  const refused = response.output.some(
    (item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'),
  );
  if (refused)
    throw new AiProviderError('AI_REFUSED', 'Le service IA a refusé de traiter la demande.');
}

function parseJson<T>(response: Response): T {
  assertNotRefused(response);
  if (response.status === 'incomplete') {
    throw new AiProviderError('AI_INVALID_OUTPUT', 'Réponse IA incomplète. Réessayez.');
  }
  try {
    return JSON.parse(response.output_text) as T;
  } catch {
    throw new AiProviderError('AI_INVALID_OUTPUT', 'Réponse IA illisible. Réessayez.');
  }
}
