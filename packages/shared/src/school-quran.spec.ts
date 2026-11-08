import {
  QURAN_SURAHS,
  QURAN_SURAH_COUNT,
  findSurah,
  quranModuleActive,
  quranModuleAvailable,
  quranProgressFromHistory,
  quranProgressSummary,
  quranSurahStates,
} from './school-quran';

describe('Ocall School — catalogue des sourates', () => {
  it('114 sourates numérotées de 1 à 114, 6 236 versets', () => {
    expect(QURAN_SURAHS).toHaveLength(QURAN_SURAH_COUNT);
    QURAN_SURAHS.forEach((s, i) => expect(s.number).toBe(i + 1));
    expect(QURAN_SURAHS.reduce((sum, s) => sum + s.verses, 0)).toBe(6236);
  });

  it('nom arabe et translittération renseignés pour chaque sourate', () => {
    for (const s of QURAN_SURAHS) {
      expect(s.nameAr).toMatch(/^[؀-ۿ ]+$/);
      expect(s.transliteration).toMatch(/^[A-Za-z' -]+$/);
      expect(s.verses).toBeGreaterThan(0);
    }
  });

  it('repères de contrôle', () => {
    expect(findSurah(1)).toMatchObject({ nameAr: 'الفاتحة', verses: 7 });
    expect(findSurah(2)).toMatchObject({ nameAr: 'البقرة', verses: 286 });
    expect(findSurah(112)).toMatchObject({ nameAr: 'الإخلاص', verses: 4 });
    expect(findSurah(114)).toMatchObject({ nameAr: 'الناس', verses: 6 });
    expect(findSurah(0)).toBeUndefined();
    expect(findSurah(115)).toBeUndefined();
    expect(findSurah(1.5)).toBeUndefined();
  });
});

describe('Ocall School — activation du module', () => {
  it('disponible seulement en Bilingue, actif seulement si la direction l’a activé', () => {
    expect(quranModuleAvailable('BILINGUAL')).toBe(true);
    expect(quranModuleAvailable('FR')).toBe(false);
    expect(quranModuleAvailable('AR')).toBe(false);
    expect(quranModuleActive('BILINGUAL', true)).toBe(true);
    expect(quranModuleActive('BILINGUAL', false)).toBe(false);
    // Passé en Français après activation : masqué, sans rien supprimer.
    expect(quranModuleActive('FR', true)).toBe(false);
  });
});

describe('Ocall School — historique et progression d’une sourate', () => {
  const at = (evaluatedOn: string, status: string, sequence = 0) => ({
    evaluatedOn,
    status: status as 'NOT_STARTED' | 'IN_PROGRESS' | 'MEMORIZED' | 'TO_REVIEW',
    sequence,
  });

  it('sans historique : non commencée', () => {
    expect(quranProgressFromHistory([])).toEqual({
      status: 'NOT_STARTED',
      memorizedOn: null,
      lastReviewedOn: null,
    });
  });

  it('mémorisation puis révisions : date de mémorisation conservée, dernière révision', () => {
    expect(
      quranProgressFromHistory([
        at('2026-10-01', 'IN_PROGRESS'),
        at('2026-10-10', 'MEMORIZED'),
        at('2026-11-01', 'TO_REVIEW'),
        at('2026-11-08', 'MEMORIZED'),
      ]),
    ).toEqual({ status: 'MEMORIZED', memorizedOn: '2026-10-10', lastReviewedOn: '2026-11-08' });
  });

  it('l’ordre de saisie n’importe pas : une évaluation antidatée prend sa place', () => {
    const late = quranProgressFromHistory([
      at('2026-11-08', 'MEMORIZED', 1),
      at('2026-10-10', 'IN_PROGRESS', 2),
    ]);
    expect(late).toEqual({ status: 'MEMORIZED', memorizedOn: '2026-11-08', lastReviewedOn: null });
  });

  it('deux évaluations le même jour : la dernière enregistrée (numéro d’ordre) l’emporte', () => {
    expect(
      quranProgressFromHistory([
        at('2026-10-10', 'MEMORIZED', 2),
        at('2026-10-10', 'IN_PROGRESS', 1),
      ]).status,
    ).toBe('MEMORIZED');
  });

  it('retour à « En cours » : la sourate n’est plus mémorisée, les dates s’effacent', () => {
    expect(
      quranProgressFromHistory([at('2026-10-10', 'MEMORIZED'), at('2026-11-10', 'IN_PROGRESS')]),
    ).toEqual({ status: 'IN_PROGRESS', memorizedOn: null, lastReviewedOn: null });
  });

  it('vue en lecture seule : 114 sourates, statut et dates seulement', () => {
    const states = quranSurahStates([
      { surah: 112, status: 'MEMORIZED', memorizedOn: '2026-10-10', lastReviewedOn: null },
    ]);
    expect(states).toHaveLength(114);
    expect(states[111]).toEqual({
      number: 112,
      nameAr: 'الإخلاص',
      transliteration: expect.any(String),
      verses: 4,
      status: 'MEMORIZED',
      memorizedOn: '2026-10-10',
      lastReviewedOn: null,
    });
    expect(states[0]!.status).toBe('NOT_STARTED');
    expect(Object.keys(states[0]!)).not.toContain('remark');
  });

  it('synthèse : sourates par statut et versets mémorisés', () => {
    const summary = quranProgressSummary([
      { surah: 1, status: 'MEMORIZED' },
      { surah: 114, status: 'TO_REVIEW' },
      { surah: 2, status: 'IN_PROGRESS' },
    ]);
    expect(summary.counts).toEqual({
      NOT_STARTED: 111,
      IN_PROGRESS: 1,
      MEMORIZED: 1,
      TO_REVIEW: 1,
    });
    expect(summary.memorizedVerses).toBe(13);
    expect(summary.totalVerses).toBe(6236);
  });
});
