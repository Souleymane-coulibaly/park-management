/**
 * `pnpm db:school:migrate:deploy` : migrations de la base Ocall School.
 *
 * Sans SCHOOL_ENABLED=true : ne fait rien, pour qu'un déploiement d'Ocall Park reste inchangé.
 * Refuse toute instruction destructrice, et une base School identique à la base Suite. L'hôte n'est
 * jamais affiché en entier.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { findDestructiveStatements } from '@ocall/database';

const envFile = resolve(__dirname, '../../../apps/api/.env');
const env = { ...(existsSync(envFile) ? parse(readFileSync(envFile)) : {}), ...process.env };

if (env.SCHOOL_ENABLED !== 'true') {
  console.log('Ocall School désactivé (SCHOOL_ENABLED) : aucune migration School.');
  process.exit(0);
}

const databaseUrl = env.SCHOOL_DATABASE_URL;
const directUrl = env.SCHOOL_DIRECT_URL ?? databaseUrl;
if (!databaseUrl || !directUrl) {
  console.error('SCHOOL_DATABASE_URL est obligatoire quand SCHOOL_ENABLED=true.');
  process.exit(1);
}

const identity = (url: string) => {
  const u = new URL(url);
  return `${u.host.replace('-pooler.', '.')}/${u.pathname.slice(1)}`;
};
if (env.DATABASE_URL && identity(env.DATABASE_URL) === identity(databaseUrl)) {
  console.error('Refus : la base School doit être distincte de la base Ocall Suite.');
  process.exit(1);
}

const root = join(__dirname, '..', 'prisma', 'migrations');
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const statements = findDestructiveStatements(
    readFileSync(join(root, entry.name, 'migration.sql'), 'utf8'),
  );
  if (statements.length > 0) {
    console.error(`Migration destructrice refusée : ${entry.name} (${statements.join(', ')}).`);
    process.exit(1);
  }
}

console.log(
  `Base School : ${new URL(directUrl).hostname.replace(/^(ep-[a-z]+-[a-z]+).*/, '$1-***')}.`,
);
const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...env, SCHOOL_DATABASE_URL: databaseUrl, SCHOOL_DIRECT_URL: directUrl },
});
process.exit(result.status ?? 1);
