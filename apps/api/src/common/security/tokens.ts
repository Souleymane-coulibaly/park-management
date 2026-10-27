import { createHash, randomBytes } from 'node:crypto';

/** Jeton opaque de 256 bits, transmis au client une seule fois. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Seul le hash SHA-256 est stocké : une fuite de la base ne livre aucune session valide. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mot de passe temporaire conforme à la politique (16+ caractères, minuscule, majuscule, chiffre). */
export function generateTemporaryPassword(): string {
  return `Op${randomBytes(12).toString('base64url')}7k`;
}
