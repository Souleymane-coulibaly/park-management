/**
 * Écriture CSV pour Excel en français : séparateur « ; », virgule décimale, UTF-8 avec BOM, fins de
 * ligne CRLF.
 *
 * Protection contre l'injection de formules (OWASP « CSV Injection ») : toute valeur texte qui
 * commence par = + - @, une tabulation ou un retour chariot — y compris précédés d'espaces, ou leurs
 * variantes pleine chasse — est préfixée d'une apostrophe, pour qu'un tableur l'affiche comme du
 * texte au lieu de l'exécuter. Les nombres (y compris négatifs) restent des nombres.
 */

export type CsvValue = string | number | null | undefined;

const FORMULA_START = /^[\s\u00a0]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r\n]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
  }
  const text = neutralizeFormula(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvValue[][]): string {
  return `\ufeff${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
