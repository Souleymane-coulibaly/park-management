import { randomInt } from 'node:crypto';
import type { Prisma } from '@ocall/database';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/**
 * Code commercial unique d'un partenaire (liens de recommandation), aléatoire, sans caractère ambigu.
 * L'unicité est garantie par la base ; quelques tirages évitent une collision.
 */
export async function uniquePartnerCode(tx: Prisma.TransactionClient): Promise<string> {
  let code = randomCode();
  for (let i = 0; i < 5 && (await tx.partner.count({ where: { code } })) > 0; i++) {
    code = randomCode();
  }
  return code;
}
