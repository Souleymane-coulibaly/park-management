import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { PrismaClient, resolveTestDatabase } from '@ocall/database';
import {
  assertE2eDatabases,
  purgeSchoolOrganizations,
  resolveSchoolTestDatabase,
  schoolPortalUserIds,
} from './school-database';
import { E2E_INTERNAL_DOMAIN, E2E_SUFFIX } from './support';

/** Supprime, sur la base de TEST uniquement, les organisations et comptes créés par les tests E2E. */
export default async function globalTeardown(): Promise<void> {
  const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
  const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
  // Aucune suppression sur une base refusée, même si le setup a échoué avant (teardown exécuté).
  assertE2eDatabases(
    { ...apiEnv, ...process.env },
    testDb,
    resolveSchoolTestDatabase({ ...apiEnv, ...process.env }, testDb.databaseUrl),
  );
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
    // Comptes internes Ocall créés par les E2E (Super Admin, Sprint S2) : sans adhésion, repérés par
    // leur domaine de test dédié.
    const internals = await prisma.user.findMany({
      where: { email: { endsWith: E2E_INTERNAL_DOMAIN }, platformRole: { not: null } },
      select: { id: true },
    });
    // Comptes partenaires créés par les E2E (Sprint S3) : domaine de test, sans adhésion.
    const partnerUsers = await prisma.user.findMany({
      where: { email: { endsWith: '@e2e.ocallpark.local' }, partner: { isNot: null } },
      select: { id: true },
    });
    const userIds = [
      ...new Set([
        ...members.map((m) => m.userId),
        ...portalUsers.filter((u) => !parentsWithMembership.has(u)),
        ...internals.map((u) => u.id),
        ...partnerUsers.map((u) => u.id),
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
    await prisma.partnerApplication.deleteMany({
      where: { emailNormalized: { endsWith: '@e2e.ocallpark.local' } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
}
