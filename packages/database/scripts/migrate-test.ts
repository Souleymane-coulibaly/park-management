/**
 * `pnpm db:migrate:deploy:test` : applique les migrations en attente sur la base de TEST
 * (TEST_DATABASE_URL, branche Neon `test`). Non destructif : `prisma migrate deploy` uniquement.
 */
import { spawnSync } from 'node:child_process';
import { resolveTestDatabase } from '../src/test-database';

const test = resolveTestDatabase();
const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: test.databaseUrl, DIRECT_URL: test.directUrl },
});
process.exit(result.status ?? 1);
