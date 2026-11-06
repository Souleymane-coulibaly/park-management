import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

export const INTERNAL_SECRET_HEADER = 'x-ocall-internal';
export const VISITOR_IP_HEADER = 'x-ocall-visitor-ip';

/** Adresse IPv4 ou IPv6 plausible (aucun autre contenu accepté comme identité de visiteur). */
const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:.]{2,45})$/i;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Identité retenue par la limitation de débit. Par défaut l'IP de la requête (voir TRUST_PROXY_HOPS).
 * Lectures faites PAR le serveur web pour un visiteur (pages publiques des sites School, lues sans
 * cache) : l'IP du visiteur transmise par le web, seulement si la requête porte le secret partagé
 * web/API (SITES_REVALIDATE_SECRET) — sinon tous les visiteurs partageraient la limite de l'IP du
 * serveur web. Sans secret valide : comportement inchangé.
 */
export function throttleTracker(
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  secret: string | undefined,
): string {
  const header = (name: string) => {
    const v = req.headers?.[name];
    return typeof v === 'string' ? v.trim() : '';
  };
  const given = header(INTERNAL_SECRET_HEADER);
  const visitor = header(VISITOR_IP_HEADER).toLowerCase();
  if (secret && given && sameSecret(given, secret) && IP.test(visitor)) {
    return `visiteur:${visitor}`;
  }
  return req.ip ?? '';
}

@Injectable()
export class VisitorAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return throttleTracker(
      req as Parameters<typeof throttleTracker>[0],
      process.env.SITES_REVALIDATE_SECRET?.trim() || undefined,
    );
  }
}
