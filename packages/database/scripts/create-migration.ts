/**
 * `pnpm db:migrate:create -- <nom>` : génère une nouvelle migration à partir de schema.prisma,
 * SANS jamais modifier ni réinitialiser une base.
 *
 * Contrairement à `prisma migrate dev` (qui peut proposer de réinitialiser la base en cas d'écart),
 * ce script lit seulement l'état de la base de développement (DIRECT_URL) pour calculer le SQL,
 * l'écrit dans prisma/migrations, puis vérifie qu'il n'est pas destructeur.
 * La migration est ensuite relue, puis appliquée avec `pnpm db:migrate:deploy`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDestructiveStatements } from '../src/migration-safety';

// pnpm transmet le séparateur « -- » : le nom est le premier argument qui n'en est pas un.
const name = process.argv
  .slice(2)
  .find((arg) => arg !== '--')
  ?.toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_|_$/g, '');
if (!name) throw new Error('Usage : pnpm db:migrate:create -- <nom_de_la_migration>');
const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL est absente (apps/api/.env).');

const prisma = (args: string[]) =>
  execFileSync('prisma', args, { encoding: 'utf8', shell: true, env: process.env });

// La base doit être à jour : sinon le SQL calculé inclurait des migrations déjà écrites.
const status = (() => {
  try {
    return prisma(['migrate', 'status']);
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? error);
  }
})();
if (!/Database schema is up to date/i.test(status)) {
  throw new Error(
    'La base de développement n’est pas à jour : lancez d’abord pnpm db:migrate:deploy.',
  );
}

// Lecture seule : compare l'état réel de la base au schéma Prisma.
const sql = prisma([
  'migrate',
  'diff',
  '--from-url',
  `"${url}"`,
  '--to-schema-datamodel',
  'prisma/schema.prisma',
  '--script',
]);
if (!sql.trim() || /^-- This is an empty migration/m.test(sql)) {
  console.log('Aucune différence entre la base et le schéma : aucune migration créée.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = join(__dirname, '..', 'prisma', 'migrations', `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'migration.sql'), sql);
console.log(`Migration créée : ${dir}`);

const destructive = findDestructiveStatements(sql);
if (destructive.length > 0) {
  console.error(
    `⚠ Instructions destructrices : ${destructive.join(', ')}. Le déploiement sera bloqué.`,
  );
  process.exit(1);
}
console.log('Relisez le SQL, puis appliquez-le avec : pnpm db:migrate:deploy');
