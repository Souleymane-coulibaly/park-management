/**
 * Ocall School, équipe pédagogique (Sprint 3B) : catalogue commun des matières, règles des affectations.
 * Partagé par l'API (contrôle) et le frontend (affichage).
 */

export interface SchoolCatalogSubject {
  key: string;
  name: string;
  nameAr: string;
  /** Matière religieuse : jamais proposée d'office, activée seulement si l'établissement le choisit. */
  isReligious: boolean;
}

/**
 * Catalogue commun Ocall. Un établissement active les matières qu'il enseigne : une copie lui est créée,
 * qu'il adapte (libellés, coefficient, niveaux) sans toucher au catalogue ni aux autres écoles.
 */
export const SCHOOL_SUBJECT_CATALOG: readonly SchoolCatalogSubject[] = [
  { key: 'francais', name: 'Français', nameAr: 'اللغة الفرنسية', isReligious: false },
  { key: 'mathematiques', name: 'Mathématiques', nameAr: 'الرياضيات', isReligious: false },
  { key: 'arabe', name: 'Langue arabe', nameAr: 'اللغة العربية', isReligious: false },
  { key: 'anglais', name: 'Anglais', nameAr: 'اللغة الإنجليزية', isReligious: false },
  { key: 'sciences', name: 'Sciences', nameAr: 'العلوم', isReligious: false },
  {
    key: 'svt',
    name: 'Sciences de la vie et de la Terre',
    nameAr: 'علوم الحياة والأرض',
    isReligious: false,
  },
  {
    key: 'physique_chimie',
    name: 'Physique-chimie',
    nameAr: 'الفيزياء والكيمياء',
    isReligious: false,
  },
  {
    key: 'histoire_geographie',
    name: 'Histoire-géographie',
    nameAr: 'التاريخ والجغرافيا',
    isReligious: false,
  },
  {
    key: 'education_civique',
    name: 'Éducation civique et morale',
    nameAr: 'التربية المدنية والأخلاقية',
    isReligious: false,
  },
  { key: 'philosophie', name: 'Philosophie', nameAr: 'الفلسفة', isReligious: false },
  { key: 'informatique', name: 'Informatique', nameAr: 'الإعلامية', isReligious: false },
  { key: 'arts', name: 'Arts plastiques', nameAr: 'التربية الفنية', isReligious: false },
  { key: 'musique', name: 'Musique', nameAr: 'التربية الموسيقية', isReligious: false },
  {
    key: 'eps',
    name: 'Éducation physique et sportive',
    nameAr: 'التربية البدنية والرياضية',
    isReligious: false,
  },
  { key: 'coran', name: 'Coran', nameAr: 'القرآن الكريم', isReligious: true },
  {
    key: 'education_islamique',
    name: 'Éducation islamique',
    nameAr: 'التربية الإسلامية',
    isReligious: true,
  },
  { key: 'fiqh', name: 'Fiqh', nameAr: 'الفقه', isReligious: true },
  { key: 'hadith', name: 'Hadith', nameAr: 'الحديث', isReligious: true },
];

export function findCatalogSubject(key: string): SchoolCatalogSubject | undefined {
  return SCHOOL_SUBJECT_CATALOG.find((s) => s.key === key);
}

/** Motif d'une fin d'affectation : facultatif, borné, jamais une donnée sur l'enseignant. */
export const SCHOOL_TEACHING_REASON_MAX = 200;
