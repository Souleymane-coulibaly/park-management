import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { resolveTestDatabase } from '@ocall/database';
import { resolveSchoolTestDatabase } from './e2e/school-database';

// Base de TEST obligatoire (branche Neon `test` ou base éphémère de CI) : la configuration échoue
// plutôt que de lancer les tests sur la base de développement. apps/api/.env est lu sans être injecté
// dans process.env, pour ne pas transmettre NODE_ENV=development au serveur Next.js de production.
const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
// Régénération des sites vitrines (API → frontend) : secret aléatoire propre à chaque exécution,
// jamais écrit dans le dépôt. Sans elle, une page dépubliée reste servie depuis le cache de Next.js.
const revalidateSecret = randomBytes(24).toString('hex');
// Ocall School : activé seulement avec une base School de test dédiée (TEST_SCHOOL_DATABASE_URL),
// distincte de la base Suite ; sinon les specs School sont ignorées (hors CI, où elles sont exigées).
const schoolDb = resolveSchoolTestDatabase({ ...apiEnv, ...process.env }, testDb.databaseUrl);
const schoolEnv: Record<string, string> = schoolDb
  ? {
      SCHOOL_ENABLED: 'true',
      SCHOOL_DATABASE_URL: schoolDb.url,
      // Clé de chiffrement aléatoire, propre à l'exécution : les données fictives ne lui survivent pas.
      SCHOOL_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }
  : { SCHOOL_ENABLED: 'false' };

/**
 * Tests E2E : l'API (port 4000) et le frontend (port 3000) doivent être construits au préalable
 * (`pnpm build`). Playwright démarre toujours ses propres serveurs, branchés sur la base de test :
 * un serveur de développement déjà lancé (potentiellement sur la base principale) n'est jamais réutilisé.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      // Lancement direct (sans pnpm) : plus fiable sous Windows et en CI.
      command: 'node dist/main.js',
      cwd: 'apps/api',
      url: 'http://localhost:4000/api/v1/health',
      // IA : fournisseur simulé uniquement (aucun appel réel, aucun coût) pendant les tests E2E.
      env: {
        DATABASE_URL: testDb.databaseUrl,
        DIRECT_URL: testDb.directUrl,
        AI_PROVIDER: 'simulated',
        AI_REAL_CALLS_ENABLED: 'false',
        SITES_DOMAIN_VERIFIER: 'simulated',
        MEDIA_STORAGE: 'local',
        // Une même IP enchaîne des dizaines d'inscriptions et de connexions : limite relevée pour le
        // seul serveur de test, comme pour les tests d'intégration (setup-env.ts). Sans cela, les tests
        // de fin de suite reçoivent 429 « Trop de requêtes » à l'inscription.
        LOGIN_THROTTLE_LIMIT: '10000',
        SITES_REVALIDATE_URL: 'http://localhost:3000/api/site-revalidate',
        SITES_REVALIDATE_SECRET: revalidateSecret,
        ...schoolEnv,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3000',
      cwd: 'apps/web',
      url: 'http://localhost:3000',
      env: { SITES_REVALIDATE_SECRET: revalidateSecret },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
