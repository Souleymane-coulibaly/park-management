import { defineConfig, devices } from '@playwright/test';

/**
 * Tests E2E : l'API (port 4000) et le frontend (port 3000) doivent être construits
 * au préalable (`pnpm build`). En local, des serveurs déjà lancés sont réutilisés.
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
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3000',
      cwd: 'apps/web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
