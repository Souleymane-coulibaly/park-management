/**
 * Garde-fou des tests automatisés : les tests d'intégration et E2E créent puis suppriment
 * des données. Ils ne s’exécutent QUE sur une base dédiée (`TEST_DATABASE_URL`, branche Neon
 * `test` ou base éphémère de CI), jamais sur la base de développement (`DATABASE_URL`).
 */
export interface TestDatabase {
  databaseUrl: string;
  directUrl: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Identité d'une base : hôte sans le suffixe « -pooler » de Neon, et nom de la base. */
function identity(url: string): { host: string; database: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.replace('-pooler.', '.'),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function resolveTestDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabase {
  const databaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL est absente : les tests refusent de s’exécuter sur la base de développement. ' +
        'Créez une branche Neon « test » (distincte de la base de développement) et renseignez TEST_DATABASE_URL / TEST_DIRECT_URL ' +
        'dans apps/api/.env (voir docs/DEPLOIEMENT-RAILWAY.md).',
    );
  }
  const test = identity(databaseUrl);
  if (env.DATABASE_URL && !LOCAL_HOSTS.has(test.host)) {
    const main = identity(env.DATABASE_URL);
    if (main.host === test.host && main.database === test.database) {
      throw new Error(
        'TEST_DATABASE_URL désigne la base de développement (DATABASE_URL) : utilisez la branche Neon « test ».',
      );
    }
  }
  return { databaseUrl, directUrl: env.TEST_DIRECT_URL ?? databaseUrl };
}
