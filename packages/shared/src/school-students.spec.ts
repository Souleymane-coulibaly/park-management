import {
  buildMatricule,
  canTransitionEnrollment,
  customFieldKey,
  hasSchoolPermission,
  isDocumentTypeAllowed,
  isLimitedToOwnClasses,
  isSensitiveFieldLabel,
  isValidMatricule,
  normalizeSearch,
  parseSchoolDate,
  parseSchoolSex,
  pdfHasActiveContent,
  studentIdentityKey,
  suggestImportMapping,
  validateCustomFields,
} from './index';

describe('matricule', () => {
  it('produit les formats demandés', () => {
    expect(buildMatricule({ prefix: 'ECO', includeYear: true, padding: 4 }, 2026, 1)).toBe(
      'ECO-2026-0001',
    );
    expect(buildMatricule({ prefix: 'BAM', includeYear: false, padding: 6 }, 2026, 123)).toBe(
      'BAM-000123',
    );
    expect(buildMatricule({ prefix: '', includeYear: true, padding: 6 }, 2026, 45)).toBe(
      '2026-000045',
    );
  });

  it('ne tronque pas un compteur plus long que le format', () => {
    expect(buildMatricule({ prefix: 'A', includeYear: false, padding: 3 }, 2026, 12345)).toBe(
      'A-12345',
    );
  });

  it('refuse un matricule dangereux', () => {
    expect(isValidMatricule('ECO-2026/01')).toBe(true);
    expect(isValidMatricule('=cmd()')).toBe(false);
    expect(isValidMatricule('a b')).toBe(false);
  });
});

describe('inscriptions', () => {
  it('suit les transitions autorisées', () => {
    expect(canTransitionEnrollment('DRAFT', 'PENDING')).toBe(true);
    expect(canTransitionEnrollment('PENDING', 'VALIDATED')).toBe(true);
    expect(canTransitionEnrollment('VALIDATED', 'CANCELLED')).toBe(true);
  });

  it('interdit de sauter la soumission et de sortir d’un état final', () => {
    expect(canTransitionEnrollment('DRAFT', 'VALIDATED')).toBe(false);
    expect(canTransitionEnrollment('CANCELLED', 'DRAFT')).toBe(false);
    expect(canTransitionEnrollment('ENDED', 'VALIDATED')).toBe(false);
    expect(canTransitionEnrollment('VALIDATED', 'ENDED')).toBe(false);
  });
});

describe('recherche bilingue', () => {
  it('ignore les accents français', () => {
    expect(normalizeSearch('  TRAORÉ   Aïssata ')).toBe('traore aissata');
  });

  it('retrouve un nom arabe sans voyelles ni variantes d’alif', () => {
    expect(normalizeSearch('أَحْمَد')).toBe(normalizeSearch('احمد'));
    expect(normalizeSearch('إبراهيم')).toBe(normalizeSearch('ابراهيم'));
    expect(normalizeSearch('فاطمة')).toBe(normalizeSearch('فاطمه'));
  });

  it('détecte un doublon malgré la casse et les accents', () => {
    expect(studentIdentityKey({ lastName: 'Traoré', firstName: 'Awa' }, '2015-01-02')).toBe(
      studentIdentityKey({ lastName: 'TRAORE', firstName: 'awa' }, '2015-01-02'),
    );
  });
});

describe('champs complémentaires', () => {
  it('accepte un champ administratif', () => {
    expect(validateCustomFields([{ key: 'ancienne_ecole', label: 'Ancienne école' }])).toEqual([]);
  });

  it('refuse une donnée sensible, même accentuée', () => {
    expect(validateCustomFields([{ key: 'info', label: 'Religion' }])).toHaveLength(1);
    expect(validateCustomFields([{ key: 'info', label: 'État de santé' }])).toHaveLength(1);
    expect(validateCustomFields([{ key: 'ethnie', label: 'Origine' }])).toHaveLength(1);
  });

  it('refuse aussi une donnée sensible écrite en arabe, libellé arabe compris', () => {
    for (const label of ['الدين', 'الديانة', 'الحالة الصحية', 'القبيلة', 'الدخل الشهري', 'إعاقة']) {
      expect(isSensitiveFieldLabel(label)).toBe(true);
      expect(validateCustomFields([{ key: 'champ_1', label }])).toHaveLength(1);
    }
    expect(
      validateCustomFields([{ key: 'info', label: 'Information', labelAr: 'المذهب' }]),
    ).toHaveLength(1);
  });

  it('ne se laisse pas contourner par la ponctuation ni par un pluriel', () => {
    for (const label of [
      'الدين:',
      '(الدين)',
      'الصحة/الدين',
      'الدين، الصحة',
      'الإعاقات',
      'الأمراض المزمنة',
      'بصمة الإصبع',
      'والديانة',
      'القبائل',
      'الطائفة',
      'العقائد',
      'الانتماء للدين',
      'وللدين',
      'ديانته',
      'صحته',
      'الصحة/البيانات',
      // Plus d'exception « validité » : elle permettait de faire passer « الصحة ».
      'صحة الوثائق',
      'Orientation sociopolitique',
      'اللغة والدين',
      'الصحة1',
      'الدين١',
      'الانتماء القبلي',
    ]) {
      expect(isSensitiveFieldLabel(label)).toBe(true);
    }
    expect(
      validateCustomFields([{ key: 'info', label: 'Informations', labelAr: '(الدين)' }]),
    ).toHaveLength(1);
    // Chaque libellé est analysé seul : « الوثائق » ne neutralise pas « الصحة ».
    expect(
      validateCustomFields([{ key: 'info', label: 'الصحة', labelAr: 'الوثائق' }]),
    ).toHaveLength(1);
  });

  it("n'invente pas de donnée sensible dans un mot ordinaire", () => {
    for (const label of [
      'مدينة الميلاد',
      'المدرسة السابقة',
      'مدخل المنزل',
      'الطبيعة',
      'هاتف الوالدين',
      'اللغة الفصحى',
      'Distribution des fournitures',
      'Tribunal de naissance',
      'Contribution volontaire',
    ]) {
      expect(isSensitiveFieldLabel(label)).toBe(false);
    }
  });

  it('donne une clé valide à un libellé arabe, sans écraser une clé existante', () => {
    expect(customFieldKey('Ancienne école', [])).toBe('ancienne_ecole');
    expect(customFieldKey('المدرسة السابقة', [])).toBe('champ_1');
    expect(customFieldKey('رقم الحافلة', [{ key: 'champ_2', label: 'x' }])).toBe('champ_3');
    expect(
      validateCustomFields([{ key: customFieldKey('رقم الحافلة', []), label: 'رقم الحافلة' }]),
    ).toEqual([]);
  });

  it('refuse une clé invalide ou en double', () => {
    expect(validateCustomFields([{ key: 'Bad Key', label: 'X' }])).toHaveLength(1);
    expect(
      validateCustomFields([
        { key: 'a', label: 'A' },
        { key: 'a', label: 'B' },
      ]),
    ).toHaveLength(1);
  });
});

describe('documents', () => {
  it('une photo n’est jamais un PDF', () => {
    expect(isDocumentTypeAllowed('PHOTO', 'application/pdf')).toBe(false);
    expect(isDocumentTypeAllowed('PHOTO', 'image/png')).toBe(true);
    expect(isDocumentTypeAllowed('BIRTH_CERTIFICATE', 'application/pdf')).toBe(true);
  });

  it('repère le contenu actif d’un PDF', () => {
    const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7 ${body}`);
    expect(pdfHasActiveContent(pdf('/JavaScript (x)'))).toBe(true);
    expect(pdfHasActiveContent(pdf('/OpenAction 1'))).toBe(true);
    expect(pdfHasActiveContent(pdf('/J#61vaScript (x)'))).toBe(true);
    expect(pdfHasActiveContent(pdf('/Page /Contents'))).toBe(false);
  });
});

describe('import', () => {
  it('propose la correspondance depuis des en-têtes français et arabes', () => {
    expect(suggestImportMapping(['NOM', 'Prénom', 'Date de naissance', 'الجنسية'])).toEqual({
      lastName: 'NOM',
      firstName: 'Prénom',
      birthDate: 'Date de naissance',
      nationality: 'الجنسية',
    });
  });

  it('lit les dates et refuse celles qui n’existent pas', () => {
    expect(parseSchoolDate('14/03/2015')).toBe('2015-03-14');
    expect(parseSchoolDate('2015-03-14')).toBe('2015-03-14');
    expect(parseSchoolDate('31/02/2015')).toBeNull();
    expect(parseSchoolDate('demain')).toBeNull();
  });

  it('lit le sexe en français, en anglais et en arabe', () => {
    expect(parseSchoolSex('F')).toBe('FEMALE');
    expect(parseSchoolSex('Garçon')).toBe('MALE');
    expect(parseSchoolSex('أنثى')).toBe('FEMALE');
    expect(parseSchoolSex('?')).toBeNull();
  });
});

describe('matrice des droits', () => {
  it('le secrétariat prépare mais ne valide pas, et ne voit pas les besoins particuliers', () => {
    expect(hasSchoolPermission('SECRETARY', 'school.enrollments.manage')).toBe(true);
    expect(hasSchoolPermission('SECRETARY', 'school.enrollments.validate')).toBe(false);
    expect(hasSchoolPermission('SECRETARY', 'school.students.sensitive')).toBe(false);
  });

  it('enseignant et comptable n’ont que la liste restreinte', () => {
    for (const role of ['TEACHER', 'ACCOUNTANT', 'SUPERVISOR'] as const) {
      expect(hasSchoolPermission(role, 'school.students.read')).toBe(true);
      expect(hasSchoolPermission(role, 'school.students.read_full')).toBe(false);
      expect(hasSchoolPermission(role, 'school.guardians.read')).toBe(false);
      expect(hasSchoolPermission(role, 'school.documents.read')).toBe(false);
    }
    expect(isLimitedToOwnClasses('TEACHER')).toBe(true);
    expect(isLimitedToOwnClasses('ACCOUNTANT')).toBe(false);
  });

  it('seule la direction supprime une pièce et corrige un matricule', () => {
    expect(hasSchoolPermission('SCHOOL_DIRECTOR', 'school.documents.delete')).toBe(true);
    expect(hasSchoolPermission('SECRETARY', 'school.documents.delete')).toBe(false);
    expect(hasSchoolPermission('SECRETARY', 'school.students.matricule_correct')).toBe(false);
  });
});
