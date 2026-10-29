import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { resolveTestDatabase } from '@ocall/database';

// Base de TEST obligatoire (branche Neon `test` ou base éphémère de CI) : la configuration échoue
// plutôt que de lancer les tests sur la base de développement. apps/api/.env est lu sans être injecté
// dans process.env, pour ne pas transmettre NODE_ENV=development au serveur Next.js de production.
const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });

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
      env: { DATABASE_URL: testDb.databaseUrl, DIRECT_URL: testDb.directUrl },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3000',
      cwd: 'apps/web',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
