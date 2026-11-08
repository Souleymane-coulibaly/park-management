/**
 * Ocall School AI (Sprint 8) : copilote de direction, assistant pédagogique, analyse scolaire, sur
 * Ocall AI Core. Constantes et règles pures partagées par l'API et l'interface.
 */

/** Opérations IA de School (fonctionnalités, au sens d'Ocall AI Core). */
export const SCHOOL_AI_FEATURES = ['SCHOOL_COPILOT', 'SCHOOL_TEACHING', 'SCHOOL_ANALYSIS'] as const;
export type SchoolAiFeature = (typeof SCHOOL_AI_FEATURES)[number];

/** Types de contenus pédagogiques générés. */
export const SCHOOL_AI_CONTENT_KINDS = [
  'LESSON_SHEET',
  'LESSON_PLAN',
  'EXERCISES',
  'QCM',
  'HOMEWORK',
  'ANSWER_KEY',
  'ACTIVITY',
] as const;
export type SchoolAiContentKind = (typeof SCHOOL_AI_CONTENT_KINDS)[number];

export const SCHOOL_AI_LANGUAGES = ['FR', 'AR'] as const;
export type SchoolAiLanguage = (typeof SCHOOL_AI_LANGUAGES)[number];

export const SCHOOL_AI_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export type SchoolAiDifficulty = (typeof SCHOOL_AI_DIFFICULTIES)[number];

/** Brouillon modifiable ; validé par son auteur (seul diffusable, exportable en PDF) ; archivé. */
export const SCHOOL_AI_DOCUMENT_STATUSES = ['DRAFT', 'VALIDATED', 'ARCHIVED'] as const;
export type SchoolAiDocumentStatus = (typeof SCHOOL_AI_DOCUMENT_STATUSES)[number];

/** Limites : bornent le coût, la mémoire et la conservation. */
export const SCHOOL_AI_LIMITS = {
  questionMaxLength: 500,
  topicMaxLength: 200,
  objectivesMaxLength: 1000,
  sectionMaxLength: 8000,
  sectionsMax: 12,
  titleMaxLength: 160,
  /** Messages gardés par conversation (question et réponse comptent chacune). */
  messagesPerConversation: 40,
  conversationsPerUser: 50,
  documentsPerUser: 500,
  /** Appels d'outils au plus par question du copilote. */
  toolCallsPerQuestion: 4,
} as const;

/** Seuils d'accompagnement pédagogique (indicateurs de classe ou de matière, jamais d'élève). */
export const SCHOOL_AI_SUPPORT_THRESHOLDS = {
  /** Réussite sous ce taux (points de base) : indicateur d'accompagnement. */
  passRateBelow: 5000,
  /** Absences au-dessus de ce taux (points de base). */
  absenceRateAbove: 1500,
} as const;

/** Sections attendues par type de contenu (clés stables, intitulés traduits par l'interface). */
export const SCHOOL_AI_SECTIONS: Record<SchoolAiContentKind, readonly string[]> = {
  LESSON_SHEET: ['objectives', 'prerequisites', 'content', 'summary'],
  LESSON_PLAN: ['objectives', 'materials', 'introduction', 'activities', 'evaluation', 'homework'],
  EXERCISES: ['instructions', 'exercises'],
  QCM: ['instructions', 'questions'],
  HOMEWORK: ['instructions', 'tasks'],
  ANSWER_KEY: ['answers', 'grading'],
  ACTIVITY: ['objectives', 'materials', 'steps', 'debrief'],
};

/** Clé de section valide : minuscules, chiffres et tiret bas. */
export function isSectionKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,39}$/.test(key);
}
