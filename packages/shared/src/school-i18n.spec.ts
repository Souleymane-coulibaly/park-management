import { SCHOOL_LOCALES } from './school';
import {
  SCHOOL_ERROR_MESSAGES_AR,
  SCHOOL_EXPORT_COLUMNS,
  SCHOOL_IMPORT_ISSUES_AR,
  SCHOOL_TEXT_AR,
  SCHOOL_TEXT_FR,
  type SchoolTextKey,
  schoolDisplayName,
  schoolErrorMessage,
  schoolExportLabel,
  schoolImportIssueMessage,
  schoolLabels,
  schoolShowsArabic,
  schoolText,
  schoolUiLanguage,
} from './school-i18n';

const ARABIC = /[؀-ۿ]/;

describe('Ocall School — langues', () => {
  it('le français est la langue par défaut ; seul Arabe donne une interface arabe', () => {
    expect(schoolUiLanguage('FR')).toBe('fr');
    expect(schoolUiLanguage('BILINGUAL')).toBe('fr');
    expect(schoolUiLanguage('AR')).toBe('ar');
  });

  it("les champs arabes ne s'affichent jamais pour un établissement francophone", () => {
    expect(schoolShowsArabic('FR')).toBe(false);
    expect(schoolShowsArabic('AR')).toBe(true);
    expect(schoolShowsArabic('BILINGUAL')).toBe(true);
  });

  it('libellé : arabe prioritaire en Arabe, les deux en Bilingue, français seul en Français', () => {
    const item = { name: 'CP1', nameAr: 'السنة الأولى' };
    expect(schoolDisplayName('AR', item)).toBe('السنة الأولى');
    expect(schoolDisplayName('BILINGUAL', item)).toBe('CP1 / السنة الأولى');
    expect(schoolDisplayName('FR', item)).toBe('CP1');
    expect(schoolDisplayName('AR', { name: 'CP1', nameAr: null })).toBe('CP1');
  });

  it('chaque texte a une traduction arabe non vide, écrite en arabe', () => {
    const keys = Object.keys(SCHOOL_TEXT_FR) as SchoolTextKey[];
    expect(Object.keys(SCHOOL_TEXT_AR).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const text = schoolText('ar', key, { n: 3, label: '2026', name: 'A', school: 'B' });
      expect(text.trim()).not.toBe('');
      expect(text).toMatch(ARABIC);
    }
  });

  it('remplace les variables et accorde le pluriel français', () => {
    expect(schoolText('fr', 'dash.year', { label: '2026-2027' })).toBe('Année 2026-2027');
    expect(schoolText('fr', 'students.count', { n: 1 })).toBe('1 élève');
    expect(schoolText('fr', 'students.count', { n: 26 })).toBe('26 élèves');
    expect(schoolText('fr', 'enroll.count', { n: 2 })).toBe('2 inscriptions');
    expect(schoolText('ar', 'students.count', { n: 26 })).toBe('عدد التلاميذ: 26');
    // Variable absente : le repère reste visible plutôt qu'un texte faux.
    expect(schoolText('fr', 'dash.year')).toBe('Année {label}');
    // Clé tirée d'une donnée et inconnue : renvoyée telle quelle, sans erreur.
    expect(schoolText('ar', 'sheet.event.NOUVEAU' as never)).toBe('sheet.event.NOUVEAU');
  });

  it('les libellés des listes de valeurs existent dans les deux langues', () => {
    const fr = schoolLabels('fr');
    const ar = schoolLabels('ar');
    for (const group of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(Object.keys(ar[group]).sort()).toEqual(Object.keys(fr[group]).sort());
      for (const label of Object.values(ar[group])) expect(label).toMatch(ARABIC);
    }
    expect(fr.studentStatus.ENROLLED).toBe('Inscrit');
    expect(ar.studentStatus.ENROLLED).toBe('مسجّل');
  });

  it("l'erreur reste celle de l'API en français, et se traduit en arabe quand le code est connu", () => {
    expect(schoolErrorMessage('fr', 'CLASS_FULL', 'La classe est complète.')).toBe(
      'La classe est complète.',
    );
    expect(schoolErrorMessage('ar', 'CLASS_FULL', 'La classe est complète.')).toBe(
      SCHOOL_ERROR_MESSAGES_AR.CLASS_FULL,
    );
    expect(schoolErrorMessage('ar', 'CODE_INCONNU', 'Message de l’API')).toBe('Message de l’API');
  });

  it("une anomalie d'import se lit en arabe, avec son champ ; le français garde le message du serveur", () => {
    const issue = { code: 'DATE_INVALID', field: 'birthDate' as const, message: 'Date absente.' };
    expect(schoolImportIssueMessage('fr', issue)).toBe('Date absente.');
    expect(schoolImportIssueMessage('ar', issue)).toBe(
      `تاريخ الميلاد: ${SCHOOL_IMPORT_ISSUES_AR.DATE_INVALID}`,
    );
    expect(schoolImportIssueMessage('ar', { code: 'INCONNU', message: 'Message' })).toBe('Message');
  });

  it("les en-têtes d'export suivent la langue de l'établissement", () => {
    expect(schoolExportLabel('FR', 'lastName')).toBe('Nom');
    expect(schoolExportLabel('AR', 'lastName')).toBe('اللقب');
    expect(schoolExportLabel('BILINGUAL', 'lastName')).toBe('Nom / اللقب');
    for (const locale of SCHOOL_LOCALES) {
      for (const column of Object.keys(
        SCHOOL_EXPORT_COLUMNS,
      ) as (keyof typeof SCHOOL_EXPORT_COLUMNS)[]) {
        expect(schoolExportLabel(locale, column)).not.toBe('');
      }
    }
  });
});
