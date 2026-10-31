import type { NextRequest } from 'next/server';
import { fetchSitemap, isAppHost, requestHost } from '@/lib/public-site';

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Plan du site selon l'hôte : sur l'application, pages commerciales et sites dont l'adresse
 * canonique est sur cet hôte ; sur un sous-domaine ou un domaine personnalisé, ce seul site.
 * Brouillons, sites dépubliés et suspendus n'y figurent jamais.
 */
export async function GET(request: NextRequest) {
  const host = requestHost(request.headers);
  const origin = `${request.nextUrl.protocol}//${host}`;
  const entries = await fetchSitemap(host);
  const marketing = isAppHost(host)
    ? [
        '/',
        '/solutions',
        '/solutions/ocall-park',
        '/solutions/ocall-restaurant',
        '/solutions/ocall-school',
        '/tarifs',
        '/demo',
        '/a-propos',
        '/contact',
      ].map((p) => ({
        url: `${origin}${p}`,
        lastModified: null as string | null,
      }))
    : [];
  const urls = [...marketing, ...entries]
    .map(
      (u) =>
        `  <url><loc>${escapeXml(u.url)}</loc>${u.lastModified ? `<lastmod>${u.lastModified}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
