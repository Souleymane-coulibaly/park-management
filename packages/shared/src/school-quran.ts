/**
 * Ocall School, module facultatif « Mémorisation du Coran » (Sprint 4). Réservé aux établissements en
 * Bilingue qui l'ont activé ; masqué partout ailleurs, interface et API. Suivi sourate par sourate, sans
 * suivi verset par verset. Ces données restent séparées des notes : elles n'entrent dans aucune moyenne.
 */
import type { SchoolLocale } from './school';

export interface QuranSurah {
  number: number;
  nameAr: string;
  /** Translittération affichée en français. */
  transliteration: string;
  verses: number;
}

/**
 * Catalogue de référence des 114 sourates : numéro, nom arabe, translittération et nombre de versets,
 * générés depuis les métadonnées Tanzil (tanzil.net/res/text/metadata/quran-data.js, version 1.0.2,
 * licence CC BY 3.0). Vérifié par les tests : 114 sourates numérotées de 1 à 114, 6 236 versets.
 */
const SURAH_ROWS: readonly (readonly [number, string, string, number])[] = [
  [1, 'الفاتحة', 'Al-Faatiha', 7],
  [2, 'البقرة', 'Al-Baqara', 286],
  [3, 'آل عمران', 'Aal-i-Imraan', 200],
  [4, 'النساء', 'An-Nisaa', 176],
  [5, 'المائدة', 'Al-Maaida', 120],
  [6, 'الأنعام', "Al-An'aam", 165],
  [7, 'الأعراف', "Al-A'raaf", 206],
  [8, 'الأنفال', 'Al-Anfaal', 75],
  [9, 'التوبة', 'At-Tawba', 129],
  [10, 'يونس', 'Yunus', 109],
  [11, 'هود', 'Hud', 123],
  [12, 'يوسف', 'Yusuf', 111],
  [13, 'الرعد', "Ar-Ra'd", 43],
  [14, 'ابراهيم', 'Ibrahim', 52],
  [15, 'الحجر', 'Al-Hijr', 99],
  [16, 'النحل', 'An-Nahl', 128],
  [17, 'الإسراء', 'Al-Israa', 111],
  [18, 'الكهف', 'Al-Kahf', 110],
  [19, 'مريم', 'Maryam', 98],
  [20, 'طه', 'Taa-Haa', 135],
  [21, 'الأنبياء', 'Al-Anbiyaa', 112],
  [22, 'الحج', 'Al-Hajj', 78],
  [23, 'المؤمنون', 'Al-Muminoon', 118],
  [24, 'النور', 'An-Noor', 64],
  [25, 'الفرقان', 'Al-Furqaan', 77],
  [26, 'الشعراء', "Ash-Shu'araa", 227],
  [27, 'النمل', 'An-Naml', 93],
  [28, 'القصص', 'Al-Qasas', 88],
  [29, 'العنكبوت', 'Al-Ankaboot', 69],
  [30, 'الروم', 'Ar-Room', 60],
  [31, 'لقمان', 'Luqman', 34],
  [32, 'السجدة', 'As-Sajda', 30],
  [33, 'الأحزاب', 'Al-Ahzaab', 73],
  [34, 'سبإ', 'Saba', 54],
  [35, 'فاطر', 'Faatir', 45],
  [36, 'يس', 'Yaseen', 83],
  [37, 'الصافات', 'As-Saaffaat', 182],
  [38, 'ص', 'Saad', 88],
  [39, 'الزمر', 'Az-Zumar', 75],
  [40, 'غافر', 'Al-Ghaafir', 85],
  [41, 'فصلت', 'Fussilat', 54],
  [42, 'الشورى', 'Ash-Shura', 53],
  [43, 'الزخرف', 'Az-Zukhruf', 89],
  [44, 'الدخان', 'Ad-Dukhaan', 59],
  [45, 'الجاثية', 'Al-Jaathiya', 37],
  [46, 'الأحقاف', 'Al-Ahqaf', 35],
  [47, 'محمد', 'Muhammad', 38],
  [48, 'الفتح', 'Al-Fath', 29],
  [49, 'الحجرات', 'Al-Hujuraat', 18],
  [50, 'ق', 'Qaaf', 45],
  [51, 'الذاريات', 'Adh-Dhaariyat', 60],
  [52, 'الطور', 'At-Tur', 49],
  [53, 'النجم', 'An-Najm', 62],
  [54, 'القمر', 'Al-Qamar', 55],
  [55, 'الرحمن', 'Ar-Rahmaan', 78],
  [56, 'الواقعة', 'Al-Waaqia', 96],
  [57, 'الحديد', 'Al-Hadid', 29],
  [58, 'المجادلة', 'Al-Mujaadila', 22],
  [59, 'الحشر', 'Al-Hashr', 24],
  [60, 'الممتحنة', 'Al-Mumtahana', 13],
  [61, 'الصف', 'As-Saff', 14],
  [62, 'الجمعة', "Al-Jumu'a", 11],
  [63, 'المنافقون', 'Al-Munaafiqoon', 11],
  [64, 'التغابن', 'At-Taghaabun', 18],
  [65, 'الطلاق', 'At-Talaaq', 12],
  [66, 'التحريم', 'At-Tahrim', 12],
  [67, 'الملك', 'Al-Mulk', 30],
  [68, 'القلم', 'Al-Qalam', 52],
  [69, 'الحاقة', 'Al-Haaqqa', 52],
  [70, 'المعارج', "Al-Ma'aarij", 44],
  [71, 'نوح', 'Nooh', 28],
  [72, 'الجن', 'Al-Jinn', 28],
  [73, 'المزمل', 'Al-Muzzammil', 20],
  [74, 'المدثر', 'Al-Muddaththir', 56],
  [75, 'القيامة', 'Al-Qiyaama', 40],
  [76, 'الانسان', 'Al-Insaan', 31],
  [77, 'المرسلات', 'Al-Mursalaat', 50],
  [78, 'النبإ', 'An-Naba', 40],
  [79, 'النازعات', "An-Naazi'aat", 46],
  [80, 'عبس', 'Abasa', 42],
  [81, 'التكوير', 'At-Takwir', 29],
  [82, 'الإنفطار', 'Al-Infitaar', 19],
  [83, 'المطففين', 'Al-Mutaffifin', 36],
  [84, 'الإنشقاق', 'Al-Inshiqaaq', 25],
  [85, 'البروج', 'Al-Burooj', 22],
  [86, 'الطارق', 'At-Taariq', 17],
  [87, 'الأعلى', "Al-A'laa", 19],
  [88, 'الغاشية', 'Al-Ghaashiya', 26],
  [89, 'الفجر', 'Al-Fajr', 30],
  [90, 'البلد', 'Al-Balad', 20],
  [91, 'الشمس', 'Ash-Shams', 15],
  [92, 'الليل', 'Al-Lail', 21],
  [93, 'الضحى', 'Ad-Dhuhaa', 11],
  [94, 'الشرح', 'Ash-Sharh', 8],
  [95, 'التين', 'At-Tin', 8],
  [96, 'العلق', 'Al-Alaq', 19],
  [97, 'القدر', 'Al-Qadr', 5],
  [98, 'البينة', 'Al-Bayyina', 8],
  [99, 'الزلزلة', 'Az-Zalzala', 8],
  [100, 'العاديات', 'Al-Aadiyaat', 11],
  [101, 'القارعة', "Al-Qaari'a", 11],
  [102, 'التكاثر', 'At-Takaathur', 8],
  [103, 'العصر', 'Al-Asr', 3],
  [104, 'الهمزة', 'Al-Humaza', 9],
  [105, 'الفيل', 'Al-Fil', 5],
  [106, 'قريش', 'Quraish', 4],
  [107, 'الماعون', "Al-Maa'un", 7],
  [108, 'الكوثر', 'Al-Kawthar', 3],
  [109, 'الكافرون', 'Al-Kaafiroon', 6],
  [110, 'النصر', 'An-Nasr', 3],
  [111, 'المسد', 'Al-Masad', 5],
  [112, 'الإخلاص', 'Al-Ikhlaas', 4],
  [113, 'الفلق', 'Al-Falaq', 5],
  [114, 'الناس', 'An-Naas', 6],
];

export const QURAN_SURAHS: readonly QuranSurah[] = SURAH_ROWS.map(
  ([number, nameAr, transliteration, verses]) => ({ number, nameAr, transliteration, verses }),
);

export const QURAN_SURAH_COUNT = 114;

export function findSurah(number: number): QuranSurah | undefined {
  return Number.isInteger(number) ? QURAN_SURAHS[number - 1] : undefined;
}

export const QURAN_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'MEMORIZED', 'TO_REVIEW'] as const;
export type QuranStatus = (typeof QURAN_STATUSES)[number];

export const QURAN_STATUS_LABELS: Record<QuranStatus, string> = {
  NOT_STARTED: 'Non commencée',
  IN_PROGRESS: 'En cours',
  MEMORIZED: 'Mémorisée',
  TO_REVIEW: 'À réviser',
};

/** Le module n'existe que pour un établissement en Bilingue ; en Français ou en Arabe, il reste masqué. */
export function quranModuleAvailable(locale: SchoolLocale): boolean {
  return locale === 'BILINGUAL';
}

/** Actif : disponible pour la langue de l'établissement et activé explicitement par la direction. */
export function quranModuleActive(locale: SchoolLocale, enabled: boolean): boolean {
  return enabled && quranModuleAvailable(locale);
}

export interface QuranEvaluationEntry {
  status: QuranStatus;
  /** Date AAAA-MM-JJ de l'évaluation. */
  evaluatedOn: string;
  /** Ordre d'enregistrement pour l'élève et la sourate : départage deux évaluations du même jour. */
  sequence: number;
}

export interface QuranProgressState {
  status: QuranStatus;
  memorizedOn: string | null;
  lastReviewedOn: string | null;
}

/**
 * État d'une sourate déduit de tout son historique, quel que soit l'ordre de saisie : le statut de la
 * dernière évaluation ; la date de mémorisation est celle de la première évaluation « Mémorisée » de la
 * mémorisation en cours ; la révision, la dernière évaluation qui la suit. Revenir à « Non commencée » ou
 * « En cours » efface ces dates : la sourate n'est plus considérée comme mémorisée.
 */
export function quranProgressFromHistory(
  history: readonly QuranEvaluationEntry[],
): QuranProgressState {
  const ordered = [...history].sort(
    (a, b) => a.evaluatedOn.localeCompare(b.evaluatedOn) || a.sequence - b.sequence,
  );
  let state: QuranProgressState = {
    status: 'NOT_STARTED',
    memorizedOn: null,
    lastReviewedOn: null,
  };
  for (const entry of ordered) {
    if (entry.status === 'NOT_STARTED' || entry.status === 'IN_PROGRESS') {
      state = { status: entry.status, memorizedOn: null, lastReviewedOn: null };
    } else if (state.memorizedOn === null) {
      // « À réviser » sans mémorisation préalable : la sourate est tenue pour mémorisée ce jour-là.
      state = { status: entry.status, memorizedOn: entry.evaluatedOn, lastReviewedOn: null };
    } else {
      state = { ...state, status: entry.status, lastReviewedOn: entry.evaluatedOn };
    }
  }
  return state;
}

export interface QuranSurahState extends QuranSurah, QuranProgressState {}

/**
 * Vue en lecture seule des 114 sourates d'un élève : statut et dates, sans remarque ni évaluateur. Base
 * de l'écran de progression et, plus tard, de la consultation par les parents (portail non activé).
 */
export function quranSurahStates(
  progress: readonly ({ surah: number } & QuranProgressState)[],
): QuranSurahState[] {
  const bySurah = new Map(progress.map((p) => [p.surah, p]));
  return QURAN_SURAHS.map((surah) => {
    const p = bySurah.get(surah.number);
    return {
      ...surah,
      status: p?.status ?? 'NOT_STARTED',
      memorizedOn: p?.memorizedOn ?? null,
      lastReviewedOn: p?.lastReviewedOn ?? null,
    };
  });
}

export interface QuranProgressSummary {
  counts: Record<QuranStatus, number>;
  /** Versets des sourates mémorisées ou à réviser, sur 6 236. */
  memorizedVerses: number;
  totalVerses: number;
}

/** Synthèse d'un élève ; une sourate absente de la liste est « Non commencée ». */
export function quranProgressSummary(
  entries: readonly { surah: number; status: QuranStatus }[],
): QuranProgressSummary {
  const counts: Record<QuranStatus, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    MEMORIZED: 0,
    TO_REVIEW: 0,
  };
  const bySurah = new Map(entries.map((e) => [e.surah, e.status]));
  let memorizedVerses = 0;
  for (const surah of QURAN_SURAHS) {
    const status = bySurah.get(surah.number) ?? 'NOT_STARTED';
    counts[status] += 1;
    if (status === 'MEMORIZED' || status === 'TO_REVIEW') memorizedVerses += surah.verses;
  }
  return {
    counts,
    memorizedVerses,
    totalVerses: QURAN_SURAHS.reduce((sum, s) => sum + s.verses, 0),
  };
}
