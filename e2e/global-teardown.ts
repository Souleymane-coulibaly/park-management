import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { PrismaClient, resolveTestDatabase } from '@ocall/database';
import {
  purgeSchoolOrganizations,
  resolveSchoolTestDatabase,
  schoolPortalUserIds,
} from './school-database';
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
    // Données Ocall School des organisations E2E (base distincte, sans clé étrangère vers la Suite).
    // Comptes des responsables (portail parents) : sans adhésion à l'organisation, relevés avant la purge.
    const school = resolveSchoolTestDatabase({ ...apiEnv, ...process.env }, testDb.databaseUrl);
    const portalUsers = school ? await schoolPortalUserIds(school, orgIds) : [];
    if (school) await purgeSchoolOrganizations(school, orgIds);
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: { in: orgIds } },
      select: { userId: true },
    });
    // Responsable : supprimé seulement s'il n'est membre d'aucune organisation (aucune autre référence).
    const parentsWithMembership = new Set(
      (
        await prisma.organizationMembership.findMany({
          where: { userId: { in: portalUsers } },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const userIds = [
      ...new Set([
        ...members.map((m) => m.userId),
        ...portalUsers.filter((u) => !parentsWithMembership.has(u)),
      ]),
    ];
    await prisma.auditLog.deleteMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { actorUserId: { in: userIds } }] },
    });
    // Contrats Ocall Suite des clients School E2E (référence Restrict vers l'organisation).
    await prisma.suiteContractEvent.deleteMany({
      where: { contract: { organizationId: { in: orgIds } } },
    });
    await prisma.suiteContract.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
}
