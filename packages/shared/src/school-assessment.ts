/**
 * Ocall School, évaluations, notes et moyennes (Sprint 4). Moteur de calcul pur, partagé par l'API (seule
 * source des résultats) et le frontend (affichage). Aucune règle n'est supposée commune à toutes les
 * écoles : barème, décimales, absences et classement viennent de la version des règles appliquée.
 */
import {
  DEFAULT_SCHOOL_GRADING_RULES,
  type SchoolAbsenceRule,
  type SchoolGradingRules,
} from './school';

export const SCHOOL_EVALUATION_KINDS = ['HOMEWORK', 'QUIZ', 'COMPOSITION', 'EXAM'] as const;
export type SchoolEvaluationKind = (typeof SCHOOL_EVALUATION_KINDS)[number];

export const SCHOOL_EVALUATION_KIND_LABELS: Record<SchoolEvaluationKind, string> = {
  HOMEWORK: 'Devoir',
  QUIZ: 'Interrogation',
  COMPOSITION: 'Composition',
  EXAM: 'Examen',
};

/** Une absence ou une dispense n'est jamais une note de zéro : seule la note porte une valeur. */
export const SCHOOL_GRADE_STATUSES = ['SCORED', 'ABSENT', 'EXEMPT'] as const;
export type SchoolGradeStatus = (typeof SCHOOL_GRADE_STATUSES)[number];

export const SCHOOL_GRADE_STATUS_LABELS: Record<SchoolGradeStatus, string> = {
  SCORED: 'Noté',
  ABSENT: 'Absent',
  EXEMPT: 'Dispensé',
};

/** Barème maximal d'une évaluation, et coefficient maximal (évaluation ou matière). */
export const SCHOOL_MAX_SCORE_LIMIT = 1000;
export const SCHOOL_COEFFICIENT_LIMIT = 100;

/** Règles complètes : une version antérieure au Sprint 4 reçoit les valeurs par défaut manquantes. */
export function resolveGradingRules(
  rules?: Partial<SchoolGradingRules> | null,
): SchoolGradingRules {
  const base = DEFAULT_SCHOOL_GRADING_RULES;
  return {
    scale: rules?.scale ?? base.scale,
    passMark: rules?.passMark ?? base.passMark,
    decimals: rules?.decimals ?? base.decimals,
    ranking: {
      enabled: rules?.ranking?.enabled ?? base.ranking.enabled,
      ties: rules?.ranking?.ties ?? base.ranking.ties,
      // Liste absente ou mal formée (version ancienne) : aucune exclusion, jamais une exception.
      excludedSubjectIds: Array.isArray(rules?.ranking?.excludedSubjectIds)
        ? rules.ranking.excludedSubjectIds
            .filter((id): id is string => typeof id === 'string')
            // Identifiants comparés en minuscules, comme PostgreSQL les restitue.
            .map((id) => id.toLowerCase())
        : [],
    },
    absences: (rules?.absences ?? 'EXCLUDED') satisfies SchoolAbsenceRule,
  };
}

/**
 * Arrondi au plus proche, la moitié vers le haut. La valeur est d'abord ramenée à 15 chiffres
 * significatifs (précision garantie d'un double), puis décalée en notation décimale : 1,005 et 10,075
 * s'arrondissent à 1,01 et 10,08, sans l'erreur de leur représentation binaire ; une valeur minuscule
 * (notation scientifique) s'arrondit à zéro.
 */
export function roundScore(value: number, decimals: number): number {
  // Au-delà de 10^15, un double n'a plus de décimale significative : rien à arrondir.
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return value;
  // Mantisse et exposant séparés : une valeur minuscule (1,9998e-8) se décale sans double exposant.
  const [mantissa = '0', exponent = '0'] = value.toPrecision(15).includes('e')
    ? value.toPrecision(15).split('e')
    : [value.toPrecision(15), '0'];
  const shifted = Math.round(Number(`${mantissa}e${Number(exponent) + decimals}`));
  // Entier exact divisé par une puissance de dix : le double le plus proche du résultat décimal.
  return shifted / 10 ** decimals + 0;
}

/**
 * Contrôle d'une saisie : une note seulement pour le statut « Noté », entre 0 et le barème, deux
 * décimales au plus. Renvoie un message d'erreur, ou null si la saisie est valide.
 */
export function gradeEntryError(
  entry: { status: SchoolGradeStatus; score?: number | null },
  maxScore: number,
): string | null {
  if (entry.status !== 'SCORED') {
    return entry.score === null || entry.score === undefined
      ? null
      : 'Une absence ou une dispense ne porte pas de note.';
  }
  const score = entry.score;
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return 'La note est obligatoire.';
  }
  if (score < 0 || score > maxScore) return `La note doit être comprise entre 0 et ${maxScore}.`;
  if (roundScore(score, 2) !== score) return 'La note admet deux décimales au plus.';
  return null;
}

// ─── Moteur de calcul ───

export interface ResultsEvaluation {
  id: string;
  subjectId: string;
  maxScore: number;
  coefficient: number;
  /** Évaluation d'un groupe : seuls ses élèves sont concernés. */
  groupId: string | null;
}

export interface ResultsGrade {
  evaluationId: string;
  studentId: string;
  status: SchoolGradeStatus;
  score: number | null;
}

export interface ResultsSubject {
  id: string;
  /** Coefficient de la matière au niveau de la classe ; 0 = hors moyenne générale. */
  coefficient: number;
}

export interface ResultsStudent {
  id: string;
  groupIds: string[];
}

export interface ResultsInput {
  rules: SchoolGradingRules;
  subjects: readonly ResultsSubject[];
  evaluations: readonly ResultsEvaluation[];
  grades: readonly ResultsGrade[];
  students: readonly ResultsStudent[];
}

export interface StudentSubjectResult {
  subjectId: string;
  /** Moyenne sur le barème de l'établissement, arrondie ; null sans aucune note retenue. */
  average: number | null;
  scored: number;
  absent: number;
  exempt: number;
  /** Évaluations concernant l'élève sans saisie : écartées, signalées à l'écran. */
  missing: number;
}

export interface StudentResult {
  studentId: string;
  subjects: StudentSubjectResult[];
  generalAverage: number | null;
  /** Moyenne servant au classement : sans les matières exclues du classement. */
  rankingAverage: number | null;
  /** null si le classement est désactivé ou si l'élève n'a pas de moyenne. */
  rank: number | null;
  tied: boolean;
  passed: boolean | null;
}

export interface SubjectSummary {
  subjectId: string;
  classAverage: number | null;
  min: number | null;
  max: number | null;
}

export interface ClassResults {
  students: StudentResult[];
  subjects: SubjectSummary[];
  classAverage: number | null;
  rankingEnabled: boolean;
}

/**
 * Résultats d'une classe sur une période, pour un ensemble de règles :
 * - moyenne de matière : moyenne des notes ramenées au barème, pondérée par le coefficient de chaque
 *   évaluation ; une dispense et une note non saisie sont écartées ; une absence est écartée ou vaut zéro
 *   selon la règle ;
 * - moyenne générale : moyenne des moyennes de matière arrondies (celles du bulletin, pour qu'une famille
 *   puisse la recalculer), pondérée par le coefficient de chaque matière ;
 * - classement : sur la moyenne de classement arrondie, ex æquo selon la règle (SHARED : 1, 1, 3 ;
 *   DENSE : 1, 1, 2) ; un élève sans moyenne n'est pas classé.
 */
export function computeClassResults(input: ResultsInput): ClassResults {
  const rules = resolveGradingRules(input.rules);
  const round = (v: number) => roundScore(v, rules.decimals);
  const excluded = new Set(rules.ranking.excludedSubjectIds);
  const gradeOf = new Map(input.grades.map((g) => [`${g.evaluationId}:${g.studentId}`, g]));

  const students: StudentResult[] = input.students.map((student) => {
    const groups = new Set(student.groupIds);
    const subjects = input.subjects.map((subject) => {
      let total = 0;
      let weights = 0;
      const result: StudentSubjectResult = {
        subjectId: subject.id,
        average: null,
        scored: 0,
        absent: 0,
        exempt: 0,
        missing: 0,
      };
      for (const evaluation of input.evaluations) {
        if (evaluation.subjectId !== subject.id) continue;
        if (evaluation.groupId && !groups.has(evaluation.groupId)) continue;
        const grade = gradeOf.get(`${evaluation.id}:${student.id}`);
        if (!grade) {
          result.missing += 1;
        } else if (grade.status === 'SCORED' && grade.score !== null) {
          result.scored += 1;
          total += (grade.score / evaluation.maxScore) * rules.scale * evaluation.coefficient;
          weights += evaluation.coefficient;
        } else if (grade.status === 'ABSENT') {
          result.absent += 1;
          if (rules.absences === 'ZERO') weights += evaluation.coefficient;
        } else {
          result.exempt += 1;
        }
      }
      result.average = weights > 0 ? round(total / weights) : null;
      return result;
    });
    const generalAverage = weighted(subjects, input.subjects, () => true, round);
    const rankingAverage = weighted(subjects, input.subjects, (id) => !excluded.has(id), round);
    return {
      studentId: student.id,
      subjects,
      generalAverage,
      rankingAverage,
      rank: null,
      tied: false,
      passed: generalAverage === null ? null : generalAverage >= rules.passMark,
    };
  });

  if (rules.ranking.enabled) rank(students, rules.ranking.ties);

  const subjects = input.subjects.map((subject, index) => {
    const values = students
      .map((s) => s.subjects[index]?.average)
      .filter((v): v is number => v !== null && v !== undefined);
    return {
      subjectId: subject.id,
      classAverage: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    };
  });
  const generals = students.map((s) => s.generalAverage).filter((v): v is number => v !== null);
  return {
    students,
    subjects,
    classAverage: generals.length
      ? round(generals.reduce((a, b) => a + b, 0) / generals.length)
      : null,
    rankingEnabled: rules.ranking.enabled,
  };
}

function weighted(
  results: StudentSubjectResult[],
  subjects: readonly ResultsSubject[],
  keep: (subjectId: string) => boolean,
  round: (v: number) => number,
): number | null {
  let total = 0;
  let weights = 0;
  results.forEach((result, index) => {
    const coefficient = subjects[index]?.coefficient ?? 0;
    if (result.average === null || coefficient <= 0 || !keep(result.subjectId)) return;
    total += result.average * coefficient;
    weights += coefficient;
  });
  return weights > 0 ? round(total / weights) : null;
}

function rank(students: StudentResult[], ties: SchoolGradingRules['ranking']['ties']) {
  const ranked = students
    .filter((s) => s.rankingAverage !== null)
    .sort((a, b) => (b.rankingAverage as number) - (a.rankingAverage as number));
  let position = 0;
  let distinct = 0;
  let previous: number | null = null;
  ranked.forEach((student, index) => {
    if (student.rankingAverage !== previous) {
      distinct += 1;
      position = index + 1;
      previous = student.rankingAverage;
    }
    student.rank = ties === 'DENSE' ? distinct : position;
  });
  const count = new Map<number, number>();
  for (const s of ranked) count.set(s.rank as number, (count.get(s.rank as number) ?? 0) + 1);
  for (const s of ranked) s.tied = (count.get(s.rank as number) ?? 0) > 1;
}

/** Version des règles applicable à une période : la plus récente entrée en vigueur à sa date de fin. */
export function policyForPeriod<T extends { version: number; effectiveFrom: string | Date }>(
  policies: readonly T[],
  periodEndsOn: string | Date,
): T | null {
  const end = new Date(periodEndsOn).getTime();
  let best: T | null = null;
  for (const policy of policies) {
    if (new Date(policy.effectiveFrom).getTime() > end) continue;
    if (!best || policy.version > best.version) best = policy;
  }
  return best;
}
