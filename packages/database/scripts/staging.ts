/**
 * Commandes de la base de PRÉPRODUCTION (Neon Europe, branche `staging`), Sprint 13 :
 *
 *   pnpm db:migrate:deploy:staging
 *   pnpm db:bootstrap-super-admin:staging -- --email … --first-name … --last-name …
 *
 * Garde-fous : seules les URL de `apps/api/.env.staging` sont utilisées (jamais `apps/api/.env`,
 * qui désigne la base de développement) ; refus si cette base est celle de développement ou de
 * test ; l'hôte n'est affiché que masqué ; `prisma migrate deploy` uniquement (jamais `db push` ni
 * `migrate reset`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const API_DIR = resolve(__dirname, '../../../apps/api');

function load(file: string): Record<string, string> {
  const path = resolve(API_DIR, file);
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

/** Identité d'une base : hôte sans « -pooler » et nom de la base. */
const identity = (url: string) => {
  const u = new URL(url);
  return `${u.hostname.replace('-pooler.', '.')}/${u.pathname.slice(1)}`;
};
const masked = (url: string) =>
  new URL(url).hostname.replace(/^(ep-[a-z]+-[a-z]+)-[a-z0-9]+/, '$1-***');

function stagingEnv(): { DATABASE_URL: string; DIRECT_URL: string } {
  const staging = load('.env.staging');
  if (!staging.DATABASE_URL || !staging.DIRECT_URL) {
    throw new Error(
      'apps/api/.env.staging doit définir DATABASE_URL et DIRECT_URL (branche staging).',
    );
  }
  const local = load('.env');
  for (const [name, url] of [
    ['DATABASE_URL (développement)', local.DATABASE_URL],
    ['TEST_DATABASE_URL (test)', local.TEST_DATABASE_URL],
  ] as const) {
    if (url && identity(url) === identity(staging.DATABASE_URL)) {
      throw new Error(`Refus : la base de staging est identique à ${name}.`);
    }
  }
  return { DATABASE_URL: staging.DATABASE_URL, DIRECT_URL: staging.DIRECT_URL };
}

function run(command: string, args: string[], env: Record<string, string>): number {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const [action, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const env = stagingEnv();
console.log(`Base cible : ${masked(env.DIRECT_URL)} (staging, Neon Europe).`);

if (action === 'migrate') {
  process.exit(run('prisma', ['migrate', 'deploy'], env));
} else if (action === 'status') {
  process.exit(run('prisma', ['migrate', 'status'], env));
} else if (action === 'bootstrap-super-admin') {
  process.exit(run('tsx', ['scripts/bootstrap-super-admin.ts', ...rest], env));
} else {
  console.error('Action inconnue : migrate, status ou bootstrap-super-admin.');
  process.exit(1);
}
