import {
  PRINT_FIELDS_BY_KIND,
  defaultPrintLayout,
  parsePrintLayout,
  printFieldValue,
  printOrderNumber,
  printSearchText,
  type PrintCardData,
} from './index';

const data: PrintCardData = {
  format: 'ocall-print/card@1',
  kind: 'STUDENT',
  issuer: { name: 'École Les Baobabs', nameAr: null, contact: null },
  holder: {
    firstName: 'Aminata',
    lastName: 'Diallo',
    firstNameAr: 'أميناتا',
    lastNameAr: 'ديالو',
    reference: '2026-000123',
    group: '6e A',
    jobTitle: null,
    birthDate: '2014-03-12',
  },
  period: '2026-2027',
  validUntil: '2027-07-31',
  cardNumber: 'ABCD-EFGH-JKMN',
  qr: 'OCP1.ABCD-EFGH-JKMN.x',
};

describe('Ocall Print : mise en page', () => {
  it('le modèle par défaut est valide pour chaque type de carte', () => {
    for (const kind of ['STUDENT', 'STAFF'] as const) {
      const parsed = parsePrintLayout(defaultPrintLayout(kind), kind);
      expect(parsed.ok).toBe(true);
    }
  });

  it('normalise les couleurs et retire les lignes vides du verso', () => {
    const layout = defaultPrintLayout('STUDENT');
    const parsed = parsePrintLayout(
      {
        ...layout,
        colors: { primary: '#0f5132', text: '#111111', background: '#ffffff' },
        back: { ...layout.back, lines: ['  Ligne  ', ''] },
      },
      'STUDENT',
    );
    expect(parsed.ok && parsed.layout.colors.primary).toBe('#0F5132');
    expect(parsed.ok && parsed.layout.back.lines).toEqual(['Ligne']);
  });

  it('refuse une forme ouverte : couleur, champ, option ou orientation inconnus', () => {
    const layout = defaultPrintLayout('STUDENT');
    const bad = [
      null,
      { ...layout, orientation: 'DIAGONAL' },
      { ...layout, colors: { ...layout.colors, primary: 'red' } },
      { ...layout, front: { ...layout.front, fields: ['jobTitle'] } },
      { ...layout, front: { ...layout.front, fields: ['fullName', 'fullName'] } },
      { ...layout, front: { ...layout.front, fields: [] } },
      { ...layout, front: { ...layout.front, photo: 'TOP' } },
      { ...layout, front: { ...layout.front, title: 'x'.repeat(41) } },
      { ...layout, front: { ...layout.front, showLogo: 'oui' } },
      { ...layout, back: { ...layout.back, lines: ['a', 'b', 'c', 'd', 'e'] } },
      { ...layout, back: { ...layout.back, lines: ['a\u0007'] } },
    ];
    for (const input of bad) expect(parsePrintLayout(input, 'STUDENT').ok).toBe(false);
  });

  it('chaque type n’accepte que ses champs', () => {
    expect(PRINT_FIELDS_BY_KIND.STUDENT).not.toContain('jobTitle');
    expect(PRINT_FIELDS_BY_KIND.STAFF).toContain('jobTitle');
  });
});

describe('Ocall Print : valeurs imprimées', () => {
  it('formate nom, nom arabe et dates', () => {
    expect(printFieldValue('fullName', data)).toBe('DIALLO Aminata');
    expect(printFieldValue('fullNameAr', data)).toBe('أميناتا ديالو');
    expect(printFieldValue('birthDate', data)).toBe('12/03/2014');
    expect(printFieldValue('validUntil', data)).toBe('31/07/2027');
    expect(printFieldValue('jobTitle', data)).toBeNull();
  });

  it('numéro de commande et recherche normalisée', () => {
    expect(printOrderNumber(2026, 7)).toBe('IMP-2026-00007');
    expect(printSearchText('Aïssata', 'TRAORÉ', null)).toBe('aissata traore');
  });
});
