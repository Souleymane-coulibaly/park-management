/**
 * `pnpm db:check` : vérifie la connexion à PostgreSQL (Neon) et l'état des migrations.
 * N'affiche jamais l'URL de connexion ni le mot de passe.
 */
import { PrismaClient } from '@prisma/client';

function describeTarget(url: string | undefined): string {
  if (!url) return '(DATABASE_URL absente)';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}/${parsed.pathname.replace('/', '')}`;
  } catch {
    return '(DATABASE_URL invalide)';
  }
}

async function main(): Promise<void> {
  console.log(`Cible : ${describeTarget(process.env.DATABASE_URL)}`);
  const prisma = new PrismaClient();
  try {
    const [row] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    console.log(`Connexion OK — ${row?.version.split(',')[0] ?? 'version inconnue'}`);

    const [table] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`;
    if (!table?.exists) {
      console.log('Aucune migration appliquée. Lancez : pnpm db:migrate:deploy');
      return;
    }
    const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at`;
    for (const m of applied) {
      console.log(`  ${m.finished_at ? '✔' : '✖ (échouée)'} ${m.migration_name}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la connexion :', error instanceof Error ? error.message : error);
  process.exit(1);
});
