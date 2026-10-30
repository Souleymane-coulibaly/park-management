import { normalizeLabel } from '@ocall/shared';
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
 * Fournisseur SIMULÉ : déterministe, sans réseau ni coût, pour le développement et les tests
 * automatisés. Il ne prétend à aucune qualité de reconnaissance : il sert à éprouver les règles
 * du serveur (validation, isolation, quotas, confirmation humaine).
 *
 * Conventions :
 * - un contenu (fichier, audio, question) contenant `OCALL-SIM:` suivi d'un JSON fait renvoyer
 *   exactement ce JSON, ce qui permet de simuler une réponse valide, incertaine, invalide ou
 *   malveillante du modèle ;
 * - `OCALL-SIM-DOWN` simule une panne du fournisseur ;
 * - sans marqueur : document illisible, transcription vide, ou réponse par mots-clés (copilote,
 *   commande vocale).
 */
export const SIM_MARKER = 'OCALL-SIM:';
export const SIM_DOWN = 'OCALL-SIM-DOWN';

const USAGE: AiUsageReport = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200 };

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

const QUANTITY_WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

const PERIODS: Array<[RegExp, string]> = [
  [/aujourd ?hui/, 'today'],
  [/\bhier\b/, 'yesterday'],
  [/cette semaine/, 'this_week'],
  [/7 derniers jours/, 'last_7_days'],
  [/ce mois/, 'this_month'],
  [/30 derniers jours/, 'last_30_days'],
];

export class SimulatedAiProvider implements AiProvider {
  readonly name = 'simulated';

  async extractFromDocument<T>(request: {
    document: { data: Buffer };
    schema: JsonSchema;
  }): Promise<AiResult<T>> {
    const value = marker(request.document.data.toString('latin1'));
    return { value: (value ?? { readable: false, items: [] }) as T, usage: USAGE };
  }

  async structureText<T>(request: { text: string; schemaName: string }): Promise<AiResult<T>> {
    const value = marker(request.text);
    if (value !== undefined) return { value: value as T, usage: USAGE };
    if (request.schemaName !== 'voice_order') {
      throw new AiProviderError('AI_INVALID_OUTPUT', 'Réponse IA illisible. Réessayez.');
    }
    return { value: interpretVoiceOrder(request.text) as T, usage: USAGE };
  }

  async runWithTools(request: {
    question: string;
    tools: AiToolDefinition[];
    execute: (call: AiToolCall) => Promise<unknown>;
  }): Promise<AiResult<{ answer: string }>> {
    const scripted = marker(request.question) as
      { calls?: AiToolCall[]; answer?: string } | undefined;
    if (scripted) {
      for (const call of scripted.calls ?? []) await request.execute(call);
      return { value: { answer: scripted.answer ?? '' }, usage: USAGE };
    }
    const q = normalizeLabel(request.question);
    if (/\b(modifie|change|baisse|augmente|supprime|cree|annule|paie|encaisse)\b/.test(q)) {
      return {
        value: {
          answer:
            'Je suis en lecture seule : je ne peux ni modifier un prix, ni créer une commande, ni ' +
            'déclencher un paiement, ni changer les stocks.',
        },
        usage: USAGE,
      };
    }
    const period = PERIODS.find(([re]) => re.test(q))?.[1] ?? 'today';
    const limit = Number(q.match(/\b(\d{1,2})\b/)?.[1] ?? 5);
    const call: AiToolCall | null = /plus vendu|top/.test(q)
      ? { name: 'top_products', arguments: { period, limit } }
      : /rupture|stock/.test(q)
        ? { name: 'low_stock', arguments: {} }
        : /visiteur|entre/.test(q)
          ? { name: 'park_entries', arguments: { period } }
          : /quel jour|meilleur jour/.test(q)
            ? { name: 'best_day', arguments: { period } }
            : /prepare/.test(q)
              ? { name: 'prepared_orders', arguments: { period } }
              : /billet/.test(q)
                ? { name: 'ticket_sales', arguments: { period } }
                : /chiffre d affaires|panier moyen|ventes/.test(q)
                  ? { name: 'revenue_summary', arguments: { period } }
                  : null;
    if (!call) {
      return {
        value: {
          answer:
            'Pouvez-vous préciser votre question ? Par exemple : « Quel est mon chiffre ' +
            'd’affaires aujourd’hui ? » ou « Quels produits sont proches de la rupture ? »',
        },
        usage: USAGE,
      };
    }
    await request.execute(call);
    return { value: { answer: 'Voici les résultats calculés sur vos données.' }, usage: USAGE };
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

/**
 * Interprétation déterministe d'une commande dictée, pour le mode simulé : quantité en chiffres
 * ou en lettres, produit reconnu par son nom dans le catalogue fourni, table « table N ».
 * « quelques », « des », « plusieurs » → quantité incertaine.
 */
function interpretVoiceOrder(text: string) {
  const section = (name: string) => {
    const match = text.match(new RegExp(`${name} \\(JSON\\) :\\n(.*)`));
    return match ? (JSON.parse(match[1]!) as Array<{ ref: string; name: string }>) : [];
  };
  const catalog = section('CATALOGUE');
  const tables = section('TABLES');
  const raw = text.split('TRANSCRIPTION :').pop() ?? '';
  const transcript = normalizeLabel(raw);
  const tableMatch = transcript.match(/\btable (\w+)/);
  const table = tableMatch
    ? (tables.find(
        (t) =>
          normalizeLabel(t.name) === tableMatch[1] ||
          normalizeLabel(t.name) === `table ${tableMatch[1]}`,
      ) ?? null)
    : null;
  // Découpage sur la ponctuation et « et » AVANT normalisation (qui retire les virgules).
  const lines = raw
    .split(/[,;]|\bet\b/)
    .map((part) =>
      normalizeLabel(part)
        .replace(/\b(pour )?(la )?table \w+/, '')
        .trim(),
    )
    .filter(Boolean)
    .map((part) => {
      const words = part.split(' ');
      const first = words[0] ?? '';
      const uncertain = ['quelques', 'des', 'plusieurs'].includes(first);
      const quantity = /^\d+$/.test(first) ? Number(first) : (QUANTITY_WORDS[first] ?? null);
      const rest = (quantity !== null || uncertain ? words.slice(1) : words).join(' ');
      const product = catalog.find((c) => {
        const name = normalizeLabel(c.name);
        const singular = rest.replace(/s\b/g, '');
        return rest.includes(name) || singular.includes(name.replace(/s\b/g, ''));
      });
      return {
        heard: part,
        ref: product?.ref ?? null,
        quantity: uncertain ? null : (quantity ?? 1),
        note: null,
        uncertain: uncertain || !product,
      };
    });
  return {
    lines,
    tableRef: table?.ref ?? null,
    tableHeard: tableMatch ? `table ${tableMatch[1]}` : null,
  };
}
