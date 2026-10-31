import type { MetadataRoute } from 'next';

/** Manifeste de la PWA : installation sur smartphones et tablettes, sans passer par les stores. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: 'Ocall Park',
    short_name: 'Ocall Park',
    description: 'Logiciel de gestion pour parcs et restaurants.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    // Caisse utilisable en portrait comme en paysage sur tablette.
    orientation: 'any',
    background_color: '#F6F0E5',
    theme_color: '#176B53',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Billetterie', url: '/app/billetterie' },
      { name: 'Contrôle des entrées', url: '/app/controle-acces' },
    ],
  };
}
