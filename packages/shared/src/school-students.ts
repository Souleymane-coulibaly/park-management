/**
 * Ocall School, dossiers élèves : statuts, règles d'inscription, matricules, recherche bilingue,
 * documents et import. Partagé par l'API (contrôle) et le frontend (affichage).
 */

export const SCHOOL_STUDENT_STATUSES = [
  'REGISTERED',
  'ENROLLED',
  'TRANSFERRED',
  'LEFT',
  'DROPPED_OUT',
] as const;
export type SchoolStudentStatus = (typeof SCHOOL_STUDENT_STATUSES)[number];

export const SCHOOL_STUDENT_STATUS_LABELS: Record<SchoolStudentStatus, string> = {
  REGISTERED: 'Dossier créé',
  ENROLLED: 'Inscrit',
  TRANSFERRED: 'Transféré',
  LEFT: 'Parti',
  DROPPED_OUT: 'Abandon',
};

export const SCHOOL_SEXES = ['FEMALE', 'MALE'] as const;
export type SchoolSex = (typeof SCHOOL_SEXES)[number];
export const SCHOOL_SEX_LABELS: Record<SchoolSex, string> = { FEMALE: 'Féminin', MALE: 'Masculin' };

// ─── Inscriptions ───

export const SCHOOL_ENROLLMENT_STATUSES = [
  'DRAFT',
  'PENDING',
  'VALIDATED',
  'CANCELLED',
  'ENDED',
] as const;
export type SchoolEnrollmentStatus = (typeof SCHOOL_ENROLLMENT_STATUSES)[number];

export const SCHOOL_ENROLLMENT_STATUS_LABELS: Record<SchoolEnrollmentStatus, string> = {
  DRAFT: 'Brouillon',
  PENDING: 'En attente',
  VALIDATED: 'Validée',
  CANCELLED: 'Annulée',
  ENDED: 'Terminée',
};

export const SCHOOL_EXIT_REASONS = ['TRANSFERRED', 'LEFT', 'DROPPED_OUT'] as const;
export type SchoolExitReason = (typeof SCHOOL_EXIT_REASONS)[number];

export const SCHOOL_EXIT_REASON_LABELS: Record<SchoolExitReason, string> = {
  TRANSFERRED: 'Transfert vers une autre école',
  LEFT: 'Départ',
  DROPPED_OUT: 'Abandon',
};

/**
 * Changements demandés par un utilisateur. ENDED passe par une sortie explicite (transfert, départ,
 * abandon) ; une inscription annulée ou terminée reste figée pour l'historique.
 */
const ENROLLMENT_TRANSITIONS: Record<SchoolEnrollmentStatus, readonly SchoolEnrollmentStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['DRAFT', 'VALIDATED', 'CANCELLED'],
  VALIDATED: ['CANCELLED'],
  CANCELLED: [],
  ENDED: [],
};

export function canTransitionEnrollment(
  from: SchoolEnrollmentStatus,
  to: SchoolEnrollmentStatus,
): boolean {
  return ENROLLMENT_TRANSITIONS[from].includes(to);
}

// ─── Responsables ───

export const SCHOOL_GUARDIAN_RELATIONS = [
  'MOTHER',
  'FATHER',
  'LEGAL_GUARDIAN',
  'GRANDPARENT',
  'SIBLING',
  'OTHER',
] as const;
export type SchoolGuardianRelation = (typeof SCHOOL_GUARDIAN_RELATIONS)[number];

export const SCHOOL_GUARDIAN_RELATION_LABELS: Record<SchoolGuardianRelation, string> = {
  MOTHER: 'Mère',
  FATHER: 'Père',
  LEGAL_GUARDIAN: 'Tuteur légal',
  GRANDPARENT: 'Grand-parent',
  SIBLING: 'Frère ou sœur',
  OTHER: 'Autre',
};

// ─── Matricule ───

export const SCHOOL_MATRICULE_SCOPES = ['SCHOOL', 'GROUP'] as const;
export type SchoolMatriculeScope = (typeof SCHOOL_MATRICULE_SCOPES)[number];

export const SCHOOL_MATRICULE_SCOPE_LABELS: Record<SchoolMatriculeScope, string> = {
  SCHOOL: 'Unique dans l’établissement',
  GROUP: 'Unique dans le groupe scolaire',
};

export interface SchoolMatriculeFormat {
  /** Préfixe en lettres ou chiffres, vide si aucun. Ex. ECO. */
  prefix: string;
  includeYear: boolean;
  /** Nombre de chiffres du compteur, de 3 à 8. */
  padding: number;
}

export const DEFAULT_MATRICULE_FORMAT: SchoolMatriculeFormat = {
  prefix: '',
  includeYear: true,
  padding: 6,
};

/** ECO-2026-0001, BAM-000123, 2026-000045. */
export function buildMatricule(
  format: SchoolMatriculeFormat,
  year: number,
  sequence: number,
): string {
  return [
    format.prefix,
    format.includeYear ? String(year) : '',
    String(sequence).padStart(format.padding, '0'),
  ]
    .filter(Boolean)
    .join('-');
}

const MATRICULE = /^[\p{L}\p{N}][\p{L}\p{N}\-/.]{0,39}$/u;
export const isValidMatricule = (value: string) => MATRICULE.test(value);

// ─── Recherche et doublons ───

/**
 * Forme de recherche d'un nom français ou arabe : sans accents ni voyelles arabes, variantes de l'alif
 * et de la tâ marbûta unifiées. Une saisie sans diacritiques retrouve donc le nom complet.
 */
export function normalizeSearch(value: string): string {
  return (
    value
      .normalize('NFD')
      // Signes combinants retirés un à un : c’est précisément le but de cette classe de caractères.
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\u0300-\u036f\u0610-\u061a\u0640\u064b-\u065f\u0670]/g, '')
      .replace(/[\u0622\u0623\u0625]/g, '\u0627')
      .replace(/\u0649/g, '\u064a')
      .replace(/\u0629/g, '\u0647')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export interface SchoolStudentNames {
  lastName: string;
  firstName: string;
  lastNameAr?: string | null;
  firstNameAr?: string | null;
}

/** Texte interrogé par la recherche : noms dans les deux écritures et matricule. */
export function studentSearchText(names: SchoolStudentNames, matricule: string): string {
  return normalizeSearch(
    [names.lastName, names.firstName, names.lastNameAr, names.firstNameAr, matricule]
      .filter(Boolean)
      .join(' '),
  );
}

/** Clé de détection des doublons : mêmes nom, prénom et date de naissance. */
export function studentIdentityKey(
  names: Pick<SchoolStudentNames, 'lastName' | 'firstName'>,
  birthDate: string,
): string {
  return `${normalizeSearch(names.lastName)}|${normalizeSearch(names.firstName)}|${birthDate}`;
}

// ─── Champs configurables ───

export interface SchoolCustomField {
  key: string;
  label: string;
  labelAr?: string;
}

export const SCHOOL_CUSTOM_FIELDS_MAX = 10;
export const SCHOOL_CUSTOM_VALUE_MAX = 200;

const SENSITIVE_LABEL =
  /religi|confession|ethni|tribu|caste|sante|medical|maladie|handicap|vih|sida|politi|revenu|salaire|biometr/;

/**
 * Un champ libre ne doit pas contourner la minimisation : les données sensibles sont refusées, les
 * besoins particuliers ayant leur propre rubrique protégée.
 */
export function validateCustomFields(fields: readonly SchoolCustomField[]): string[] {
  const errors: string[] = [];
  if (fields.length > SCHOOL_CUSTOM_FIELDS_MAX) {
    errors.push(`${SCHOOL_CUSTOM_FIELDS_MAX} champs complémentaires au plus.`);
  }
  const keys = new Set<string>();
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(field.key)) {
      errors.push(`Clé de champ invalide : ${field.key}.`);
    }
    if (keys.has(field.key)) errors.push(`Clé de champ en double : ${field.key}.`);
    keys.add(field.key);
    const labels = [field.label, field.labelAr ?? ''];
    if (labels.some((l) => typeof l !== 'string' || l.length > 80) || !field.label?.trim()) {
      errors.push(`Libellé invalide pour le champ ${field.key}.`);
      continue;
    }
    if (SENSITIVE_LABEL.test(normalizeSearch(`${field.key} ${field.label}`))) {
      errors.push(`Donnée sensible refusée dans un champ libre : ${field.label}.`);
    }
  }
  return errors;
}

// ─── Documents ───

export const SCHOOL_DOCUMENT_CATEGORIES = [
  'PHOTO',
  'BIRTH_CERTIFICATE',
  'SCHOOL_CERTIFICATE',
  'PREVIOUS_REPORT',
  'TRANSFER_CERTIFICATE',
  'OTHER',
] as const;
export type SchoolDocumentCategory = (typeof SCHOOL_DOCUMENT_CATEGORIES)[number];

export const SCHOOL_DOCUMENT_CATEGORY_LABELS: Record<SchoolDocumentCategory, string> = {
  PHOTO: 'Photo d’identité',
  BIRTH_CERTIFICATE: 'Acte de naissance',
  SCHOOL_CERTIFICATE: 'Certificat de scolarité',
  PREVIOUS_REPORT: 'Bulletin antérieur',
  TRANSFER_CERTIFICATE: 'Attestation de transfert',
  OTHER: 'Autre pièce administrative',
};

export const SCHOOL_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SCHOOL_DOCUMENTS_PER_STUDENT = 30;

/** Une photo d'identité n'est jamais un PDF. */
export function isDocumentTypeAllowed(category: SchoolDocumentCategory, mimeType: string): boolean {
  const image = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
  return category === 'PHOTO' ? image : image || mimeType === 'application/pdf';
}

/** Contenu actif d'un PDF (script, lancement) : refusé. Le fichier est aussi servi en pièce jointe. */
export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  // Un nom PDF peut être écrit avec des échappements : /J#61vaScript vaut /JavaScript.
  const text = new TextDecoder('latin1')
    .decode(bytes)
    .replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(text);
}

// ─── Import ───

export const SCHOOL_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const SCHOOL_IMPORT_MAX_ROWS = 1000;

export const SCHOOL_IMPORT_FIELDS = {
  matricule: ['matricule', 'numero', 'n matricule', 'student id', 'الرقم'],
  lastName: ['nom', 'nom de famille', 'last name', 'اللقب'],
  firstName: ['prenom', 'prenoms', 'first name', 'الاسم'],
  lastNameAr: ['nom arabe', 'nom en arabe', 'اللقب بالعربية'],
  firstNameAr: ['prenom arabe', 'prenom en arabe', 'الاسم بالعربية'],
  birthDate: ['date de naissance', 'naissance', 'ne le', 'birth date', 'تاريخ الميلاد'],
  birthPlace: ['lieu de naissance', 'birth place', 'مكان الميلاد'],
  sex: ['sexe', 'sex', 'الجنس'],
  nationality: ['nationalite', 'nationality', 'الجنسية'],
  address: ['adresse', 'address', 'العنوان'],
  level: ['niveau', 'level', 'المستوى'],
  class: ['classe', 'class', 'الفصل', 'القسم'],
  guardianLastName: ['nom du responsable', 'nom parent', 'nom tuteur', 'guardian last name'],
  guardianFirstName: ['prenom du responsable', 'prenom parent', 'prenom tuteur'],
  guardianPhone: ['telephone', 'telephone parent', 'telephone du responsable', 'contact', 'phone'],
} as const;
export type SchoolImportField = keyof typeof SCHOOL_IMPORT_FIELDS;

export const SCHOOL_IMPORT_FIELD_LABELS: Record<SchoolImportField, string> = {
  matricule: 'Matricule',
  lastName: 'Nom',
  firstName: 'Prénom',
  lastNameAr: 'Nom en arabe',
  firstNameAr: 'Prénom en arabe',
  birthDate: 'Date de naissance',
  birthPlace: 'Lieu de naissance',
  sex: 'Sexe',
  nationality: 'Nationalité',
  address: 'Adresse',
  level: 'Niveau',
  class: 'Classe',
  guardianLastName: 'Nom du responsable',
  guardianFirstName: 'Prénom du responsable',
  guardianPhone: 'Téléphone du responsable',
};

export type SchoolImportMapping = Partial<Record<SchoolImportField, string>>;

/** Correspondance proposée d'après les en-têtes du fichier ; modifiable avant l'import. */
export function suggestImportMapping(headers: readonly string[]): SchoolImportMapping {
  const mapping: SchoolImportMapping = {};
  for (const field of Object.keys(SCHOOL_IMPORT_FIELDS) as SchoolImportField[]) {
    const synonyms = SCHOOL_IMPORT_FIELDS[field].map(normalizeSearch);
    const header = headers.find((h) => synonyms.includes(normalizeSearch(h)));
    if (header) mapping[field] = header;
  }
  return mapping;
}

/** AAAA-MM-JJ ou JJ/MM/AAAA vers AAAA-MM-JJ ; null si la date n'existe pas au calendrier. */
export function parseSchoolDate(value: string): string | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [y, m, d] = iso
    ? [iso[1]!, iso[2]!, iso[3]!]
    : local
      ? [local[3]!, local[2]!.padStart(2, '0'), local[1]!.padStart(2, '0')]
      : [];
  if (!y || !m || !d) return null;
  const day = `${y}-${m}-${d}`;
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day) ? day : null;
}

/** Accepte F, M et les libellés français, anglais et arabes ; null si la valeur n'est pas reconnue. */
export function parseSchoolSex(value: string): SchoolSex | null {
  const text = normalizeSearch(value);
  if (['f', 'feminin', 'female', 'fille', 'انثي'].includes(text)) return 'FEMALE';
  if (['m', 'masculin', 'male', 'garcon', 'ذكر'].includes(text)) return 'MALE';
  return null;
}

export const SCHOOL_PHONE = /^\+?[0-9][0-9 ().-]{5,19}$/;
