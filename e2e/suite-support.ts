import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { parse } from 'dotenv';
import { PrismaClient, resolveTestDatabase } from '@ocall/database';
import { currentStep, totpCode } from '../apps/api/src/common/security/totp';
import { apiCaller } from './school-support';
import { E2E_INTERNAL_DOMAIN, PASSWORD } from './support';

/**
 * Support des E2E Ocall Suite S2 : compte Super Admin de test (double authentification réelle) et
 * préparation d'abonnements sur la base de TEST uniquement. Données fictives.
 */
const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
// Même hachage que l'API (argon2id), résolu depuis le paquet de l'API.
const apiRequire = createRequire(join(process.cwd(), 'apps/api/package.json'));
const argon2 = apiRequire('argon2') as {
  hash: (password: string, options: { type: number }) => Promise<string>;
};

/**
 * Super Admin Ocall de test (gestionnaire de facturation) : compte créé sur la base de test, connexion
 * puis enrôlement de la double authentification par l'API, comme un compte réel. Retourne une page
 * connectée, session vérifiée.
 */
export async function superAdminPage(
  browser: Browser,
  label: string,
  role: 'BILLING_MANAGER' | 'PLATFORM_ADMIN' | 'PLATFORM_OWNER' = 'BILLING_MANAGER',
): Promise<Page> {
  const email = `${label}.${Date.now()}${E2E_INTERNAL_DOMAIN}`;
  const db = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    await db.user.create({
      data: {
        email,
        loginId: email,
        firstName: 'Ocall',
        lastName: 'Facturation',
        platformRole: role,
        mustChangePassword: false,
        passwordHash: await argon2.hash(PASSWORD, { type: 2 }),
      },
    });
  } finally {
    await db.$disconnect();
  }
  const page = await (await browser.newContext()).newPage();
  await page.goto('/connexion');
  const call = apiCaller(page);
  const login = await call('/auth/login', 'POST', { identifier: email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const setup = await call<{ secret: string }>('/auth/mfa/setup', 'POST');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const enable = await call('/auth/mfa/enable', 'POST', {
    code: totpCode(setup.body.secret, currentStep()),
  });
  expect(enable.status, JSON.stringify(enable.body)).toBe(200);
  return page;
}

/**
 * Abonnement Ocall Park de l'organisation passé en abonnement payant actif (tarif contractuel figé),
 * comme après un premier règlement validé par Ocall.
 */
export async function activateParkSubscription(
  organizationId: string,
  agreedMonthlyPrice: number,
  daysLeft = 5,
): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    const now = Date.now();
    await db.subscription.updateMany({
      where: { organizationId, product: { code: 'OCALL_PARK' } },
      data: {
        status: 'ACTIVE',
        startedAt: new Date(now - 25 * 86_400_000),
        expiresAt: new Date(now + daysLeft * 86_400_000),
        agreedMonthlyPrice,
        agreedSetupFee: 200_000,
        agreedAt: new Date(now - 25 * 86_400_000),
      },
    });
  } finally {
    await db.$disconnect();
  }
}

/** Accès direct à la base de TEST (préparation et simulations datées, jamais en exploitation). */
export async function withTestDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

/** Connexion d'un compte (partenaire, interne) dans une page, avec enrôlement TOTP si nécessaire. */
export async function loginWithMfa(page: Page, identifier: string): Promise<void> {
  await page.goto('/connexion');
  const call = apiCaller(page);
  const login = await call('/auth/login', 'POST', { identifier, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const setup = await call<{ secret: string }>('/auth/mfa/setup', 'POST');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const enable = await call('/auth/mfa/enable', 'POST', {
    code: totpCode(setup.body.secret, currentStep()),
  });
  expect(enable.status, JSON.stringify(enable.body)).toBe(200);
}
