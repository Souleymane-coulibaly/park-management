/**
 * Règles du Sprint 8 (intelligence artificielle) partagées par l'API (autorité) et l'interface :
 * fonctionnalités, formats acceptés, périodes d'analyse du copilote, estimation des coûts,
 * détection de doublons et contrôle des chiffres cités par le copilote.
 */
import { addDays, localMoment } from './park';

// ─── Fonctionnalités ───

export const AI_FEATURES = ['CATALOG_IMPORT', 'TICKET_IMPORT', 'COPILOT', 'VOICE_ORDER'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  CATALOG_IMPORT: 'Import de carte (restaurant)',
  TICKET_IMPORT: 'Import de tarifs (billetterie)',
  COPILOT: 'Copilote analytique',
  VOICE_ORDER: 'Commande vocale',
};

/** Plafond mensuel d'appels IA par organisation, par défaut (modifiable par l'administrateur). */
export const AI_DEFAULT_MONTHLY_CALL_LIMIT = 500;
/** Seuil d'alerte par défaut, en pourcentage du plafond. */
export const AI_DEFAULT_ALERT_PERCENT = 80;
/** Conservation par défaut des transcriptions et des résultats d'import (jours). */
export const AI_DEFAULT_RETENTION_DAYS = 30;
export const AI_MAX_RETENTION_DAYS = 365;

// ─── Fichiers acceptés ───

/** Cartes et grilles tarifaires : photo ou PDF, 10 Mo au plus. Le fichier n'est jamais conservé. */
export const AI_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const AI_IMPORT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type AiImportMimeType = (typeof AI_IMPORT_MIME_TYPES)[number];

/** Enregistrement vocal : 2 Mo au plus (environ une minute). L'audio n'est jamais conservé. */
export const AI_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const AI_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/mpeg',
] as const;
export type AiAudioMimeType = (typeof AI_AUDIO_MIME_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

/**
 * Type réel d'un fichier d'import, déterminé par sa signature (et non par son extension ou par
 * le type annoncé par le navigateur). null = format refusé.
 */
export function detectImportMimeType(bytes: Uint8Array): AiImportMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** Type réel d'un enregistrement vocal, d'après sa signature. null = format refusé. */
export function detectAudioMimeType(bytes: Uint8Array): AiAudioMimeType | null {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8))
    return 'audio/wav';
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return 'audio/mp4';
  if (
    startsWith(bytes, [0x49, 0x44, 0x33]) ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  return null;
}

// ─── Import IA : anomalies signalées sur une ligne ───

/** Motif signalé sur une ligne importée : la ligne reste à vérifier par un humain. */
export type ImportIssue =
  | 'PRICE_MISSING'
  | 'PRICE_UNCERTAIN'
  | 'PRICE_WITHOUT_SOURCE'
  | 'PRICE_INVALID'
  | 'CURRENCY_UNEXPECTED'
  | 'UNCERTAIN'
  | 'NAME_TRUNCATED'
  | 'DUPLICATE_EXISTING'
  | 'DUPLICATE_IN_IMPORT'
  | 'KIND_UNKNOWN';

export const IMPORT_ISSUE_LABELS: Record<ImportIssue, string> = {
  PRICE_MISSING: 'Prix absent du document : à saisir',
  PRICE_UNCERTAIN: 'Prix illisible ou ambigu : à vérifier',
  PRICE_WITHOUT_SOURCE: 'Prix non trouvé dans le texte lu : retiré, à saisir',
  PRICE_INVALID: 'Prix hors limites : retiré, à saisir',
  CURRENCY_UNEXPECTED: 'Devise inattendue : à vérifier',
  UNCERTAIN: 'Lecture incertaine : à vérifier',
  NAME_TRUNCATED: 'Nom raccourci à 80 caractères',
  DUPLICATE_EXISTING: 'Existe peut-être déjà dans votre catalogue',
  DUPLICATE_IN_IMPORT: 'Apparaît plusieurs fois dans ce document',
  KIND_UNKNOWN: 'Type de billet non reconnu : « Personnalisée » proposé',
};

// ─── Copilote : périodes d'analyse ───

export const COPILOT_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_7_days',
  'this_month',
  'last_30_days',
] as const;
export type CopilotPeriod = (typeof COPILOT_PERIODS)[number];

export interface ResolvedPeriod {
  period: CopilotPeriod;
  /** Premier jour inclus (AAAA-MM-JJ, heure locale de l'établissement). */
  from: string;
  /** Lendemain du dernier jour inclus (exclu). */
  to: string;
  label: string;
}

const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Période d'analyse calculée par le serveur dans le fuseau de l'établissement : le modèle choisit
 * seulement un mot-clé de la liste fermée, jamais des dates libres.
 */
export function resolveCopilotPeriod(
  period: CopilotPeriod,
  now: Date,
  timeZone: string,
): ResolvedPeriod {
  const local = localMoment(now, timeZone);
  const today = local.date;
  const tomorrow = addDays(today, 1);
  const range = (from: string, to: string, label: string): ResolvedPeriod => ({
    period,
    from,
    to,
    label,
  });
  const span = (from: string, to: string) => `du ${frDate(from)} au ${frDate(addDays(to, -1))}`;
  switch (period) {
    case 'today':
      return range(today, tomorrow, `Aujourd'hui (${frDate(today)})`);
    case 'yesterday': {
      const y = addDays(today, -1);
      return range(y, today, `Hier (${frDate(y)})`);
    }
    case 'this_week': {
      // Semaine du lundi au dimanche.
      const monday = addDays(today, -((local.weekday + 6) % 7));
      return range(monday, tomorrow, `Cette semaine, ${span(monday, tomorrow)}`);
    }
    case 'last_7_days': {
      const from = addDays(today, -6);
      return range(from, tomorrow, `7 derniers jours, ${span(from, tomorrow)}`);
    }
    case 'this_month': {
      const first = `${today.slice(0, 8)}01`;
      return range(first, tomorrow, `Ce mois-ci, ${span(first, tomorrow)}`);
    }
    case 'last_30_days': {
      const from = addDays(today, -29);
      return range(from, tomorrow, `30 derniers jours, ${span(from, tomorrow)}`);
    }
  }
}

// ─── Coûts estimés ───

/**
 * Tarifs publics utilisés pour ESTIMER les coûts (USD). Ils ne remplacent pas la facture du
 * fournisseur : toute somme affichée est marquée « estimation ». Relevés le 30/10/2026 ;
 * `gpt-transcribe` ne repose que sur une source secondaire.
 */
export const AI_TOKEN_PRICES_USD_PER_MTOK: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-4o-transcribe': { input: 2.5, cachedInput: 2.5, output: 10 },
  'gpt-4o-mini-transcribe': { input: 1.25, cachedInput: 1.25, output: 5 },
};
export const AI_AUDIO_PRICES_USD_PER_MINUTE: Record<string, number> = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
};

export interface AiUsageMeasure {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
}

/**
 * Coût estimé d'un appel, en micro-dollars (entier). null = modèle sans tarif connu : le coût
 * est alors affiché comme « non estimé », jamais comme nul.
 */
export function estimateAiCostMicroUsd(model: string, usage: AiUsageMeasure): number | null {
  if (usage.audioSeconds !== undefined) {
    const perMinute = AI_AUDIO_PRICES_USD_PER_MINUTE[model];
    if (perMinute !== undefined) return Math.ceil((usage.audioSeconds / 60) * perMinute * 1e6);
  }
  const prices = AI_TOKEN_PRICES_USD_PER_MTOK[model];
  if (!prices) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens ?? 0);
  const fresh = (usage.inputTokens ?? 0) - cached;
  // Tarif par million de jetons = micro-dollars par jeton.
  return Math.ceil(
    fresh * prices.input + cached * prices.cachedInput + (usage.outputTokens ?? 0) * prices.output,
  );
}

/** Conversion indicative d'un coût estimé en FCFA (taux fourni par la configuration). */
export function microUsdToXof(microUsd: number, usdXofRate: number): number {
  return Math.round((microUsd / 1e6) * usdXofRate);
}

// ─── Doublons ───

/** Normalise un libellé pour la comparaison : minuscules, sans accents ni ponctuation. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Doublon potentiel : libellés identiques une fois normalisés, ou l'un contenu dans l'autre
 * (« Jus de bissap » / « Jus de bissap glacé »). Signalé à l'utilisateur, jamais fusionné seul.
 */
export function isPotentialDuplicate(a: string, b: string): boolean {
  const x = normalizeLabel(a);
  const y = normalizeLabel(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

// ─── Copilote : produit cité dans une question ───

/** Mots significatifs au singulier (« poulets braisés » → « poulet braise »). */
function productWords(label: string): string[] {
  const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'a', 'l', 'd', 'et']);
  return normalizeLabel(label)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w));
}

export type ProductMatch<T> =
  | { status: 'MATCHED'; item: T }
  | { status: 'AMBIGUOUS'; candidates: T[] }
  | { status: 'NOT_FOUND' };

/**
 * Retrouve le produit du catalogue désigné par les mots de l'utilisateur, sans jamais deviner :
 * nom identique (au singulier, sans accents) ; sinon un seul produit dont le nom contient tous les
 * mots cités ; plusieurs candidats → ambigu (on demande de préciser) ; aucun → introuvable.
 */
export function matchProductName<T extends { name: string }>(
  query: string,
  items: T[],
): ProductMatch<T> {
  const q = productWords(query);
  if (q.length === 0) return { status: 'NOT_FOUND' };
  const key = q.join(' ');
  const exact = items.filter((i) => productWords(i.name).join(' ') === key);
  if (exact.length === 1) return { status: 'MATCHED', item: exact[0]! };
  const containing = items.filter((i) => {
    const words = productWords(i.name);
    return q.every((w) => words.includes(w));
  });
  if (containing.length === 1) return { status: 'MATCHED', item: containing[0]! };
  if (containing.length > 1 || exact.length > 1) {
    return { status: 'AMBIGUOUS', candidates: exact.length > 1 ? exact : containing };
  }
  return { status: 'NOT_FOUND' };
}

// ─── Copilote : chiffres cités ───

/** Nombres présents dans un texte (« 12 500 », « 12.500 », « 3,5 » → 12500, 12500, 3.5). */
export function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:[  .]\d{3})*(?:,\d+)?/g) ?? [];
  return matches.map((m) => Number(m.replace(/[  .]/g, '').replace(',', '.')));
}

/**
 * Vérifie que chaque nombre cité par le modèle figure dans les données calculées par le serveur
 * (ou dans la question). Un nombre absent = statistique potentiellement inventée.
 */
export function numbersAreGrounded(answer: string, groundTruth: string): boolean {
  const allowed = new Set(extractNumbers(groundTruth));
  return extractNumbers(answer).every((n) => allowed.has(n));
}
