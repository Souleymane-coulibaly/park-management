import type { AiToolCall, AiToolDefinition, JsonSchema } from './ai-provider';

/**
 * Appel d'outils sécurisé d'Ocall AI Core. Le modèle ne fait que PROPOSER l'appel d'une fonction d'un
 * registre fermé, avec des arguments ; le serveur décide :
 * - fonction connue, permise au rôle et disponible dans le contexte (`allow`) ;
 * - arguments revalidés strictement (`parse` : toute clé inattendue refuse l'appel) ;
 * - nombre d'appels plafonné par question ;
 * - organisation, établissement et périmètre viennent TOUJOURS du contexte serveur, jamais du modèle.
 * Aucun SQL, aucune commande, aucune écriture : les outils sont des lectures de services validés.
 */
export interface AiTool<C, R> {
  name: string;
  description: string;
  /** Paramètres : objet strict, sans propriété supplémentaire. */
  parameters: JsonSchema;
  /** Validation stricte des arguments proposés par le modèle ; null = refusés. */
  parse(args: unknown): Record<string, unknown> | null;
  run(ctx: C, args: Record<string, unknown>): Promise<R>;
}

export type AiToolRejectionReason =
  'UNKNOWN_FUNCTION' | 'INVALID_ARGUMENTS' | 'NOT_ALLOWED' | 'NOT_AVAILABLE' | 'TOO_MANY_CALLS';

export interface AiToolRejection {
  name: string;
  reason: AiToolRejectionReason;
}

/** Accepte exactement les clés attendues : toute clé en plus (ex. un établissement) est refusée. */
export function exactKeys(args: unknown, keys: string[]): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  const given = Object.keys(record);
  if (given.length !== keys.length || !given.every((k) => keys.includes(k))) return null;
  return record;
}

export const strictObject = (properties: Record<string, unknown>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/**
 * Exécuteur d'une question : `execute` est passé au fournisseur ; `results` et `rejected` gardent la
 * trace de ce qui a été calculé ou refusé, pour l'affichage et le contrôle des chiffres.
 */
export function toolExecutor<C, T extends AiTool<C, R>, R>(options: {
  tools: readonly T[];
  maxCalls: number;
  /** Refus propre à l'application (permission, activité) ; null = autorisé. */
  allow: (tool: T) => 'NOT_ALLOWED' | 'NOT_AVAILABLE' | null;
  context: () => C;
  /** Ce que reçoit le modèle à partir du résultat (souvent un sous-ensemble). */
  present: (result: R) => unknown;
}) {
  const results: R[] = [];
  const rejected: AiToolRejection[] = [];
  let calls = 0;
  const execute = async (call: AiToolCall): Promise<unknown> => {
    const reject = (reason: AiToolRejectionReason) => {
      rejected.push({ name: String(call.name).slice(0, 60), reason });
      return {
        error: reason,
        message: 'Fonction refusée : lecture seule, établissement courant uniquement.',
      };
    };
    if (++calls > options.maxCalls) return reject('TOO_MANY_CALLS');
    const tool = options.tools.find((t) => t.name === call.name);
    if (!tool) return reject('UNKNOWN_FUNCTION');
    const refused = options.allow(tool);
    if (refused) return reject(refused);
    const args = tool.parse(call.arguments);
    if (!args) return reject('INVALID_ARGUMENTS');
    const result = await tool.run(options.context(), args);
    results.push(result);
    return options.present(result);
  };
  const definitions = (allowed: readonly T[]): AiToolDefinition[] =>
    allowed.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  return { execute, results, rejected, definitions };
}
