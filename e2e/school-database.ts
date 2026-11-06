import { PrismaClient, assertTestDatabaseMarker, databaseIdentity } from '@ocall/database';

/**
 * Base Ocall School des tests E2E : `TEST_SCHOOL_DATABASE_URL` (ou `SCHOOL_TEST_DATABASE_URL`, comme les
 * tests d'intégration). Absente : les specs School sont ignorées hors CI. Elle doit être distincte de
 * la base Suite de test et de toute base configurée pour l'application (développement ou production).
 */
export function resolveSchoolTestDatabase(
  env: NodeJS.ProcessEnv,
  suiteTestUrl: string,
): string | null {
  const url = env.SCHOOL_TEST_DATABASE_URL ?? env.TEST_SCHOOL_DATABASE_URL;
  if (!url) return null;
  const school = databaseIdentity(url);
  if (school === databaseIdentity(suiteTestUrl)) {
    throw new Error('Refus : la base School de test doit être distincte de la base Suite de test.');
  }
  // Le conteneur de CI, déclaré jetable, sert à la fois de base configurée et de base de test.
  const ephemeral = env.OCALL_TEST_EPHEMERAL_DATABASE === '1';
  const configured = [env.SCHOOL_DATABASE_URL, env.DATABASE_URL, env.DIRECT_URL]
    .filter((u): u is string => Boolean(u))
    .map(databaseIdentity);
  if (!ephemeral && configured.includes(school)) {
    throw new Error(
      'Refus : la base School de test désigne une base configurée pour l’application (développement ou production).',
    );
  }
  return url;
}

/** Une base School distante n'est acceptée que si elle porte le marqueur d'environnement « test ». */
export async function assertSchoolTestDatabase(url: string): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await assertTestDatabaseMarker((sql) => db.$queryRawUnsafe(sql), url);
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
  url: string,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  const db = new PrismaClient({ datasourceUrl: url });
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
