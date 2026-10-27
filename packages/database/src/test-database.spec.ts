import { resolveTestDatabase } from './test-database';

const MAIN_POOLED =
  'postgresql://u:p@ep-main-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const MAIN_DIRECT = 'postgresql://u:p@ep-main.us-east-2.aws.neon.tech/neondb?sslmode=require';
const DEV = 'postgresql://u:p@ep-dev-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('resolveTestDatabase', () => {
  it('refuse de démarrer sans TEST_DATABASE_URL', () => {
    expect(() => resolveTestDatabase({ DATABASE_URL: MAIN_POOLED })).toThrow(/TEST_DATABASE_URL/);
  });

  it('refuse une base de test identique à la base principale (même avec ou sans -pooler)', () => {
    expect(() =>
      resolveTestDatabase({ DATABASE_URL: MAIN_POOLED, TEST_DATABASE_URL: MAIN_DIRECT }),
    ).toThrow(/même base/);
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
