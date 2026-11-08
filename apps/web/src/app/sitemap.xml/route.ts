import type { NextRequest } from 'next/server';
import { fetchSitemap, isAppHost, requestHost } from '@/lib/public-site';
import { fetchSchoolSitemap } from '@/lib/public-school-site';
import { isSchoolSiteHost } from '@/lib/site-hosts';

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
  // Hôte d'un site School : ses seules pages. Hôte de l'application : sites Park et sites School
  // servis à l'adresse provisoire /s/<slug> (sous-domaines School non activés).
  // Périmètre School (hôte de site School, ou application qui sert l'adresse provisoire) : réponse
  // jamais mise en cache, même vide (une publication y apparaît aussitôt).
  const schoolScope = isSchoolSiteHost(host) || isAppHost(host);
  // Contribution School isolée : son indisponibilité n'empêche pas de servir les entrées Park et
  // commerciales. Sur l'hôte d'un site School, elle est tout le plan : réponse 503, jamais un plan vide.
  const school = schoolScope ? await fetchSchoolSitemap(host) : [];
  if (school === null && isSchoolSiteHost(host)) {
    return new Response('Plan du site momentanément indisponible.', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '60' },
    });
  }
  const schoolEntries = school ?? [];
  const entries = isSchoolSiteHost(host)
    ? schoolEntries
    : [...(await fetchSitemap(host)), ...schoolEntries];
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
      // Périmètre School : jamais mis en cache ; plans des hôtes de sites Park inchangés.
      'cache-control': schoolScope ? 'no-store' : 'public, max-age=600',
    },
  });
}
