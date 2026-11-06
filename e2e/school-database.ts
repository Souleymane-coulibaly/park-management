import {
  PrismaClient,
  TEST_MARKER_QUERY,
  databaseIdentity,
  isLocalDatabase,
} from '@ocall/database';

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
 */
export async function assertSchoolTestDatabase(target: SchoolTestDatabase): Promise<void> {
  if (target.ephemeral) return;
  const db = new PrismaClient({ datasourceUrl: target.url });
  let value: unknown = null;
  try {
    const rows = (await db.$queryRawUnsafe(TEST_MARKER_QUERY)) as { value?: unknown }[];
    value = rows[0]?.value ?? null;
  } catch {
    value = null;
  } finally {
    await db.$disconnect();
  }
  if (value !== 'test') {
    throw new Error(
      'Refus : la base School de test ne porte pas le marqueur « test » (pnpm db:school:mark-test), ' +
        'et n’est pas une base locale déclarée jetable (OCALL_TEST_EPHEMERAL_DATABASE=1).',
    );
  }
}

/** Comptes Suite des responsables (portail parents) des organisations E2E, avant la purge School. */
export async function schoolPortalUserIds(
  url: string,
  organizationIds: string[],
): Promise<string[]> {
  if (organizationIds.length === 0) return [];
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await db.$queryRaw<{ userId: string }[]>`
      SELECT "userId"::text AS "userId" FROM "SchoolPortalAccount"
      WHERE "organizationId"::text = ANY(${organizationIds}::text[])`;
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
