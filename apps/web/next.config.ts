import type { NextConfig } from 'next';

/**
 * URL interne de l'API. Sur Railway : URL du réseau privé du service API
 * (ex. http://api.railway.internal:8080). En local : http://localhost:4000.
 */
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ocall/shared'],
  /**
   * Images des sites vitrines : redimensionnées et converties (AVIF/WebP) par l'optimiseur Next.js
   * (sharp), à la taille de chaque écran — essentiel sur les connexions mobiles. Seules les images
   * PUBLIÉES (route publique de l'API) sont optimisées ; l'aperçu authentifié reste non optimisé.
   */
  images: {
    localPatterns: [{ pathname: '/api/v1/public/media/**' }],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [480, 640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [96, 160, 256, 384],
    minimumCacheTTL: 86_400,
  },
  /**
   * Le navigateur appelle /api/v1/* sur le domaine du frontend : le cookie de session
   * reste « first-party » (SameSite=Lax) et l'API n'est jamais exposée en cross-site.
   */
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
