export const dynamic = 'force-static';

/**
 * Manifeste du portail parents d'Ocall School (Sprint 6) : installable depuis le navigateur, ouvert sur
 * le portail. Aucune application native ; le Service Worker ne met en cache que des ressources publiques.
 */
export function GET() {
  return Response.json(
    {
      id: '/parents',
      name: 'Ocall School — Portail parents',
      short_name: 'Portail parents',
      description: 'Scolarité de vos enfants : présences, résultats, bulletins, annonces.',
      start_url: '/parents',
      scope: '/parents',
      display: 'standalone',
      orientation: 'any',
      background_color: '#F6F0E5',
      theme_color: '#176B53',
      lang: 'fr',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/icons/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
