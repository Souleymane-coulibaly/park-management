import { normalizeLabel } from '@ocall/shared';
import type { AiToolCall } from '../../ai-core/ai-provider';
import { type AiSimulation } from '../../ai-core/providers/simulated.provider';
import { PARK_COPILOT_PROMPT } from './copilot/copilot.prompt';

/**
 * Scénarios de simulation d'Ocall Park, inscrits auprès du fournisseur simulé d'Ocall AI Core :
 * réponse par mots-clés du copilote analytique et interprétation déterministe d'une commande dictée.
 * Ils ne servent qu'en développement et en test (le fournisseur simulé est refusé en production).
 */
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

export const PARK_AI_SIMULATION: AiSimulation = {
  structureText(request) {
    return request.schemaName === 'voice_order' ? interpretVoiceOrder(request.text) : undefined;
  },

  runWithTools(request): { calls: AiToolCall[]; answer: string } | undefined {
    // Seulement pour le copilote de Park (son prompt, suivi du nom de l'établissement).
    if (!request.instructions.startsWith(PARK_COPILOT_PROMPT.instructions)) return undefined;
    const q = normalizeLabel(request.question);
    if (/\b(modifie|change|baisse|augmente|supprime|cree|annule|paie|encaisse)\b/.test(q)) {
      return {
        calls: [],
        answer:
          'Je suis en lecture seule : je ne peux ni modifier un prix, ni créer une commande, ni ' +
          'déclencher un paiement, ni changer les stocks.',
      };
    }
    const period = PERIODS.find(([re]) => re.test(q))?.[1] ?? 'today';
    const limit = Number(q.match(/\b(\d{1,2})\b/)?.[1] ?? 5);
    // Sprint 9B : analyses avancées (produit × heure, CA par produit, heures de pointe, jour le plus
    // fréquenté, marges). Le produit est transmis tel que dit ; le serveur le cherche au catalogue.
    const range = q.match(/entre (\d{1,2}) ?h\w* et (\d{1,2}) ?h/);
    const atHour = q.match(/\ba (\d{1,2}) ?h\b/);
    const product = q.match(/combien de (.+?) (?:ont ete |a ete )?vendu/)?.[1] ?? '';
    const call: AiToolCall | null = /rentable|marge/.test(q)
      ? { name: 'category_margins', arguments: { period } }
      : range
        ? {
            name: 'product_hourly_sales',
            arguments: { period, product, hour_from: Number(range[1]), hour_to: Number(range[2]) },
          }
        : atHour && /rapporte|revenu/.test(q)
          ? {
              name: 'product_hourly_sales',
              arguments: {
                period,
                product: '',
                hour_from: Number(atHour[1]),
                hour_to: Number(atHour[1]) + 1,
              },
            }
          : /plus de revenus|rapporte le plus|plus de chiffre/.test(q)
            ? { name: 'top_products_revenue', arguments: { period, limit: Math.min(limit, 10) } }
            : /heure de pointe|quelles heures|heures .*commandes/.test(q)
              ? { name: 'busiest_hours', arguments: { period } }
              : /plus frequente|jour .*frequent/.test(q)
                ? { name: 'busiest_park_day', arguments: { period } }
                : null;
    const fallback: AiToolCall | null = /plus vendu|top/.test(q)
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
    const selected = call ?? fallback;
    if (!selected) {
      return {
        calls: [],
        answer:
          'Pouvez-vous préciser votre question ? Par exemple : « Quel est mon chiffre ' +
          'd’affaires aujourd’hui ? » ou « Quels produits sont proches de la rupture ? »',
      };
    }
    return { calls: [selected], answer: 'Voici les résultats calculés sur vos données.' };
  },
};

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
