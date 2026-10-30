import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { siteTag } from '@/lib/public-site';

/**
 * Régénération des pages publiques après publication, appelée par l'API avec un secret partagé
 * (SITES_REVALIDATE_SECRET). Sans secret configuré, la route est fermée.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SITES_REVALIDATE_SECRET;
  const given = request.headers.get('x-revalidate-secret') ?? '';
  if (
    !secret ||
    given.length !== secret.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  ) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { slugs?: unknown } | null;
  const slugs = Array.isArray(body?.slugs)
    ? body.slugs.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s))
    : [];
  for (const slug of slugs.slice(0, 10)) revalidateTag(siteTag(slug));
  return NextResponse.json({ revalidated: slugs.length });
}
