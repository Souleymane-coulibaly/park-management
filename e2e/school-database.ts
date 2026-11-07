import { execFileSync } from 'node:child_process';
import { PrismaClient, databaseIdentity, isLocalDatabase } from '@ocall/database';

/**
 * Base Ocall School des tests E2E : `TEST_SCHOOL_DATABASE_URL` (ou `SCHOOL_TEST_DATABASE_URL`, comme les
 * tests d'intégration). Absente : les specs School sont ignorées hors CI. Elle doit être distincte de
 * la base Suite de test et de toute base configurée pour l'application (développement ou production).
 */
export interface SchoolTestDatabase {
  url: string;
  /**
   * Base locale DÉCLARÉE jetable par le pipeline qui la crée et la détruit
   * (`OCALL_TEST_EPHEMERAL_DATABASE=1` et hôte local). Seul cas dispensé du marqueur « test ».
   */
  ephemeral: boolean;
}

export function resolveSchoolTestDatabase(
  env: NodeJS.ProcessEnv,
  suiteTestUrl: string,
): SchoolTestDatabase | null {
  const url = env.SCHOOL_TEST_DATABASE_URL ?? env.TEST_SCHOOL_DATABASE_URL;
  if (!url) return null;
  const school = databaseIdentity(url);
  if (school === databaseIdentity(suiteTestUrl)) {
    throw new Error('Refus : la base School de test doit être distincte de la base Suite de test.');
  }
  // Une URL locale ne prouve pas qu'une base est jetable (tunnel vers une base distante, ancienne base
  // persistante) : la dispense exige une déclaration explicite ET un hôte local.
  const ephemeral = env.OCALL_TEST_EPHEMERAL_DATABASE === '1' && isLocalDatabase(url);
  const configured = [env.SCHOOL_DATABASE_URL, env.DATABASE_URL, env.DIRECT_URL]
    .filter((u): u is string => Boolean(u))
    .map(databaseIdentity);
  if (!ephemeral && configured.includes(school)) {
    throw new Error(
      'Refus : la base School de test désigne une base configurée pour l’application (développement ou production).',
    );
  }
  return { url, ephemeral };
}

/**
 * Toute base School de test porte le marqueur d'environnement « test » (`pnpm db:school:mark-test`),
 * locale ou distante ; seule une base locale déclarée jetable en est dispensée.
 *
 * SYNCHRONE (processus enfant) : la configuration Playwright l'appelle à son chargement, AVANT le
 * démarrage des serveurs ; le setup et chaque opération destructive la rappellent.
 */
export function assertSchoolTestDatabase(target: SchoolTestDatabase): void {
  if (target.ephemeral) return;
  const probe = [
    "const { PrismaClient, TEST_MARKER_QUERY } = require('@ocall/database');",
    'const db = new PrismaClient({ datasourceUrl: process.env.OCALL_PROBE_URL });',
    'db.$queryRawUnsafe(TEST_MARKER_QUERY)',
    "  .then((rows) => process.stdout.write(String((rows[0] && rows[0].value) || '')), () => {})",
    '  .finally(() => db.$disconnect());',
  ].join('\n');
  let value = '';
  try {
    value = execFileSync(process.execPath, ['-e', probe], {
      env: { ...process.env, OCALL_PROBE_URL: target.url },
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    value = '';
  }
  if (value !== 'test') {
    throw new Error(
      'Refus : la base School de test ne porte pas le marqueur « test » (pnpm db:school:mark-test), ' +
        'et n’est pas une base locale déclarée jetable (OCALL_TEST_EPHEMERAL_DATABASE=1).',
    );
  }
}

/**
 * Comptes Suite des responsables (portail parents) des organisations E2E, à supprimer : seulement ceux
 * qui n'ont AUCUN accès portail dans une organisation conservée (pas de compte orphelin ailleurs).
 */
export async function schoolPortalUserIds(
  target: SchoolTestDatabase,
  organizationIds: string[],
): Promise<string[]> {
  assertSchoolTestDatabase(target);
  if (organizationIds.length === 0) return [];
  const db = new PrismaClient({ datasourceUrl: target.url });
  try {
    const rows = await db.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT a."userId"::text AS "userId" FROM "SchoolPortalAccount" a
      WHERE a."organizationId"::text = ANY(${organizationIds}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM "SchoolPortalAccount" o
          WHERE o."userId" = a."userId" AND NOT (o."organizationId"::text = ANY(${organizationIds}::text[]))
        )`;
    return rows.map((r) => r.userId);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Supprime de la base School de TEST les données des organisations E2E. Toutes les tables portent
 * `organizationId` et se référencent en `Restrict` : suppression par passes successives, chaque passe
 * retirant les lignes qui ne sont plus référencées, jusqu'à ce qu'il n'en reste aucune.
 */
export async function purgeSchoolOrganizations(
  target: SchoolTestDatabase,
  organizationIds: string[],
): Promise<void> {
  // Jamais sur une base refusée par la garde, même si le setup a échoué avant (teardown exécuté).
  assertSchoolTestDatabase(target);
  if (organizationIds.length === 0) return;
  const db = new PrismaClient({ datasourceUrl: target.url });
  try {
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organizationId'`;
    let pending = tables.map((t) => t.table_name);
    for (let pass = 0; pass < 20 && pending.length > 0; pass++) {
      const blocked: string[] = [];
      for (const table of pending) {
        try {
          await db.$executeRawUnsafe(
            `DELETE FROM "${table.replace(/"/g, '""')}" WHERE "organizationId"::text = ANY($1::text[])`,
            organizationIds,
          );
        } catch {
          blocked.push(table);
        }
      }
      pending = blocked;
    }
    if (pending.length > 0) {
      throw new Error(`Nettoyage School incomplet : ${pending.join(', ')}`);
    }
  } finally {
    await db.$disconnect();
  }
}
