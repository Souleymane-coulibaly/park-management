/**
 * Mise en ordre visuelle d'un texte arabe pour le PDF (Sprint 4). pdfkit dessine de gauche à droite : la
 * mise en forme des lettres arabes et leur inversion sont faites par fontkit pour un segment purement
 * arabe ; ce module place les mots et les segments autour, selon une version réduite de l'algorithme
 * bidirectionnel Unicode, suffisante pour des noms, des libellés et des appréciations :
 * - un paragraphe arabe se lit de droite à gauche, mot après mot ;
 * - une suite de mots latins ou de nombres (« 12,5 / 20 ») garde son ordre de gauche à droite ;
 * - la ponctuation entre deux mots latins les rejoint, sinon elle suit le sens arabe ;
 * - parenthèses, crochets et guillemets sont retournés dans le sens arabe.
 */

/** Classe de caractères construite depuis des plages de points de code (aucun caractère invisible ici). */
const ranges = (list: [number, number][]) =>
  list.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('');
// Arabe, supplément, étendu A, formes de présentation A et B.
const ARABIC_RANGES = ranges([
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
]);
// Latin accentué (latin-1, latin étendu A et B, latin étendu additionnel).
const LATIN_RANGES = ranges([
  [0x00c0, 0x024f],
  [0x1e00, 0x1eff],
]);
const ARABIC_CHAR = new RegExp(`[${ARABIC_RANGES}]`);
const STRONG_LTR = new RegExp(`[A-Za-z0-9${LATIN_RANGES}]`);
const NOT_LTR = `[^A-Za-z0-9${LATIN_RANGES}]*`;
const EDGE_PUNCTUATION = new RegExp(`^(${NOT_LTR})(.*?)(${NOT_LTR})$`, 'u');
const MIRRORED: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};

export function hasArabic(text: string): boolean {
  return ARABIC_CHAR.test(text);
}

export type RunKind = 'arabic' | 'ltr' | 'neutral';

/** Segment d'un mot, dessiné d'un seul tenant avec une seule police. */
export interface TextRun {
  kind: RunKind;
  text: string;
}

function charKind(ch: string): RunKind {
  if (ARABIC_CHAR.test(ch)) return 'arabic';
  return STRONG_LTR.test(ch) ? 'ltr' : 'neutral';
}

/** Découpe un mot en segments homogènes, dans l'ordre logique. */
export function splitRuns(word: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const ch of word) {
    let kind = charKind(ch);
    // Séparateur décimal ou de milliers entre deux chiffres : il appartient au nombre.
    const last = runs[runs.length - 1];
    if (kind === 'neutral' && /[.,]/.test(ch) && last?.kind === 'ltr') kind = 'ltr';
    if (last && last.kind === kind) last.text += ch;
    else runs.push({ kind, text: ch });
  }
  // Un séparateur resté en fin de nombre (« 12. ») redevient de la ponctuation.
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i]!;
    const trailing = run.kind === 'ltr' ? /[.,]+$/.exec(run.text) : null;
    if (trailing && trailing[0].length < run.text.length) {
      run.text = run.text.slice(0, -trailing[0].length);
      runs.splice(i + 1, 0, { kind: 'neutral', text: trailing[0] });
    }
  }
  return runs;
}

function wordDirection(word: string): RunKind {
  if (hasArabic(word)) return 'arabic';
  return STRONG_LTR.test(word) ? 'ltr' : 'neutral';
}

/**
 * Segments d'un mot dans l'ordre visuel (de gauche à droite). Dans le sens arabe, les segments sont
 * inversés et la ponctuation retournée ; un segment arabe reste en ordre logique, fontkit l'inverse.
 */
export function visualRuns(word: string, rtl: boolean): TextRun[] {
  const runs = splitRuns(word);
  if (!rtl) return runs;
  return runs.reverse().map((run) =>
    run.kind === 'neutral'
      ? {
          kind: run.kind,
          text: [...run.text]
            .reverse()
            .map((c) => MIRRORED[c] ?? c)
            .join(''),
        }
      : run,
  );
}

export interface PlacedWord {
  word: string;
  /** Mot pris dans le sens arabe : ses segments sont inversés par `visualRuns`. */
  rtl: boolean;
}

/**
 * Détache la ponctuation de début et de fin d'un mot latin (« 20. », « (15 ») : elle suit ensuite le sens
 * de son voisinage, comme dans l'algorithme Unicode (un point final va en fin de phrase arabe).
 */
function detachPunctuation(word: string): string[] {
  if (wordDirection(word) !== 'ltr') return [word];
  const match = EDGE_PUNCTUATION.exec(word);
  if (!match) return [word];
  return [match[1], match[2], match[3]].filter((part): part is string => Boolean(part));
}

/** Ordre visuel (de gauche à droite) des mots d'une ligne d'un paragraphe arabe. */
export function visualOrderRtl(line: readonly string[]): PlacedWord[] {
  const words = line.flatMap(detachPunctuation);
  const dirs = words.map(wordDirection);
  const resolved = dirs.map((dir, i) => {
    if (dir !== 'neutral') return dir;
    const before = dirs
      .slice(0, i)
      .reverse()
      .find((d) => d !== 'neutral');
    const after = dirs.slice(i + 1).find((d) => d !== 'neutral');
    return before === 'ltr' && after === 'ltr' ? 'ltr' : 'arabic';
  });
  const blocks: { ltr: boolean; words: string[] }[] = [];
  words.forEach((word, i) => {
    const ltr = resolved[i] === 'ltr';
    const last = blocks[blocks.length - 1];
    if (last && last.ltr === ltr) last.words.push(word);
    else blocks.push({ ltr, words: [word] });
  });
  return blocks
    .reverse()
    .flatMap((block): PlacedWord[] =>
      block.ltr
        ? block.words.map((word) => ({ word, rtl: false }))
        : [...block.words].reverse().map((word) => ({ word, rtl: true })),
    );
}

/** Coupure gloutonne en lignes, dans l'ordre logique ; un mot trop long occupe seul sa ligne. */
export function wrapWords(
  words: readonly string[],
  measure: (word: string) => number,
  spaceWidth: number,
  width: number,
): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let used = 0;
  for (const word of words) {
    const w = measure(word);
    const needed = line.length === 0 ? w : used + spaceWidth + w;
    if (line.length > 0 && needed > width) {
      lines.push(line);
      line = [word];
      used = w;
    } else {
      line.push(word);
      used = needed;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Mots d'un texte, espaces multiples et retours à la ligne compris. */
export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
