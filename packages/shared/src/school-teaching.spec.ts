import { SCHOOL_SUBJECT_CATALOG, findCatalogSubject } from './school-teaching';

describe('Ocall School — catalogue commun des matières', () => {
  it('clés uniques et techniques, libellés français et arabes renseignés', () => {
    const keys = SCHOOL_SUBJECT_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const subject of SCHOOL_SUBJECT_CATALOG) {
      expect(subject.key).toMatch(/^[a-z][a-z_]*$/);
      expect(subject.name.trim()).not.toBe('');
      expect(subject.nameAr).toMatch(/[؀-ۿ]/);
    }
  });

  it('les matières religieuses sont signalées, pour n’être activées que sur choix de l’école', () => {
    expect(findCatalogSubject('coran')?.isReligious).toBe(true);
    expect(findCatalogSubject('mathematiques')?.isReligious).toBe(false);
    expect(findCatalogSubject('inconnue')).toBeUndefined();
  });
});
