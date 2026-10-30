import type { NextRequest } from 'next/server';
import { isAppHost, requestHost } from '@/lib/public-site';

/** robots.txt selon l'hôte : espaces privés et API jamais indexés ; plan du site de l'hôte. */
export function GET(request: NextRequest) {
  const host = requestHost(request.headers);
  const origin = `${request.nextUrl.protocol}//${host}`;
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /.well-known/'];
  if (isAppHost(host)) {
    lines.push(
      'Disallow: /app',
      'Disallow: /admin',
      'Disallow: /connexion',
      'Disallow: /kiosk',
      'Disallow: /commande',
    );
  }
  lines.push('', `Sitemap: ${origin}/sitemap.xml`, '');
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
