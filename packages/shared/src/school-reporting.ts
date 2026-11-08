/**
 * Reporting d'Ocall School (Sprint 8) : calculs statistiques purs, partagés par l'API (rapports, exports,
 * outils du copilote et de l'analyse IA) et l'interface. Aucun calcul ne réinterprète une moyenne : les
 * moyennes d'entrée sont celles du moteur de notes (Sprint 4), arrondies selon les règles de l'école.
 */

/** Rapports disponibles. Le financier exige en plus la permission des rapports financiers. */
export const SCHOOL_REPORT_KINDS = ['overview', 'pedagogy', 'attendance', 'finance'] as const;
export type SchoolReportKind = (typeof SCHOOL_REPORT_KINDS)[number];

/**
 * Filtres réellement appliqués par chaque rapport. Un filtre absent de la liste est refusé par l'API
 * (jamais affiché sans effet) : le tableau de bord couvre l'établissement entier.
 */
export const SCHOOL_REPORT_FILTERS: Record<
  SchoolReportKind,
  readonly ('classId' | 'periodId' | 'from' | 'to')[]
> = {
  overview: [],
  pedagogy: ['classId', 'periodId'],
  attendance: ['classId', 'from', 'to'],
  finance: ['classId', 'from', 'to'],
};

export const SCHOOL_REPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;
export type SchoolReportFormat = (typeof SCHOOL_REPORT_FORMATS)[number];

/** En dessous de cet effectif, une statistique est signalée « données insuffisantes ». */
export const REPORT_MIN_SAMPLE = 3;

/** Nombre maximal de couples classe × période calculés par un rapport pédagogique. */
export const REPORT_MAX_CLASS_PERIODS = 120;

/** Écart (en part du barème, ‰) sous lequel une évolution est considérée stable : 2,5 % du barème. */
export const REPORT_STABLE_PER_MILLE = 25;

export interface DistributionBin {
  /** Bornes en points du barème ; la dernière tranche inclut la note maximale. */
  from: number;
  to: number;
  count: number;
}

/**
 * Répartition des moyennes en tranches égales du barème (5 par défaut : 0–4, 4–8… sur 20). Une moyenne
 * absente n'est pas comptée dans les tranches mais dans `missing`.
 */
export function averageDistribution(
  averages: readonly (number | null)[],
  scale: number,
  bins = 5,
): { bins: DistributionBin[]; missing: number } {
  const width = scale / bins;
  const result: DistributionBin[] = Array.from({ length: bins }, (_, i) => ({
    from: round2(i * width),
    to: round2((i + 1) * width),
    count: 0,
  }));
  let missing = 0;
  for (const a of averages) {
    if (a === null || !Number.isFinite(a)) {
      missing += 1;
      continue;
    }
    const index = Math.min(bins - 1, Math.max(0, Math.floor(a / width)));
    result[index]!.count += 1;
  }
  return { bins: result, missing };
}

/** Taux de réussite en points de base (10 000 = 100 %) ; null sans aucun résultat. */
export function passRate(passed: readonly (boolean | null)[]): number | null {
  const known = passed.filter((p): p is boolean => p !== null);
  if (known.length === 0) return null;
  return Math.floor((known.filter(Boolean).length * 10_000) / known.length);
}

/** Moyenne simple des valeurs présentes, arrondie à `decimals` ; null s'il n'y en a aucune. */
export function meanOf(values: readonly (number | null)[], decimals = 2): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return null;
  const factor = 10 ** decimals;
  return Math.round((known.reduce((s, v) => s + v, 0) / known.length) * factor) / factor;
}

export type TrendDirection = 'UP' | 'DOWN' | 'STABLE' | 'INSUFFICIENT';

export interface TrendPoint {
  key: string;
  value: number | null;
}

/**
 * Tendance d'une série ordonnée (périodes) : écart entre la première et la dernière valeur connues.
 * Stable si l'écart reste sous 2,5 % du barème ; « insuffisant » avec moins de deux valeurs connues.
 * Une tendance décrit une série agrégée ; elle n'est jamais une étiquette posée sur un élève.
 */
export function trendOf(
  points: readonly TrendPoint[],
  scale: number,
): { direction: TrendDirection; delta: number | null; from: string | null; to: string | null } {
  const known = points.filter((p): p is { key: string; value: number } => p.value !== null);
  if (known.length < 2) return { direction: 'INSUFFICIENT', delta: null, from: null, to: null };
  const first = known[0]!;
  const last = known[known.length - 1]!;
  const delta = round2(last.value - first.value);
  const stable = (Math.abs(delta) * 1000) / scale < REPORT_STABLE_PER_MILLE;
  return {
    direction: stable ? 'STABLE' : delta > 0 ? 'UP' : 'DOWN',
    delta,
    from: first.key,
    to: last.key,
  };
}

/** Écart entre deux valeurs (b − a), null si l'une manque. */
export function deltaOf(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : round2(b - a);
}

/** Taux en points de base d'une partie sur un total ; null si le total est nul. */
export function rateOf(part: number, total: number): number | null {
  return total <= 0 ? null : Math.floor((part * 10_000) / total);
}

/** Vrai si l'effectif ne permet pas une statistique fiable. */
export function insufficientSample(count: number): boolean {
  return count < REPORT_MIN_SAMPLE;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
