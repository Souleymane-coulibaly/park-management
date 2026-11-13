/**
 * Copie dans `public/vendor` les fichiers d'exécution servis par le site lui-même (aucun appel à un CDN) :
 * le décodeur WebAssembly de zxing-wasm, utilisé par le scan caméra d'Ocall Stock quand le navigateur n'a
 * pas de détecteur natif (iPhone, iPad). Lancé avant `next dev` et `next build` ; fichier non versionné.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm');
const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'vendor',
  'zxing_reader.wasm',
);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log('zxing_reader.wasm copié dans public/vendor');
