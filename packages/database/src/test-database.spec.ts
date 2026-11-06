import {
  REMOTE_TEST_OPT_IN,
  assertDisposableTestDatabases,
  assertTestDatabaseMarker,
  resolveTestDatabase,
} from './test-database';

const MAIN_POOLED =
  'postgresql://u:p@ep-main-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const MAIN_DIRECT = 'postgresql://u:p@ep-main.us-east-2.aws.neon.tech/neondb?sslmode=require';
const DEV = 'postgresql://u:p@ep-dev-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('resolveTestDatabase', () => {
  it('refuse de démarrer sans TEST_DATABASE_URL', () => {
    expect(() => resolveTestDatabase({ DATABASE_URL: MAIN_POOLED })).toThrow(/TEST_DATABASE_URL/);
  });

  it('refuse une base de test identique à la base de développement (avec ou sans -pooler)', () => {
    expect(() =>
      resolveTestDatabase({ DATABASE_URL: MAIN_POOLED, TEST_DATABASE_URL: MAIN_DIRECT }),
    ).toThrow(/base de développement/);
  });

  it('accepte une branche Neon dédiée', () => {
    expect(resolveTestDatabase({ DATABASE_URL: MAIN_POOLED, TEST_DATABASE_URL: DEV })).toEqual({
      databaseUrl: DEV,
      directUrl: DEV,
    });
  });

  it('accepte une base locale éphémère (CI)', () => {
    const ci = 'postgresql://postgres:postgres@localhost:5432/ocall_park_ci';
    expect(resolveTestDatabase({ DATABASE_URL: ci, TEST_DATABASE_URL: ci }).databaseUrl).toBe(ci);
  });
});

describe('assertTestDatabaseMarker', () => {
  const REMOTE = 'postgresql://u:p@ep-test-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
  const LOCAL = 'postgresql://u:p@127.0.0.1:5432/ocall_ci';

  it('accepte une base distante qui porte le marqueur « test »', async () => {
    await expect(
      assertTestDatabaseMarker(async () => [{ value: 'test' }], REMOTE),
    ).resolves.toBeUndefined();
  });

  it('refuse une base distante sans marqueur (table absente ou valeur différente)', async () => {
    await expect(
      assertTestDatabaseMarker(async () => {
        throw new Error('relation "_ocall_environment" does not exist');
      }, REMOTE),
    ).rejects.toThrow(/marqueur/);
    await expect(
      assertTestDatabaseMarker(async () => [{ value: 'production' }], REMOTE),
    ).rejects.toThrow(/marqueur/);
    await expect(assertTestDatabaseMarker(async () => [], REMOTE)).rejects.toThrow(/marqueur/);
  });

  it('dispense les bases locales éphémères (CI, PostgreSQL embarqué)', async () => {
    const query = jest.fn();
    await expect(assertTestDatabaseMarker(query, LOCAL)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('assertDisposableTestDatabases (protection bloquante, Sprint 8)', () => {
  const LOCAL = 'postgresql://postgres@127.0.0.1:55440/suite';
  const LOCAL_SCHOOL = 'postgresql://postgres@127.0.0.1:55440/school';
  const REMOTE_TEST = 'postgresql://u:p@ep-test-pooler.eu-central-1.aws.neon.tech/neondb';

  it('accepte des bases locales jetables distinctes des bases de l’application', () => {
    expect(() =>
      assertDisposableTestDatabases([LOCAL, LOCAL_SCHOOL], { DATABASE_URL: MAIN_POOLED }),
    ).not.toThrow();
  });

  it('refuse une base distante sans dérogation explicite', () => {
    expect(() => assertDisposableTestDatabases([REMOTE_TEST], {})).toThrow(/locale jetable/);
    expect(() =>
      assertDisposableTestDatabases([REMOTE_TEST], { [REMOTE_TEST_OPT_IN]: '1' }),
    ).not.toThrow();
  });

  it('refuse la base de développement, même avec la dérogation', () => {
    expect(() =>
      assertDisposableTestDatabases([MAIN_DIRECT], {
        DATABASE_URL: MAIN_POOLED,
        [REMOTE_TEST_OPT_IN]: '1',
      }),
    ).toThrow(/base configurée/);
    expect(() =>
      assertDisposableTestDatabases([LOCAL_SCHOOL], { SCHOOL_DATABASE_URL: LOCAL_SCHOOL }),
    ).toThrow(/base configurée/);
  });

  it('admet la base locale éphémère déclarée par la CI, pas CI=true seul', () => {
    const ci = 'postgresql://postgres:postgres@localhost:5432/ocall_park_ci';
    expect(() =>
      assertDisposableTestDatabases([ci], { DATABASE_URL: ci, OCALL_TEST_EPHEMERAL_DATABASE: '1' }),
    ).not.toThrow();
    // Un runner auto-hébergé a CI=true mais peut viser une base persistante : refusé.
    expect(() => assertDisposableTestDatabases([ci], { DATABASE_URL: ci, CI: 'true' })).toThrow(
      /base configurée/,
    );
    expect(() => assertDisposableTestDatabases([ci], { DATABASE_URL: ci })).toThrow(
      /base configurée/,
    );
  });

  it('même base locale écrite autrement (localhost, 127.0.0.1, ::1, port, nom encodé) : refusée', () => {
    const dev = 'postgresql://u:p@localhost/ocall_dev';
    for (const alias of [
      'postgresql://u:p@127.0.0.1:5432/ocall_dev',
      'postgresql://u:p@[::1]:5432/ocall_dev',
      'postgresql://u:p@localhost:5432/ocall%5Fdev',
    ]) {
      expect(() => assertDisposableTestDatabases([alias], { DATABASE_URL: dev })).toThrow(
        /base configurée/,
      );
    }
    expect(() =>
      assertDisposableTestDatabases(['postgresql://u:p@127.0.0.1:5433/ocall_dev'], {
        DATABASE_URL: dev,
      }),
    ).not.toThrow();
  });

  it('refuse toute exécution en production', () => {
    expect(() => assertDisposableTestDatabases([LOCAL], { NODE_ENV: 'production' })).toThrow(
      /production/,
    );
  });
});
