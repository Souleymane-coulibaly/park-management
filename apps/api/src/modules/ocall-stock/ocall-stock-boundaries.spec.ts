import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const MODULES = join(__dirname, '..');
/** Ocall Stock n'importe que le socle commun et le module des organisations. */
const ALLOWED_FROM_STOCK = new Set(['organizations', 'ocall-stock']);
const OTHER_APP_DATABASES = ['@ocall/school-database', '@ocall/facture-database'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('frontières d’Ocall Stock', () => {
  it('le module Stock n’importe aucun module métier Park, School ou Facture, ni leurs bases', () => {
    const offending = sources(join(MODULES, 'ocall-stock')).flatMap((file) =>
      importsOf(file)
        .filter((i) => {
          if (OTHER_APP_DATABASES.includes(i)) return true;
          if (!i.startsWith('.')) return false;
          const target = relative(MODULES, resolve(dirname(file), i));
          return !target.startsWith('..') && !ALLOWED_FROM_STOCK.has(target.split(/[\\/]/)[0]!);
        })
        .map((i) => `${file} -> ${i}`),
    );
    expect(offending).toEqual([]);
  });

  it('aucun autre module n’importe Stock ni son client de base (lien unique : common/integration)', () => {
    const offending = readdirSync(MODULES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'ocall-stock')
      .flatMap((e) => sources(join(MODULES, e.name)))
      .flatMap((file) =>
        importsOf(file)
          .filter((i) => i.includes('/ocall-stock/') || i === '@ocall/stock-database')
          .map((i) => `${file} -> ${i}`),
      );
    expect(offending).toEqual([]);
  });
});
