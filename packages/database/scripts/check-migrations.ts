/**
 * `pnpm db:migrate:check` : refuse toute migration contenant une instruction destructrice.
 * Exécuté automatiquement avant chaque `db:migrate:deploy` (et donc avant chaque déploiement Railway)
 * ainsi qu'en CI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESTRUCTIVE_APPROVAL_MARKER, findDestructiveStatements } from '../src/migration-safety';

const root = join(__dirname, '..', 'prisma', 'migrations');
const problems = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    migration: entry.name,
    statements: findDestructiveStatements(
      readFileSync(join(root, entry.name, 'migration.sql'), 'utf8'),
    ),
  }))
  .filter((p) => p.statements.length > 0);

if (problems.length > 0) {
  console.error('Migrations destructrices détectées :');
  for (const p of problems) console.error(`  ✖ ${p.migration} : ${p.statements.join(', ')}`);
  console.error(
    `Découpez la modification en étapes additives, ou, après validation explicite, ajoutez « ${DESTRUCTIVE_APPROVAL_MARKER} » dans le fichier.`,
  );
  process.exit(1);
}
console.log('Migrations vérifiées : aucune instruction destructrice.');
