/**
 * Ocall School : types d'établissements, rôles et règles pédagogiques de base. Partagé par l'API
 * (contrôle) et le frontend (affichage). Les rôles School sont indépendants des rôles Ocall Park.
 */

export const SCHOOL_PRODUCT_CODE = 'OCALL_SCHOOL';

export const SCHOOL_TYPES = [
  'PRESCHOOL',
  'PRIMARY',
  'MIDDLE',
  'HIGH',
  'FRANCO_ARABIC',
  'COMPLEX',
] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];

export const SCHOOL_TYPE_LABELS: Record<SchoolType, string> = {
  PRESCHOOL: 'École maternelle',
  PRIMARY: 'École primaire',
  MIDDLE: 'Collège',
  HIGH: 'Lycée',
  FRANCO_ARABIC: 'École franco-arabe',
  COMPLEX: 'Complexe scolaire',
};

export const SCHOOL_LOCALES = ['FR', 'AR', 'BILINGUAL'] as const;
export type SchoolLocale = (typeof SCHOOL_LOCALES)[number];

export const SCHOOL_LOCALE_LABELS: Record<SchoolLocale, string> = {
  FR: 'Français',
  AR: 'Arabe',
  BILINGUAL: 'Bilingue français et arabe',
};

export const SCHOOL_PERIOD_KINDS = ['TRIMESTER', 'SEMESTER', 'CUSTOM'] as const;
export type SchoolPeriodKind = (typeof SCHOOL_PERIOD_KINDS)[number];

export const SCHOOL_PERIOD_KIND_LABELS: Record<SchoolPeriodKind, string> = {
  TRIMESTER: 'Trimestre',
  SEMESTER: 'Semestre',
  CUSTOM: 'Période personnalisée',
};

export const SCHOOL_YEAR_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED'] as const;
export type SchoolYearStatus = (typeof SCHOOL_YEAR_STATUSES)[number];

export const SCHOOL_YEAR_STATUS_LABELS: Record<SchoolYearStatus, string> = {
  PLANNED: 'En préparation',
  ACTIVE: 'En cours',
  CLOSED: 'Clôturée',
};

/** Transitions d'une année scolaire : une année clôturée reste figée. */
export function canTransitionSchoolYear(from: SchoolYearStatus, to: SchoolYearStatus): boolean {
  return (from === 'PLANNED' && to === 'ACTIVE') || (from === 'ACTIVE' && to === 'CLOSED');
}

// ─── Rôles et permissions ───

export const SCHOOL_ROLES = [
  'GROUP_DIRECTOR',
  'SCHOOL_DIRECTOR',
  'SECRETARY',
  'TEACHER',
  'SUPERVISOR',
  'ACCOUNTANT',
] as const;
export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export const SCHOOL_ROLE_LABELS: Record<SchoolRole, string> = {
  GROUP_DIRECTOR: 'Direction du groupe',
  SCHOOL_DIRECTOR: 'Directeur d’établissement',
  SECRETARY: 'Secrétariat',
  TEACHER: 'Enseignant',
  SUPERVISOR: 'Surveillant',
  ACCOUNTANT: 'Comptable',
};

export const SchoolPermission = {
  STRUCTURE_READ: 'school.structure.read',
  STRUCTURE_MANAGE: 'school.structure.manage',
  SCHOOLS_MANAGE: 'school.schools.manage',
  MEMBERS_READ: 'school.members.read',
  MEMBERS_MANAGE: 'school.members.manage',
  GRADING_MANAGE: 'school.grading.manage',
  EXPORT: 'school.export',
  /** Liste restreinte : matricule, noms, classe, statut. */
  STUDENTS_READ: 'school.students.read',
  /** Dossier complet : naissance, adresse, observations. */
  STUDENTS_READ_FULL: 'school.students.read_full',
  STUDENTS_MANAGE: 'school.students.manage',
  /** Besoins particuliers, chiffrés et journalisés à chaque consultation. */
  STUDENTS_SENSITIVE: 'school.students.sensitive',
  MATRICULE_CORRECT: 'school.students.matricule_correct',
  STUDENTS_SETTINGS: 'school.students.settings',
  STUDENTS_IMPORT: 'school.students.import',
  STUDENTS_EXPORT: 'school.students.export',
  ENROLLMENTS_MANAGE: 'school.enrollments.manage',
  ENROLLMENTS_VALIDATE: 'school.enrollments.validate',
  /** Transfert entre deux établissements du groupe. */
  TRANSFER: 'school.students.transfer',
  GUARDIANS_READ: 'school.guardians.read',
  GUARDIANS_MANAGE: 'school.guardians.manage',
  DOCUMENTS_READ: 'school.documents.read',
  DOCUMENTS_MANAGE: 'school.documents.manage',
  DOCUMENTS_DELETE: 'school.documents.delete',
  /** Équipe pédagogique : enseignants, affectations, historique (Sprint 3B). */
  TEACHING_READ: 'school.teaching.read',
  /** Affecter, remplacer ou terminer une affectation d'enseignement. */
  TEACHING_MANAGE: 'school.teaching.manage',
  /** Évaluations, notes et moyennes (Sprint 4) ; l'enseignant, seulement pour ses affectations. */
  ASSESSMENT_READ: 'school.assessment.read',
  /** Créer des évaluations, saisir les notes et les appréciations ; l'enseignant, ses affectations. */
  ASSESSMENT_MANAGE: 'school.assessment.manage',
  /** Valider ou rouvrir les résultats d'une classe, rédiger l'appréciation générale. */
  RESULTS_VALIDATE: 'school.results.validate',
  /** Moyennes générales, classements et bulletins PDF de toute la classe. */
  REPORT_CARDS: 'school.report_cards',
  /** Activer ou désactiver le module « Mémorisation du Coran ». */
  QURAN_SETTINGS: 'school.quran.settings',
  /** Consulter la mémorisation ; l'enseignant, seulement pour la matière Coran de ses classes. */
  QURAN_READ: 'school.quran.read',
  /** Enregistrer une évaluation de mémorisation : l'enseignant affecté à la matière Coran. */
  QURAN_MANAGE: 'school.quran.manage',
  /** Situation financière des élèves, échéances, encaissements et reçus (Sprint 5). */
  FINANCE_READ: 'school.finance.read',
  /** Réglages financiers, catalogue des frais, échéanciers et génération des échéances. */
  FINANCE_SETTINGS: 'school.finance.settings',
  /** Enregistrer un encaissement en caisse. Le secrétariat seulement si la direction l'autorise. */
  FINANCE_COLLECT: 'school.finance.collect',
  /** Accorder ou retirer une réduction, une bourse ou une exonération ; ajuster une échéance. */
  FINANCE_BENEFITS: 'school.finance.benefits',
  /** Annuler un encaissement confirmé (contrepassation motivée). */
  FINANCE_CANCEL: 'school.finance.cancel',
  /** Tableau de bord financier, impayés et exports. */
  FINANCE_REPORTS: 'school.finance.reports',
  /** Portail parents (Sprint 6) : inviter un responsable, révoquer son accès. */
  PORTAL_MANAGE: 'school.portal.manage',
  /** Publier aux familles (ou retirer) les résultats validés d'une classe pour une période. */
  RESULTS_PUBLISH: 'school.results.publish',
  /** Consulter les présences ; l'enseignant, seulement pour ses classes. */
  ATTENDANCE_READ: 'school.attendance.read',
  /** Faire l'appel et le corriger (motif obligatoire) ; l'enseignant, seulement pour ses classes. */
  ATTENDANCE_TAKE: 'school.attendance.take',
  /** Enregistrer et examiner les justificatifs d'absence. */
  ATTENDANCE_JUSTIFY: 'school.attendance.justify',
  /** Annonces à tout l'établissement, une classe, des élèves ou des responsables choisis. */
  ANNOUNCEMENTS_MANAGE: 'school.announcements.manage',
  /** Annonces aux familles ; sans ANNOUNCEMENTS_MANAGE, limitées aux classes de l'enseignant. */
  ANNOUNCEMENTS_CLASS: 'school.announcements.class',
  /** Réglages et historique des SMS de l'établissement. */
  SMS_MANAGE: 'school.sms.manage',
  /** Emplois du temps, salles, calendrier et examens publiés (Sprint 7) ; l'enseignant, ses classes. */
  PLANNING_READ: 'school.planning.read',
  /** Préparer les emplois du temps (brouillons, créneaux), salles, indisponibilités, annulations. */
  PLANNING_MANAGE: 'school.planning.manage',
  /** Publier un emploi du temps (le rendre visible et applicable). */
  PLANNING_PUBLISH: 'school.planning.publish',
  /** Événements du calendrier scolaire (vacances, fériés, réunions, sorties…). */
  CALENDAR_MANAGE: 'school.calendar.manage',
  /** Programmer et publier les examens (date, heure, durée, salle, surveillant). */
  EXAMS_MANAGE: 'school.exams.manage',
} as const;
export type SchoolPermission = (typeof SchoolPermission)[keyof typeof SchoolPermission];

const SP = SchoolPermission;
const DIRECTION: readonly SchoolPermission[] = [
  SP.STRUCTURE_READ,
  SP.STRUCTURE_MANAGE,
  SP.MEMBERS_READ,
  SP.MEMBERS_MANAGE,
  SP.GRADING_MANAGE,
  SP.EXPORT,
  SP.STUDENTS_READ,
  SP.STUDENTS_READ_FULL,
  SP.STUDENTS_MANAGE,
  SP.STUDENTS_SENSITIVE,
  SP.MATRICULE_CORRECT,
  SP.STUDENTS_SETTINGS,
  SP.STUDENTS_IMPORT,
  SP.STUDENTS_EXPORT,
  SP.ENROLLMENTS_MANAGE,
  SP.ENROLLMENTS_VALIDATE,
  SP.TRANSFER,
  SP.GUARDIANS_READ,
  SP.GUARDIANS_MANAGE,
  SP.DOCUMENTS_READ,
  SP.DOCUMENTS_MANAGE,
  SP.DOCUMENTS_DELETE,
  SP.TEACHING_READ,
  SP.TEACHING_MANAGE,
  SP.ASSESSMENT_READ,
  SP.ASSESSMENT_MANAGE,
  SP.RESULTS_VALIDATE,
  SP.REPORT_CARDS,
  SP.QURAN_SETTINGS,
  SP.QURAN_READ,
  SP.FINANCE_READ,
  SP.FINANCE_SETTINGS,
  SP.FINANCE_COLLECT,
  SP.FINANCE_BENEFITS,
  SP.FINANCE_CANCEL,
  SP.FINANCE_REPORTS,
  SP.PORTAL_MANAGE,
  SP.RESULTS_PUBLISH,
  SP.ATTENDANCE_READ,
  SP.ATTENDANCE_TAKE,
  SP.ATTENDANCE_JUSTIFY,
  SP.ANNOUNCEMENTS_MANAGE,
  SP.ANNOUNCEMENTS_CLASS,
  SP.SMS_MANAGE,
  SP.PLANNING_READ,
  SP.PLANNING_MANAGE,
  SP.PLANNING_PUBLISH,
  SP.CALENDAR_MANAGE,
  SP.EXAMS_MANAGE,
];

/**
 * Matrice appliquée par l'API. Le secrétariat prépare, la direction valide ; enseignant, surveillant et
 * comptable n'ont que la liste restreinte, et l'enseignant seulement pour ses classes. Notes : la
 * direction gère et valide, le secrétariat consulte et édite les bulletins, l'enseignant saisit pour ses
 * affectations. Mémorisation : l'enseignant de la matière Coran saisit, la direction consulte.
 * Finances : la direction configure, accorde, annule et suit ; la comptabilité encaisse et suit ; le
 * secrétariat consulte, et encaisse seulement si la direction l'a autorisé ; l'enseignant n'y a pas accès.
 * Portail parents, présences, communication (Sprint 6) : la direction gère tout et publie les résultats ;
 * le secrétariat invite les responsables, gère absences, justificatifs et annonces ; le surveillant fait
 * l'appel et examine les justificatifs ; l'enseignant fait l'appel et publie des annonces pour ses classes.
 * Planning (Sprint 7) : le secrétariat prépare emplois du temps, salles, calendrier et examens, la direction
 * publie les emplois du temps ; tout le personnel consulte, l'enseignant seulement ses classes.
 */
export const SCHOOL_ROLE_PERMISSIONS: Record<SchoolRole, readonly SchoolPermission[]> = {
  GROUP_DIRECTOR: [...DIRECTION, SP.SCHOOLS_MANAGE],
  SCHOOL_DIRECTOR: DIRECTION,
  SECRETARY: [
    SP.STRUCTURE_READ,
    SP.MEMBERS_READ,
    SP.STUDENTS_READ,
    SP.STUDENTS_READ_FULL,
    SP.STUDENTS_MANAGE,
    SP.STUDENTS_IMPORT,
    SP.STUDENTS_EXPORT,
    SP.ENROLLMENTS_MANAGE,
    SP.GUARDIANS_READ,
    SP.GUARDIANS_MANAGE,
    SP.DOCUMENTS_READ,
    SP.DOCUMENTS_MANAGE,
    SP.TEACHING_READ,
    SP.ASSESSMENT_READ,
    SP.REPORT_CARDS,
    SP.FINANCE_READ,
    SP.PORTAL_MANAGE,
    SP.ATTENDANCE_READ,
    SP.ATTENDANCE_TAKE,
    SP.ATTENDANCE_JUSTIFY,
    SP.ANNOUNCEMENTS_MANAGE,
    SP.ANNOUNCEMENTS_CLASS,
    SP.PLANNING_READ,
    SP.PLANNING_MANAGE,
    SP.CALENDAR_MANAGE,
    SP.EXAMS_MANAGE,
  ],
  TEACHER: [
    SP.STRUCTURE_READ,
    SP.STUDENTS_READ,
    SP.ASSESSMENT_READ,
    SP.ASSESSMENT_MANAGE,
    SP.QURAN_READ,
    SP.QURAN_MANAGE,
    SP.ATTENDANCE_READ,
    SP.ATTENDANCE_TAKE,
    SP.ANNOUNCEMENTS_CLASS,
    SP.PLANNING_READ,
  ],
  SUPERVISOR: [
    SP.STRUCTURE_READ,
    SP.STUDENTS_READ,
    SP.TEACHING_READ,
    SP.ATTENDANCE_READ,
    SP.ATTENDANCE_TAKE,
    SP.ATTENDANCE_JUSTIFY,
    SP.PLANNING_READ,
  ],
  ACCOUNTANT: [
    SP.STRUCTURE_READ,
    SP.STUDENTS_READ,
    SP.FINANCE_READ,
    SP.FINANCE_COLLECT,
    SP.FINANCE_REPORTS,
    SP.PLANNING_READ,
  ],
};

export function hasSchoolPermission(role: SchoolRole, permission: SchoolPermission): boolean {
  return SCHOOL_ROLE_PERMISSIONS[role].includes(permission);
}

/** Seule la direction du groupe voit tous les établissements ; les autres, ceux qui leur sont affectés. */
export function hasAllSchoolsScope(role: SchoolRole): boolean {
  return role === 'GROUP_DIRECTOR';
}

/** L'enseignant ne voit que les élèves des classes qui lui sont confiées. */
export function isLimitedToOwnClasses(role: SchoolRole): boolean {
  return role === 'TEACHER';
}

/** Un directeur d'établissement n'attribue ni la direction du groupe ni un autre poste de direction. */
export function assignableSchoolRoles(actor: SchoolRole): readonly SchoolRole[] {
  if (actor === 'GROUP_DIRECTOR') return SCHOOL_ROLES;
  if (actor === 'SCHOOL_DIRECTOR') return ['SECRETARY', 'TEACHER', 'SUPERVISOR', 'ACCOUNTANT'];
  return [];
}

// ─── Règles de notation versionnées ───

export const SCHOOL_TIE_RULES = ['SHARED', 'DENSE'] as const;
export type SchoolTieRule = (typeof SCHOOL_TIE_RULES)[number];

/** Absence non justifiée : écartée du calcul (par défaut) ou comptée zéro. Une dispense est toujours écartée. */
export const SCHOOL_ABSENCE_RULES = ['EXCLUDED', 'ZERO'] as const;
export type SchoolAbsenceRule = (typeof SCHOOL_ABSENCE_RULES)[number];

/**
 * Règles de calcul d'un établissement. Chaque modification crée une nouvelle version : des résultats
 * validés gardent les règles avec lesquelles ils ont été calculés. Moteur : `computeClassResults`.
 */
export interface SchoolGradingRules {
  /** Note maximale, ex. 20. */
  scale: number;
  /** Moyenne de passage, entre 0 et `scale`. */
  passMark: number;
  /** Décimales conservées sur les moyennes, de 0 à 3. */
  decimals: number;
  ranking: {
    enabled: boolean;
    /** SHARED : 1, 1, 3 ; DENSE : 1, 1, 2. */
    ties: SchoolTieRule;
    excludedSubjectIds: string[];
  };
  /** Absent des versions antérieures au Sprint 4 : « EXCLUDED » s'applique alors. */
  absences?: SchoolAbsenceRule;
}

export const DEFAULT_SCHOOL_GRADING_RULES: SchoolGradingRules = {
  scale: 20,
  passMark: 10,
  decimals: 2,
  ranking: { enabled: true, ties: 'SHARED', excludedSubjectIds: [] },
  absences: 'EXCLUDED',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Messages d'erreur des règles ; vide si elles sont valides. */
export function validateGradingRules(rules: SchoolGradingRules): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(rules.scale) || rules.scale <= 0 || rules.scale > 1000) {
    errors.push('La note maximale doit être comprise entre 1 et 1000.');
  }
  if (!Number.isFinite(rules.passMark) || rules.passMark < 0 || rules.passMark > rules.scale) {
    errors.push('La moyenne de passage doit être comprise entre 0 et la note maximale.');
  }
  if (!Number.isInteger(rules.decimals) || rules.decimals < 0 || rules.decimals > 3) {
    errors.push('Le nombre de décimales doit être compris entre 0 et 3.');
  }
  if (!SCHOOL_TIE_RULES.includes(rules.ranking?.ties)) {
    errors.push('La règle des ex æquo est invalide.');
  }
  if (typeof rules.ranking?.enabled !== 'boolean') {
    errors.push('L’activation du classement doit être un booléen.');
  }
  const excluded: unknown = rules.ranking?.excludedSubjectIds;
  if (
    excluded !== undefined &&
    (!Array.isArray(excluded) ||
      excluded.length > 200 ||
      excluded.some((id) => typeof id !== 'string' || !UUID.test(id)))
  ) {
    errors.push('Les matières exclues du classement doivent être une liste d’identifiants.');
  }
  if (rules.absences !== undefined && !SCHOOL_ABSENCE_RULES.includes(rules.absences)) {
    errors.push('La règle des absences est invalide.');
  }
  return errors;
}

/** Deux dates AAAA-MM-JJ dans l'ordre, la fin strictement après le début. */
export function isValidDateRange(startsOn: string, endsOn: string): boolean {
  return new Date(startsOn).getTime() < new Date(endsOn).getTime();
}

/** Deux périodes se chevauchent si elles ont au moins un jour commun. */
export function periodsOverlap(
  a: { startsOn: string | Date; endsOn: string | Date },
  b: { startsOn: string | Date; endsOn: string | Date },
): boolean {
  return (
    new Date(a.startsOn).getTime() <= new Date(b.endsOn).getTime() &&
    new Date(b.startsOn).getTime() <= new Date(a.endsOn).getTime()
  );
}
