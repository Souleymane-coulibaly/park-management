import { deflateRawSync } from 'node:zlib';
import {
  assertZipWithinLimit,
  parseCsv,
  parseSheet,
  safeCsvCell,
  toCsv,
} from './school-spreadsheet';

/** Archive d'une entrée dont le répertoire central annonce la taille décompressée voulue. */
function zipOf(content: Buffer, declaredSize: number): Buffer {
  const name = Buffer.from('a.xml');
  const data = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe('fichiers piégés', () => {
  it('refuse une bombe zip qui annonce une taille nulle', () => {
    const bomb = zipOf(Buffer.alloc(2 * 1024 * 1024), 0);
    expect(() => assertZipWithinLimit(bomb, 1024 * 1024)).toThrow('décompressé');
  });

  it('refuse une archive qui minore son nombre d’entrées', () => {
    const zip = zipOf(Buffer.from('bonjour'), 7);
    zip.writeUInt16LE(0, zip.length - 22 + 10);
    expect(() => assertZipWithinLimit(zip)).toThrow('illisible');
    zip.writeUInt32LE(0, zip.length - 22 + 12);
    expect(() => assertZipWithinLimit(zip)).toThrow('illisible');
  });

  it('refuse un répertoire central qui ne précède pas la fin d’archive', () => {
    const zip = zipOf(Buffer.from('bonjour'), 7);
    zip.writeUInt32LE(0, zip.length - 22 + 12);
    expect(() => assertZipWithinLimit(zip)).toThrow('illisible');
  });

  it('accepte une archive sous la limite', () => {
    expect(() => assertZipWithinLimit(zipOf(Buffer.from('bonjour'), 7))).not.toThrow();
  });

  it('refuse une ligne de données trop large, et une cellule démesurée', () => {
    expect(() => parseCsv(`a;b\n${';'.repeat(100_000)}\n`)).toThrow('colonnes');
    expect(() => parseCsv(`a;b\n"${'x'.repeat(20_000)}";y\n`)).toThrow('trop longue');
  });

  it('refuse trop de colonnes', async () => {
    const headers = Array.from({ length: 101 }, (_, i) => `c${i}`).join(';');
    await expect(parseSheet(Buffer.from(`${headers}\n`))).rejects.toThrow('colonnes');
  });

  it('arrête un CSV rempli de lignes vides sans le lire en entier', () => {
    expect(() => parseCsv('a;b\n' + '\n'.repeat(4_000_000))).toThrow('lignes');
  });

  it('refuse plus de 1000 lignes utiles', async () => {
    const lines = Array.from({ length: 1001 }, (_, i) => `n${i};p`).join('\n');
    await expect(parseSheet(Buffer.from(`a;b\n${lines}\n`))).rejects.toThrow('1000 lignes');
  });
});

describe('lecture CSV', () => {
  it('gère guillemets, retours à la ligne cités et séparateur virgule', () => {
    expect(parseCsv('a,b\n"x, y","l1\nl2"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'l1\nl2'],
    ]);
  });

  it('garde l’arabe et retire le BOM', async () => {
    const sheet = await parseSheet(Buffer.from('\uFEFFNom;الاسم\nA;فاطمة\n'));
    expect(sheet.headers).toEqual(['Nom', 'الاسم']);
    expect(sheet.rows[0]!.cells['الاسم']).toBe('فاطمة');
  });
});

describe('export CSV', () => {
  it('neutralise une formule et garde un téléphone', () => {
    expect(safeCsvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(safeCsvCell('+223 70 00 00 01')).toBe('+223 70 00 00 01');
  });

  it('cite la virgule, pour qu’une formule ne devienne pas une cellule', () => {
    expect(safeCsvCell('Dup,=1+1')).toBe('"Dup,=1+1"');
  });

  it('commence par un BOM UTF-8', () => {
    expect(toCsv({ headers: ['a'], rows: [] }).subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
  });
});
