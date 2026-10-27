import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { resolveTestDatabase } from '@ocall/database';
import type { BusinessType } from '@ocall/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

export const PASSWORD = 'Bamako2026Secure';
/** Suffixe unique par exécution : les données de test sont identifiables et nettoyées. */
export const RUN = randomBytes(4).toString('hex');

export type Agent = ReturnType<typeof request.agent>;

/**
 * Démarre l'API sur la base de TEST uniquement (TEST_DATABASE_URL) : refuse de s'exécuter
 * si elle est absente ou si elle désigne la base principale.
 */
export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const testDb = resolveTestDatabase();
  process.env.DATABASE_URL = testDb.databaseUrl;
  process.env.DIRECT_URL = testDb.directUrl;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export function agent(app: INestApplication): Agent {
  return request.agent(app.getHttpServer());
}

export function email(label: string): string {
  return `${label}.${RUN}@test.ocallpark.local`;
}

export interface SignedUpOwner {
  agent: Agent;
  organizationId: string;
  loginId: string;
  email: string;
}

export async function signup(
  app: INestApplication,
  label: string,
  businessType: BusinessType,
): Promise<SignedUpOwner> {
  const a = agent(app);
  const ownerEmail = email(label);
  const res = await a
    .post('/api/v1/auth/signup')
    .send({
      organizationName: `Test ${label} ${RUN}`,
      businessType,
      countryCode: 'ML',
      establishmentName: `Site principal ${label}`,
      firstName: 'Awa',
      lastName: 'Traoré',
      email: ownerEmail,
      password: PASSWORD,
    })
    .expect(201);
  return {
    agent: a,
    organizationId: res.body.organization.id,
    loginId: res.body.user.loginId,
    email: ownerEmail,
  };
}

export async function login(
  app: INestApplication,
  identifier: string,
  password: string,
): Promise<{ agent: Agent; status: number; body: any }> {
  const a = agent(app);
  const res = await a.post('/api/v1/auth/login').send({ identifier, password });
  return { agent: a, status: res.status, body: res.body };
}

/** Supprime toutes les organisations et comptes créés par cette exécution. */
export async function cleanup(prisma: PrismaService): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { name: { endsWith: RUN } },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: { in: orgIds } },
    select: { userId: true },
  });
  const byEmail = await prisma.user.findMany({
    where: { email: { endsWith: `${RUN}@test.ocallpark.local` } },
    select: { id: true },
  });
  const userIds = [...new Set([...members.map((m) => m.userId), ...byEmail.map((u) => u.id)])];
  await prisma.auditLog.deleteMany({
    where: { OR: [{ organizationId: { in: orgIds } }, { actorUserId: { in: userIds } }] },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
