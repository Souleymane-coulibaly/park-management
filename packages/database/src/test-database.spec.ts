import { assertTestDatabaseMarker, resolveTestDatabase } from './test-database';

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
