import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadPrintConfig } from './print.config';

const MODULES = join(__dirname, '..');
/** Ocall Print n'importe que le socle commun : c'est le moteur partagé, il ne connaît aucune source. */
const ALLOWED_FROM_PRINT = new Set(['ocall-print']);
const OTHER_APP_DATABASES = [
  '@ocall/school-database',
  '@ocall/facture-database',
  '@ocall/stock-database',
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('frontières d’Ocall Print', () => {
  it('le module Print n’importe aucun module métier (School, Parc, Stock, Facture), ni leurs bases', () => {
    const offending = sources(join(MODULES, 'ocall-print')).flatMap((file) =>
      importsOf(file)
        .filter((i) => {
          if (OTHER_APP_DATABASES.includes(i)) return true;
          if (!i.startsWith('.')) return false;
          const target = relative(MODULES, resolve(dirname(file), i));
          return !target.startsWith('..') && !ALLOWED_FROM_PRINT.has(target.split(/[\\/]/)[0]!);
        })
        .map((i) => `${file} -> ${i}`),
    );
    expect(offending).toEqual([]);
  });

  it('aucun autre module n’importe Print ni son client de base (lien unique : PRINT_GATEWAY)', () => {
    const offending = readdirSync(MODULES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'ocall-print')
      .flatMap((e) => sources(join(MODULES, e.name)))
      .flatMap((file) =>
        importsOf(file)
          .filter((i) => i.includes('/ocall-print/') || i === '@ocall/print-database')
          .map((i) => `${file} -> ${i}`),
      );
    expect(offending).toEqual([]);
  });
});

describe('configuration Ocall Print', () => {
  const core = 'postgresql://u:p@ep-core-pooler.neon.tech/suite';
  const print = 'postgresql://u:p@ep-print-pooler.neon.tech/print';

  it('désactivé par défaut, sans base exigée', () => {
    expect(loadPrintConfig({ DATABASE_URL: core } as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      databaseUrl: null,
    });
  });

  it('activé : base obligatoire et distincte de toutes les autres bases Ocall', () => {
    expect(() => loadPrintConfig({ PRINT_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(
      'PRINT_DATABASE_URL',
    );
    expect(
      loadPrintConfig({
        PRINT_ENABLED: 'true',
        DATABASE_URL: core,
        PRINT_DATABASE_URL: print,
      } as NodeJS.ProcessEnv),
    ).toEqual({ enabled: true, databaseUrl: print });
    for (const key of [
      'DATABASE_URL',
      'SCHOOL_DATABASE_URL',
      'FACTURE_DATABASE_URL',
      'STOCK_DATABASE_URL',
    ]) {
      expect(() =>
        loadPrintConfig({
          PRINT_ENABLED: 'true',
          [key]: print,
          PRINT_DATABASE_URL: print,
        } as NodeJS.ProcessEnv),
      ).toThrow('distincte');
    }
  });
});
