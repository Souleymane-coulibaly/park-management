import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { PrismaClient, resolveTestDatabase } from '@ocall/database';
import { E2E_SUFFIX } from './support';

/** Supprime, sur la base de TEST uniquement, les organisations et comptes créés par les tests E2E. */
export default async function globalTeardown(): Promise<void> {
  const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
  const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
  const prisma = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    const orgs = await prisma.organization.findMany({
      where: { name: { endsWith: E2E_SUFFIX } },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: { in: orgIds } },
      select: { userId: true },
    });
    const userIds = [...new Set(members.map((m) => m.userId))];
    await prisma.auditLog.deleteMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { actorUserId: { in: userIds } }] },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
}
