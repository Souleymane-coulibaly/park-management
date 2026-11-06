import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { siteTag } from '@/lib/public-site';
import { schoolSiteTag } from '@/lib/public-school-site';

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
  const body = (await request.json().catch(() => null)) as {
    slugs?: unknown;
    schoolSlugs?: unknown;
  } | null;
  const valid = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s))
      : [];
  const slugs = valid(body?.slugs);
  // Sites School : étiquettes distinctes de celles des sites Park (un même slug ne se confond pas).
  const schoolSlugs = valid(body?.schoolSlugs);
  for (const slug of slugs.slice(0, 10)) revalidateTag(siteTag(slug));
  for (const slug of schoolSlugs.slice(0, 10)) revalidateTag(schoolSiteTag(slug));
  return NextResponse.json({ revalidated: slugs.length + schoolSlugs.length });
}
