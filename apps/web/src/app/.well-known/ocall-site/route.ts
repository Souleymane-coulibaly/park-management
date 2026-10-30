import { NextResponse, type NextRequest } from 'next/server';
import { requestHost, resolveSiteHost } from '@/lib/public-site';

/**
 * Page de contrôle d'un domaine : lue par l'API en HTTPS lors de l'activation d'un domaine
 * personnalisé. Elle répond l'identifiant du site servi par cet hôte, et rien d'autre.
 */
export async function GET(request: NextRequest) {
  const host = requestHost(request.headers);
  const site = host ? await resolveSiteHost(host) : null;
  if (!site) return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ siteId: site.siteId }, { headers: { 'cache-control': 'no-store' } });
}
