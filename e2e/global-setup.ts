import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { PrismaClient, assertTestDatabaseMarker, resolveTestDatabase } from '@ocall/database';

/**
 * Avant tout test E2E : la base de test distante doit porter le marqueur d'environnement « test »
 * (Sprint 13). Une base de développement ou de production est refusée.
 */
export default async function globalSetup(): Promise<void> {
  const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
  const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
  const prisma = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    await assertTestDatabaseMarker((sql) => prisma.$queryRawUnsafe(sql), testDb.databaseUrl);
  } finally {
    await prisma.$disconnect();
  }
}
