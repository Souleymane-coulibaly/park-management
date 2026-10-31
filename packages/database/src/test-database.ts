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

/**
 * Marqueur d'environnement (Sprint 13) : une base distante n'est utilisée par les tests que si
 * elle porte le marqueur `environment = test` (table `_ocall_environment`, posée une seule fois par
 * `pnpm db:mark-test`). Une base de production ou de développement, qui ne l'a jamais, est donc
 * refusée même si son URL est placée par erreur dans TEST_DATABASE_URL. Les bases locales
 * éphémères (CI, PostgreSQL embarqué) en sont dispensées.
 */
export const TEST_MARKER_TABLE = '_ocall_environment';
export const TEST_MARKER_QUERY = `SELECT "value" FROM "${TEST_MARKER_TABLE}" WHERE "key" = 'environment'`;

export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(identity(url).host);
}

export async function assertTestDatabaseMarker(
  query: (sql: string) => Promise<unknown>,
  databaseUrl: string,
): Promise<void> {
  if (isLocalDatabase(databaseUrl)) return;
  let rows: unknown;
  try {
    rows = await query(TEST_MARKER_QUERY);
  } catch {
    rows = [];
  }
  const value = Array.isArray(rows) ? (rows[0] as { value?: unknown } | undefined)?.value : null;
  if (value !== 'test') {
    throw new Error(
      'La base TEST_DATABASE_URL ne porte pas le marqueur d’environnement « test » : les tests refusent ' +
        'de s’y exécuter (protection contre une base de développement ou de production). Si c’est bien la ' +
        'branche Neon « test », posez le marqueur avec `pnpm db:mark-test`.',
    );
  }
}
