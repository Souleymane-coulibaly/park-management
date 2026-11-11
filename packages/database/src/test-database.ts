import { databaseIdentity } from './migration-safety';

/**
 * Garde-fou des tests automatisés : les tests d'intégration et E2E créent puis suppriment
 * des données. Ils ne s’exécutent QUE sur une base dédiée (`TEST_DATABASE_URL`, branche Neon
 * `test` ou base éphémère de CI), jamais sur la base de développement (`DATABASE_URL`).
 */
export interface TestDatabase {
  databaseUrl: string;
  directUrl: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

/** Déclaration explicite d'une base locale éphémère partagée avec l'application (conteneur de CI). */
export const EPHEMERAL_OPT_IN = 'OCALL_TEST_EPHEMERAL_DATABASE';

/** Dérogation explicite, par exécution, pour une base distante marquée « test » (recette autorisée). */
export const REMOTE_TEST_OPT_IN = 'OCALL_TEST_ALLOW_MARKED_REMOTE';

/**
 * Protection bloquante des tests d'intégration : ils ne s'exécutent que sur des bases PostgreSQL locales
 * jetables. Refus si une base de test est distante (sauf dérogation explicite, et le marqueur « test »
 * reste alors exigé), si elle désigne une base configurée pour l'application (développement ou
 * production : `DATABASE_URL`, `DIRECT_URL`, `SCHOOL_DATABASE_URL`, `FACTURE_DATABASE_URL`,
 * `STOCK_DATABASE_URL`), ou en
 * environnement de production.
 */
export function assertDisposableTestDatabases(
  urls: readonly (string | undefined)[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT_NAME === 'production') {
    throw new Error('Refus : aucun test d’intégration en environnement de production.');
  }
  // Identité canonique (alias locaux, port effectif, nom décodé) : une même base, écrite autrement,
  // reste la même base.
  const configured = new Set(
    [
      env.DATABASE_URL,
      env.DIRECT_URL,
      env.SCHOOL_DATABASE_URL,
      env.FACTURE_DATABASE_URL,
      env.STOCK_DATABASE_URL,
    ]
      .filter((u): u is string => Boolean(u))
      .map((u) => databaseIdentity(u)),
  );
  for (const url of urls) {
    if (!url) continue;
    const test = identity(url);
    // Seul cas admis : base locale DÉCLARÉE jetable par le pipeline qui la crée et la détruit (conteneur
    // de service). `CI=true` ne prouve rien (un runner auto-hébergé peut viser une base persistante).
    const ciEphemeral = env[EPHEMERAL_OPT_IN] === '1' && LOCAL_HOSTS.has(test.host);
    if (!ciEphemeral && configured.has(databaseIdentity(url))) {
      throw new Error(
        'Refus : une base de test désigne une base configurée pour l’application (développement ou production).',
      );
    }
    if (!LOCAL_HOSTS.has(test.host) && env[REMOTE_TEST_OPT_IN] !== '1') {
      throw new Error(
        'Refus : les tests d’intégration exigent une base PostgreSQL locale jetable. Une base distante ' +
          `marquée « test » n’est acceptée qu’avec ${REMOTE_TEST_OPT_IN}=1, pour une exécution autorisée.`,
      );
    }
  }
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
