import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Liens temporaires de téléchargement des fichiers privés : jeton `<charge>.<signature>` en
 * base64url, signé HMAC-SHA256 avec une clé serveur. Le jeton désigne un fichier (et son
 * organisation), expire vite et ne révèle aucune clé de stockage. Il est vérifié par l'API, qui
 * relit le fichier en base (supprimé = refusé) avant de le servir.
 */
export interface SignedFileClaims {
  /** Identifiant du fichier. */
  f: string;
  /** Organisation propriétaire (contrôle croisé). */
  o: string;
  /** Compte à qui le lien a été délivré (journal des accès). */
  u: string;
  /** Expiration, en secondes epoch. */
  e: number;
}

const b64 = (buf: Buffer) => buf.toString('base64url');

function signature(payload: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

export function signFileToken(claims: SignedFileClaims, key: Buffer): string {
  const payload = b64(Buffer.from(JSON.stringify(claims)));
  return `${payload}.${b64(signature(payload, key))}`;
}

/** Charge du jeton si la signature est valide et non expirée ; sinon null (sans détail). */
export function verifyFileToken(
  token: string,
  key: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignedFileClaims | null {
  if (token.length > 1024) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = signature(payload, key);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as SignedFileClaims;
    if (
      typeof claims.f !== 'string' ||
      typeof claims.o !== 'string' ||
      typeof claims.u !== 'string' ||
      typeof claims.e !== 'number'
    )
      return null;
    return claims.e >= nowSeconds ? claims : null;
  } catch {
    return null;
  }
}
