export const dynamic = 'force-static';

/** Version du déploiement : un nouveau déploiement change le fichier, donc déclenche une mise à jour. */
const VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local';

/**
 * Service Worker de l'espace client (portée /app). Ne met en cache que des ressources publiques et
 * immuables : fichiers `_next/static`, icônes et page hors ligne. Jamais `/api`, jamais les pages de
 * l'application : aucune donnée de vente, de visiteur ou de session ne peut se retrouver en cache, et
 * aucune décision d'entrée ne peut être prise sans le serveur.
 */
const SOURCE = `
const CACHE = 'ocall-static-${VERSION}';
const OFFLINE_URL = '/hors-ligne';
const isStatic = (path) =>
  path.startsWith('/_next/static/') || path.startsWith('/icons/') || path === '/icon.svg';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(OFFLINE_URL, { cache: 'reload' });
    if (!response.ok) throw new Error('Page hors ligne indisponible');
    const html = await response.clone().text();
    await cache.put(OFFLINE_URL, response);
    const assets = html.match(/\\/_next\\/static\\/[^"'\\\\\\s)]+/g) ?? [];
    await Promise.allSettled([...new Set(assets)].map((url) => cache.add(url)));
    await cache.add('/icons/icon-192.png');
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Une nouvelle version n'est activée que sur demande de l'utilisateur, jamais pendant un contrôle.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(OFFLINE_URL)) ?? new Response('Hors connexion', { status: 503 }),
      ),
    );
    return;
  }
  if (!isStatic(url.pathname)) return;
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
`;

export function GET(): Response {
  return new Response(SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
