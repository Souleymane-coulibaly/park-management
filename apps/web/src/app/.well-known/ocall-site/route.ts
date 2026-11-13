import { NextResponse, type NextRequest } from 'next/server';
import { factureSiteIdForHost } from '@/lib/public-facture-site';
import { stockSiteIdForHost } from '@/lib/public-stock-site';
import { requestHost, resolveSiteHost } from '@/lib/public-site';

/**
 * Page de contrôle d'un domaine : lue par l'API en HTTPS lors de l'activation d'un domaine
 * personnalisé. Elle répond l'identifiant du site servi par cet hôte, et rien d'autre.
 */
export async function GET(request: NextRequest) {
  const host = requestHost(request.headers);
  const site = host ? await resolveSiteHost(host) : null;
  // Sites Park d'abord (inchangés), puis vitrines Ocall Facture, puis vitrines Ocall Stock.
  const siteId =
    site?.siteId ??
    (host ? ((await factureSiteIdForHost(host)) ?? (await stockSiteIdForHost(host))) : null);
  if (!siteId) return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ siteId }, { headers: { 'cache-control': 'no-store' } });
}
