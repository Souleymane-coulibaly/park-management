/**
 * `pnpm db:mark-test` : pose le marqueur d'environnement « test » sur la base TEST_DATABASE_URL
 * (branche Neon `test`), à faire une seule fois. Refusé si TEST_DATABASE_URL désigne la base de
 * développement (resolveTestDatabase). N'écrit que dans la table dédiée `_ocall_environment`.
 */
import { PrismaClient } from '@prisma/client';
import { TEST_MARKER_TABLE, resolveTestDatabase } from '../src/test-database';

async function main() {
  const test = resolveTestDatabase();
  const host = new URL(test.directUrl).hostname.replace(/^(ep-[a-z]+-[a-z]+)-[a-z0-9]+/, '$1-***');
  const prisma = new PrismaClient({ datasourceUrl: test.directUrl });
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${TEST_MARKER_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL, "markedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${TEST_MARKER_TABLE}" ("key", "value") VALUES ('environment', 'test') ON CONFLICT ("key") DO UPDATE SET "value" = 'test', "markedAt" = now()`,
    );
    console.log(`Marqueur « test » posé sur ${host}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
