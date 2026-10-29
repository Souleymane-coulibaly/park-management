#!/usr/bin/env node
/**
 * Exécute une commande en conservant l'intégralité de sa sortie dans test-logs/<nom>-<horodatage>.log,
 * tout en l'affichant normalement. Le code de sortie de la commande est conservé.
 * Objectif : disposer du journal complet d'un échec intermittent, même s'il ne se reproduit pas.
 *
 * Usage : node scripts/run-with-log.mjs <nom> <commande> [arguments…]
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [name, command, ...args] = process.argv.slice(2);
if (!name || !command) {
  console.error('Usage : node scripts/run-with-log.mjs <nom> <commande> [arguments…]');
  process.exit(2);
}

const dir = join(process.cwd(), 'test-logs');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(dir, `${name}-${stamp}.log`);
const log = createWriteStream(file);
log.write(`# ${new Date().toISOString()} — ${[command, ...args].join(' ')}\n\n`);

const child = spawn(command, args, { shell: process.platform === 'win32', env: process.env });
for (const [stream, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on('data', (chunk) => {
    target.write(chunk);
    log.write(chunk);
  });
}
child.on('close', (code, signal) => {
  log.end(`\n# Fin : code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}\n`, () => {
    console.log(`\nJournal complet : ${file}`);
    process.exit(code ?? 1);
  });
});
