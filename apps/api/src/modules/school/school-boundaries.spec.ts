import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSchoolIds } from './school-access';
import { loadSchoolConfig } from './school.config';

const MODULES = join(__dirname, '..');
const ALLOWED_FROM_SCHOOL = new Set(['organizations', 'suite-contracts', 'school']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('frontières entre Ocall School et Ocall Park', () => {
  it('le module School n’importe aucun module métier Park', () => {
    const offending = sources(join(MODULES, 'school')).flatMap((file) =>
      importsOf(file)
        .filter((i) => i.startsWith('../') && !i.startsWith('../../'))
        .filter((i) => !ALLOWED_FROM_SCHOOL.has(i.split('/')[1]!))
        .map((i) => `${file} -> ${i}`),
    );
    expect(offending).toEqual([]);
  });

  it('aucun module Park n’importe School ni son client de base', () => {
    const offending = readdirSync(MODULES, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'school')
      .flatMap((e) => sources(join(MODULES, e.name)))
      .flatMap((file) =>
        importsOf(file)
          .filter((i) => i.includes('/school/') || i === '@ocall/school-database')
          .map((i) => `${file} -> ${i}`),
      );
    expect(offending).toEqual([]);
  });
});

describe('configuration School', () => {
  const core = 'postgresql://u:p@ep-core-pooler.neon.tech/suite';

  it('désactivé par défaut, sans URL exigée', () => {
    expect(loadSchoolConfig({ DATABASE_URL: core } as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      databaseUrl: null,
      dataKey: null,
      portalBaseUrl: null,
      sms: { provider: 'simulated', apiKey: null, sender: null },
    });
  });

  const enabled = {
    SCHOOL_ENABLED: 'true',
    DATABASE_URL: core,
    SCHOOL_DATABASE_URL: 'postgresql://u:p@ep-school.neon.tech/school',
  };

  it('SMS : fournisseur simulé par défaut, clé lue dans l’environnement, fournisseur inconnu refusé', () => {
    const config = loadSchoolConfig({
      ...enabled,
      SCHOOL_SMS_API_KEY: 'cle-de-test',
    } as NodeJS.ProcessEnv);
    expect(config.sms).toEqual({ provider: 'simulated', apiKey: 'cle-de-test', sender: null });
    expect(() =>
      loadSchoolConfig({ ...enabled, SCHOOL_SMS_PROVIDER: 'inconnu' } as NodeJS.ProcessEnv),
    ).toThrow(/SCHOOL_SMS_PROVIDER/);
  });

  it('adresse du portail parents : origine seule, https exigé en production', () => {
    expect(
      loadSchoolConfig({
        ...enabled,
        SCHOOL_PORTAL_BASE_URL: 'https://ecole.example.com/chemin',
      } as NodeJS.ProcessEnv).portalBaseUrl,
    ).toBe('https://ecole.example.com');
    expect(() =>
      loadSchoolConfig({
        ...enabled,
        NODE_ENV: 'production',
        SCHOOL_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
        SCHOOL_PORTAL_BASE_URL: 'http://ecole.example.com',
      } as NodeJS.ProcessEnv),
    ).toThrow(/https/);
  });

  it('activé sans URL : démarrage refusé', () => {
    expect(() => loadSchoolConfig({ SCHOOL_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(
      /SCHOOL_DATABASE_URL/,
    );
  });

  it('même base que la Suite : démarrage refusé, pooler compris', () => {
    expect(() =>
      loadSchoolConfig({
        SCHOOL_ENABLED: 'true',
        DATABASE_URL: core,
        SCHOOL_DATABASE_URL: 'postgresql://u:p@ep-core.neon.tech/suite',
      } as NodeJS.ProcessEnv),
    ).toThrow(/distincte/);
  });
});

describe('périmètre des établissements', () => {
  it('la couverture du contrat réduit le périmètre du rôle', () => {
    expect(resolveSchoolIds(null, [])).toBeNull();
    expect(resolveSchoolIds(null, ['a'])).toEqual(['a']);
    expect(resolveSchoolIds(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(resolveSchoolIds(['a', 'b'], ['b', 'c'])).toEqual(['b']);
  });
});
