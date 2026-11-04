import {
  hasArabic,
  splitRuns,
  visualOrderRtl,
  visualRuns,
  words,
  wrapWords,
} from './school-rtl-text';

const order = (text: string) => visualOrderRtl(words(text)).map((p) => p.word);

describe('wrapWords : mot plus large que la ligne', () => {
  it('découpé en fragments qui tiennent chacun dans la largeur', () => {
    const word = `ع${'W'.repeat(79)}`;
    const lines = wrapWords([word], (w) => w.length, 1, 10);
    expect(lines.every((line) => line.every((w) => w.length <= 10))).toBe(true);
    expect(lines.flat().join('')).toBe(word);
    expect(wrapWords(['court', 'mot'], (w) => w.length, 1, 10)).toEqual([['court', 'mot']]);
  });
});

describe('Ocall School — ordre visuel du texte arabe (bulletins PDF)', () => {
  it('détecte l’arabe', () => {
    expect(hasArabic('الرياضيات')).toBe(true);
    expect(hasArabic('Mathématiques 12,5')).toBe(false);
  });

  it('un paragraphe arabe se dessine du dernier mot au premier', () => {
    expect(order('السنة الأولى ابتدائي')).toEqual(['ابتدائي', 'الأولى', 'السنة']);
  });

  it('une suite de nombres et de mots latins garde son ordre de gauche à droite', () => {
    // Lecture : « المعدل » puis « 12,5 / 20 » puis « جيد ».
    expect(order('المعدل 12,5 / 20 جيد')).toEqual(['جيد', '12,5', '/', '20', 'المعدل']);
  });

  it('la ponctuation entre un mot arabe et un nombre suit le sens arabe', () => {
    const placed = visualOrderRtl(words('الرتبة : 3'));
    expect(placed.map((p) => p.word)).toEqual(['3', ':', 'الرتبة']);
    expect(placed.find((p) => p.word === ':')?.rtl).toBe(true);
    expect(placed.find((p) => p.word === '3')?.rtl).toBe(false);
  });

  it('le point final d’une phrase arabe terminée par un nombre va en fin de phrase', () => {
    expect(order('النتيجة 15 / 20.')).toEqual(['.', '15', '/', '20', 'النتيجة']);
    expect(order('(15 نقطة)')).toEqual(['نقطة)', '15', '(']);
  });

  it('segments d’un mot : nombre décimal d’un tenant, ponctuation finale détachée', () => {
    expect(splitRuns('12,5')).toEqual([{ kind: 'ltr', text: '12,5' }]);
    expect(splitRuns('12.')).toEqual([
      { kind: 'ltr', text: '12' },
      { kind: 'neutral', text: '.' },
    ]);
    expect(splitRuns('(ممتاز)')).toEqual([
      { kind: 'neutral', text: '(' },
      { kind: 'arabic', text: 'ممتاز' },
      { kind: 'neutral', text: ')' },
    ]);
  });

  it('dans le sens arabe, segments inversés et parenthèses retournées', () => {
    expect(visualRuns('(ممتاز)', true)).toEqual([
      { kind: 'neutral', text: '(' },
      { kind: 'arabic', text: 'ممتاز' },
      { kind: 'neutral', text: ')' },
    ]);
    expect(visualRuns('«نص»', true).map((r) => r.text)).toEqual(['«', 'نص', '»']);
    expect(visualRuns('(abc)', false).map((r) => r.text)).toEqual(['(', 'abc', ')']);
  });

  it('coupure en lignes selon la largeur, dans l’ordre logique', () => {
    const lines = wrapWords(['aaa', 'bb', 'cccc', 'd'], (w) => w.length, 1, 6);
    expect(lines).toEqual([
      ['aaa', 'bb'],
      ['cccc', 'd'],
    ]);
    // Mot plus large que la ligne : découpé, jamais en débordement.
    expect(wrapWords(['beaucoup-trop-long'], (w) => w.length, 1, 4)).toEqual([
      ['beau'],
      ['coup'],
      ['-tro'],
      ['p-lo'],
      ['ng'],
    ]);
    expect(wrapWords([], (w) => w.length, 1, 4)).toEqual([]);
  });
});
