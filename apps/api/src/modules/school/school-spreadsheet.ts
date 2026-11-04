import { inflateRawSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import { Workbook, type CellValue } from 'exceljs';
import { SCHOOL_IMPORT_MAX_ROWS } from '@ocall/shared';

export interface ParsedSheet {
  format: 'CSV' | 'XLSX';
  headers: string[];
  /** `line` : numéro de ligne dans le fichier, pour le rapport d'erreurs. */
  rows: { line: number; cells: Record<string, string> }[];
}

const XLSX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 10_000;
/** Lignes physiques lues, vides comprises : la limite d'import s'applique ensuite aux lignes utiles. */
const MAX_PHYSICAL_ROWS = SCHOOL_IMPORT_MAX_ROWS * 2;

const tooBig = () => invalid('Fichier trop volumineux une fois décompressé.');
const tooManyRows = () =>
  invalid(`${SCHOOL_IMPORT_MAX_ROWS} lignes au plus par fichier : découpez-le.`);
const invalid = (message: string) =>
  new BadRequestException({ code: 'IMPORT_FILE_INVALID', message });

/**
 * Décompresse réellement chaque entrée, sous plafond cumulé : les tailles annoncées par l'archive sont
 * choisies par l'expéditeur et ne prouvent rien. Une « bombe » est refusée avant toute lecture par exceljs.
 */
export function assertZipWithinLimit(zip: Buffer, limit = XLSX_MAX_UNCOMPRESSED): void {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  const unreadable = () => invalid('Fichier Excel illisible.');
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw unreadable();
  const entries = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  let offset = zip.readUInt32LE(end + 16);
  const directoryEnd = offset + directorySize;
  if (entries === 0 || directoryEnd !== end) throw unreadable();
  let budget = limit;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL) throw unreadable();
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const local = zip.readUInt32LE(offset + 42);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) throw unreadable();
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compressed);
    let size: number;
    if (method === 0) {
      size = data.length;
    } else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: budget + 1 }).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooBig();
        throw unreadable();
      }
    } else {
      throw unreadable();
    }
    budget -= size;
    if (budget < 0) throw tooBig();
    offset +=
      46 +
      zip.readUInt16LE(offset + 28) +
      zip.readUInt16LE(offset + 30) +
      zip.readUInt16LE(offset + 32);
  }
  if (offset !== directoryEnd) throw unreadable();
}

/** Texte d'un CSV : UTF-8 (arabe compris), sinon l'encodage Windows d'un ancien Excel. */
function decodeCsv(buffer: Buffer): string {
  if (buffer.includes(0)) throw invalid('Ce fichier n’est ni un CSV ni un fichier Excel.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Lecture CSV (RFC 4180) : guillemets, retours à la ligne cités, séparateur « ; », « , » ou tabulation. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (cell.length > MAX_CELL_LENGTH) throw invalid('Une cellule du fichier est trop longue.');
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      if (row.length + 1 >= MAX_COLUMNS) throw invalid(`${MAX_COLUMNS} colonnes au plus.`);
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      if (rows.length > MAX_PHYSICAL_ROWS) throw tooManyRows();
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value)
      return value.result === undefined ? '' : cellText(value.result as CellValue);
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value);
}

async function readRows(
  buffer: Buffer,
): Promise<{ format: ParsedSheet['format']; rows: string[][] }> {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    assertZipWithinLimit(buffer);
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw invalid('Fichier Excel illisible.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw invalid('Le fichier Excel ne contient aucune feuille.');
    if (sheet.columnCount > MAX_COLUMNS) throw invalid(`${MAX_COLUMNS} colonnes au plus.`);
    if (sheet.rowCount > MAX_PHYSICAL_ROWS) throw tooManyRows();
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      rows.push(
        Array.from({ length: sheet.columnCount }, (_, c) => cellText(row.getCell(c + 1).value)),
      );
    }
    return { format: 'XLSX', rows };
  }
  return { format: 'CSV', rows: parseCsv(decodeCsv(buffer)) };
}

/** Première ligne : en-têtes. Les lignes vides sont ignorées, le nombre de lignes reste borné. */
export async function parseSheet(buffer: Buffer): Promise<ParsedSheet> {
  const { format, rows } = await readRows(buffer);
  if ((rows[0]?.length ?? 0) > MAX_COLUMNS) throw invalid(`${MAX_COLUMNS} colonnes au plus.`);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  if (headers.filter(Boolean).length === 0)
    throw invalid('La première ligne doit contenir les en-têtes.');
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    throw invalid('Deux colonnes portent le même nom.');
  }
  const data = rows
    .slice(1)
    .map((cells, i) => ({
      line: i + 2,
      cells: Object.fromEntries(
        headers.flatMap((h, c) => (h ? [[h, (cells[c] ?? '').trim()]] : [])),
      ),
    }))
    .filter((row) => Object.values(row.cells).some(Boolean));
  if (data.length > SCHOOL_IMPORT_MAX_ROWS) {
    throw invalid(`${SCHOOL_IMPORT_MAX_ROWS} lignes au plus par fichier : découpez-le.`);
  }
  return { format, headers: headers.filter(Boolean), rows: data };
}

// ─── Export ───

/** Empêche un tableur d'exécuter une cellule comme formule ; un numéro de téléphone reste intact. */
export function safeCsvCell(value: string): string {
  const neutral = /^[=+\-@\t\r]/.test(value) && !/^\+?[0-9][0-9 ().-]*$/.test(value);
  const text = neutral ? `'${value}` : value;
  return /[";,\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Tableau exporté ; une cellule numérique (montant) reste un nombre dans le tableur. */
export interface TableExport {
  headers: string[];
  rows: (string | number)[][];
}

/** CSV UTF-8 avec BOM et « ; » : Excel français l'ouvre directement, arabe compris. */
export function toCsv(table: TableExport): Buffer {
  // Les nombres viennent du serveur : écrits tels quels (signe compris), jamais neutralisés.
  const lines = [table.headers, ...table.rows].map((r) =>
    r.map((c) => (typeof c === 'number' ? String(c) : safeCsvCell(c))).join(';'),
  );
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function toXlsx(table: TableExport, sheetName: string): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(table.headers).font = { bold: true };
  for (const row of table.rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
