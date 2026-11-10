import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadFactureConfig } from './facture.config';

const MODULES = join(__dirname, '..');
const ALLOWED_FROM_FACTURE = new Set(['organizations', 'facture']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('frontières d’Ocall Facture', () => {
  it('le module Facture n’importe aucun module métier Park ni School', () => {
    const offending = sources(join(MODULES, 'facture')).flatMap((file) =>
      importsOf(file)
        .filter((i) => i.startsWith('.') || i === '@ocall/school-database')
        .filter((i) => {
          if (i === '@ocall/school-database') return true;
          const target = relative(MODULES, resolve(dirname(file), i));
          return !target.startsWith('..') && !ALLOWED_FROM_FACTURE.has(target.split(/[\\/]/)[0]!);
        })
        .map((i) => `${file} -> ${i}`),
    );
    expect(offending).toEqual([]);
  });

  it('aucun autre module n’importe Facture ni son client de base', () => {
    const offending = readdirSync(MODULES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'facture')
      .flatMap((e) => sources(join(MODULES, e.name)))
      .flatMap((file) =>
        importsOf(file)
          .filter((i) => i.includes('/facture/') || i === '@ocall/facture-database')
          .map((i) => `${file} -> ${i}`),
      );
    expect(offending).toEqual([]);
  });
});

describe('configuration Facture', () => {
  const core = 'postgresql://u:p@ep-core-pooler.neon.tech/suite';
  const school = 'postgresql://u:p@ep-school-pooler.neon.tech/school';
  const facture = 'postgresql://u:p@ep-facture-pooler.neon.tech/facture';

  it('désactivé par défaut, sans base', () => {
    expect(loadFactureConfig({})).toEqual({
      enabled: false,
      databaseUrl: null,
      whatsapp: 'disabled',
      aiMonthlyCeiling: 500,
    });
  });

  it('WhatsApp : désactivé par défaut, simulé en test seulement, jamais en production', () => {
    expect(loadFactureConfig({ FACTURE_WHATSAPP_PROVIDER: 'simulated' }).whatsapp).toBe(
      'simulated',
    );
    expect(() =>
      loadFactureConfig({ FACTURE_WHATSAPP_PROVIDER: 'simulated', NODE_ENV: 'production' }),
    ).toThrow('interdit en production');
    expect(() => loadFactureConfig({ FACTURE_WHATSAPP_PROVIDER: 'meta' })).toThrow('invalide');
    expect(loadFactureConfig({ FACTURE_AI_MAX_MONTHLY_CALLS: '50' }).aiMonthlyCeiling).toBe(50);
    expect(() => loadFactureConfig({ FACTURE_AI_MAX_MONTHLY_CALLS: '-1' })).toThrow('invalide');
  });

  it('activé : base obligatoire, distincte des bases Suite et School', () => {
    expect(() => loadFactureConfig({ FACTURE_ENABLED: 'true' })).toThrow('FACTURE_DATABASE_URL');
    expect(() =>
      loadFactureConfig({
        FACTURE_ENABLED: 'true',
        DATABASE_URL: core,
        FACTURE_DATABASE_URL: core,
      }),
    ).toThrow('distincte');
    expect(() =>
      loadFactureConfig({
        FACTURE_ENABLED: 'true',
        DATABASE_URL: core,
        SCHOOL_DATABASE_URL: school,
        FACTURE_DATABASE_URL: school,
      }),
    ).toThrow('distincte');
    expect(
      loadFactureConfig({
        FACTURE_ENABLED: 'true',
        DATABASE_URL: core,
        SCHOOL_DATABASE_URL: school,
        FACTURE_DATABASE_URL: facture,
      }),
    ).toEqual({ enabled: true, databaseUrl: facture, whatsapp: 'disabled', aiMonthlyCeiling: 500 });
  });
});
