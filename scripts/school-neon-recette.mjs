#!/usr/bin/env node
/**
 * Recette Ocall School sur la base Neon School `test` — EN LOCAL UNIQUEMENT, jamais en CI.
 *
 * Vérifie explicitement l'identité de la base avant tout test :
 *   1. refus en CI ;
 *   2. base School distante attendue : point de terminaison Neon et nom de base fournis par l'opérateur
 *      (RECETTE_EXPECTED_ENDPOINT, RECETTE_EXPECTED_DATABASE), comparés à l'URL ;
 *   3. jamais une base configurée pour l'application (développement ou production) ;
 *   4. base Suite de test LOCALE (la dérogation distante ne vaut que pour la base School) ;
 *   5. marqueur d'environnement « test » présent.
 * Puis lance les tests d'intégration School avec OCALL_TEST_ALLOW_MARKED_REMOTE=1, pour cette seule
 * exécution. Aucune URL complète ni aucun mot de passe n'est affiché.
 *
 * Usage :
 *   RECETTE_EXPECTED_ENDPOINT=ep-xxxx RECETTE_EXPECTED_DATABASE=neondb \
 *   SCHOOL_TEST_DATABASE_URL=… TEST_DATABASE_URL=postgresql://…@127.0.0.1/… \
 *   pnpm school:recette:neon [-- motif de spec jest]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import db from '@ocall/database';

const { PrismaClient, TEST_MARKER_QUERY, databaseIdentity, isLocalDatabase } = db;

function refuse(message) {
  console.error(`Refus : ${message}`);
  process.exit(1);
}

// Présence seule, même vide (CI="") : un environnement d’intégration continue est toujours refusé.
if (process.env.CI !== undefined || process.env.GITHUB_ACTIONS !== undefined) {
  refuse(
    'la recette Neon ne s’exécute jamais en CI (la CI utilise des bases PostgreSQL jetables).',
  );
}

const schoolUrl = process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL;
const suiteUrl = process.env.TEST_DATABASE_URL;
const expectedEndpoint = process.env.RECETTE_EXPECTED_ENDPOINT?.trim();
const expectedDatabase = process.env.RECETTE_EXPECTED_DATABASE?.trim();
if (!schoolUrl) refuse('SCHOOL_TEST_DATABASE_URL (ou TEST_SCHOOL_DATABASE_URL) est absente.');
if (!suiteUrl) refuse('TEST_DATABASE_URL (base Suite de test locale) est absente.');
if (!expectedEndpoint || !expectedDatabase) {
  refuse(
    'RECETTE_EXPECTED_ENDPOINT et RECETTE_EXPECTED_DATABASE sont obligatoires (identité attendue).',
  );
}

/**
 * Valide une URL de base AVANT tout usage : une URL invalide est refusée par un message générique qui
 * nomme seulement la variable — jamais l’exception, dont l’entrée contient l’URL complète (mot de passe).
 */
function assertValidUrl(name, value) {
  try {
    new URL(value);
  } catch {
    refuse(`la variable ${name} contient une URL de base invalide.`);
  }
}
assertValidUrl('TEST_DATABASE_URL', suiteUrl);

let target;
try {
  const parsed = new URL(schoolUrl);
  target = {
    host: parsed.hostname.replace('-pooler.', '.'),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
} catch {
  refuse('l’URL de la base School de test est invalide.');
}
if (isLocalDatabase(schoolUrl)) {
  refuse('la base School est locale : utilisez les tests ordinaires, sans recette Neon.');
}
if (!target.host.startsWith(`${expectedEndpoint}.`) || target.database !== expectedDatabase) {
  refuse(
    `la base School (hôte ${target.host}, base ${target.database}) ne correspond pas à l’identité attendue ` +
      `(${expectedEndpoint}, ${expectedDatabase}).`,
  );
}
if (!isLocalDatabase(suiteUrl)) {
  refuse('la base Suite de test doit être locale et jetable pendant la recette School.');
}

// Bases configurées pour l'application (apps/api/.env lu sans injection, et environnement courant).
const apiEnv = existsSync('apps/api/.env') ? dotenv.parse(readFileSync('apps/api/.env')) : {};
const configuredEntries = [
  ['DATABASE_URL (apps/api/.env)', apiEnv.DATABASE_URL],
  ['DIRECT_URL (apps/api/.env)', apiEnv.DIRECT_URL],
  ['SCHOOL_DATABASE_URL (apps/api/.env)', apiEnv.SCHOOL_DATABASE_URL],
  ['SCHOOL_DIRECT_URL (apps/api/.env)', apiEnv.SCHOOL_DIRECT_URL],
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['DIRECT_URL', process.env.DIRECT_URL],
  ['SCHOOL_DATABASE_URL', process.env.SCHOOL_DATABASE_URL],
  ['SCHOOL_DIRECT_URL', process.env.SCHOOL_DIRECT_URL],
].filter(([, u]) => Boolean(u));
for (const [name, u] of configuredEntries) assertValidUrl(name, u);
const configured = configuredEntries.map(([, u]) => databaseIdentity(u));
if (configured.includes(databaseIdentity(schoolUrl))) {
  refuse('la base School de test désigne une base configurée pour l’application.');
}

const probe = new PrismaClient({ datasourceUrl: schoolUrl });
let marker = '';
try {
  const rows = await probe.$queryRawUnsafe(TEST_MARKER_QUERY);
  marker = String(rows?.[0]?.value ?? '');
} catch {
  marker = '';
} finally {
  await probe.$disconnect();
}
if (marker !== 'test') refuse('la base School ne porte pas le marqueur d’environnement « test ».');

console.log(`Identité vérifiée : hôte ${target.host}, base ${target.database}, marqueur « test ».`);
const args = process.argv.slice(2).filter((a) => a !== '--');
const jestArgs = args.length
  ? args
  : ['--testPathPattern', 'test/school-.*\\.integration\\.spec\\.ts$'];
const result = spawnSync(
  'pnpm',
  ['--filter', '@ocall/api', 'exec', 'jest', '--runInBand', ...jestArgs],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      SCHOOL_TEST_DATABASE_URL: schoolUrl,
      OCALL_TEST_ALLOW_MARKED_REMOTE: '1',
    },
  },
);
process.exit(result.status ?? 1);
