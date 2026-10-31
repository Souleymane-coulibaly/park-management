import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { resolveTestDatabase } from '@ocall/database';
import { type BusinessType, type StoredPlatformRole, platformRoleRequiresMfa } from '@ocall/shared';
import { hash } from 'argon2';
import { currentStep, totpCode } from '../src/common/security/totp';
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

export interface InternalAccount {
  agent: Agent;
  id: string;
  email: string;
  /** Secret TOTP en clair (rôles soumis à la MFA), pour calculer des codes dans les tests. */
  secret: string | null;
  recoveryCodes: string[];
}

/**
 * Compte interne Ocall connecté. Pour les rôles soumis à la double authentification, l'enrôlement
 * est fait par l'API (setup puis enable avec un code TOTP réel) : la session est alors validée.
 */
export async function internalAccount(
  app: INestApplication,
  prisma: PrismaService,
  label: string,
  role: StoredPlatformRole,
): Promise<InternalAccount> {
  const address = email(label);
  const user = await prisma.user.create({
    data: {
      email: address,
      loginId: address,
      firstName: 'Interne',
      lastName: label,
      platformRole: role,
      mustChangePassword: false,
      passwordHash: await hash(PASSWORD, { type: 2 }),
    },
    select: { id: true },
  });
  const { agent: a, status } = await login(app, address, PASSWORD);
  if (status !== 200) throw new Error(`Connexion du compte interne ${label} : HTTP ${status}`);
  if (!platformRoleRequiresMfa(role)) {
    return { agent: a, id: user.id, email: address, secret: null, recoveryCodes: [] };
  }
  const setup = await a.post('/api/v1/auth/mfa/setup').expect(200);
  const secret: string = setup.body.secret;
  const enabled = await a
    .post('/api/v1/auth/mfa/enable')
    .send({ code: totpCode(secret, currentStep()) })
    .expect(200);
  return {
    agent: a,
    id: user.id,
    email: address,
    secret,
    recoveryCodes: enabled.body.recoveryCodes,
  };
}

/** Organisations de test : « Test <libellé> <RUN> », RUN étant 8 caractères hexadécimaux. */
const TEST_ORG_NAME = /^Test .+ [0-9a-f]{8}$/;
/** Au-delà de ce délai, une organisation de test est un reste d'exécution interrompue. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Supprime les organisations et comptes créés par cette exécution, ainsi que les restes d'une
 * exécution interrompue (processus arrêté avant son nettoyage). Ne s'exécute que sur la base
 * de test : createTestApp() a refusé de démarrer sur toute autre base.
 */
export async function cleanup(prisma: PrismaService): Promise<void> {
  const stale = await prisma.organization.findMany({
    where: {
      name: { startsWith: 'Test ' },
      createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
    },
    select: { id: true, name: true },
  });
  const orgs = [
    ...(await prisma.organization.findMany({
      where: { name: { endsWith: RUN } },
      select: { id: true },
    })),
    ...stale.filter((o) => TEST_ORG_NAME.test(o.name)),
  ];
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
  // Sprint 12A : remises d'espèces (liées aux comptes internes) et demandes de démonstration.
  await prisma.subscriptionPayment.updateMany({
    where: { remittance: { collectorId: { in: userIds } } },
    data: { remittanceId: null },
  });
  await prisma.cashRemittance.deleteMany({
    where: { OR: [{ collectorId: { in: userIds } }, { recordedById: { in: userIds } }] },
  });
  await prisma.demoRequest.deleteMany({
    where: { email: { endsWith: `${RUN}@test.ocallpark.local` } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
