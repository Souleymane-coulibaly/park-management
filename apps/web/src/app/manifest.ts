import type { MetadataRoute } from 'next';

/** Manifeste PWA : base pour l'installation sur tablettes et terminaux Android des sprints suivants. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ocall Park',
    short_name: 'Ocall Park',
    description: 'Logiciel de gestion pour parcs et restaurants.',
    start_url: '/app',
    display: 'standalone',
    background_color: '#F6F0E5',
    theme_color: '#176B53',
    lang: 'fr',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
