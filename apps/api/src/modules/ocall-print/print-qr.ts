import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PRINT_CARD_QR_PREFIX } from '@ocall/shared';

/**
 * QR des cartes Ocall Print : `OCP1.<numéro de carte>.<signature>`. Le numéro est opaque (aucune donnée
 * personnelle) ; la signature HMAC-SHA256 tronquée à 128 bits est calculée avec une clé dérivée de la clé
 * de signature du serveur (séparation de domaine, distincte des QR de pass Parc) : jamais stockée en
 * base, jamais envoyée au navigateur. Un QR lu ne révèle rien : seul un utilisateur autorisé de
 * l'organisation de la carte obtient, par l'API, l'état de la carte et son titulaire.
 */
export class PrintQrSigner {
  private readonly key: Buffer;

  constructor(serverKey: Buffer) {
    this.key = createHmac('sha256', serverKey).update('ocall-print-card-qr-v1').digest();
  }

  private sign(cardNumber: string): string {
    return createHmac('sha256', this.key)
      .update(`card:${cardNumber}`)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  }

  qr(cardNumber: string): string {
    return `${PRINT_CARD_QR_PREFIX}${cardNumber}.${this.sign(cardNumber)}`;
  }

  /** Numéro de carte d'un QR authentique ; null pour un QR falsifié, tronqué ou d'un autre format. */
  verify(qr: string): string | null {
    const value = qr.trim();
    if (!value.startsWith(PRINT_CARD_QR_PREFIX) || value.length > 120) return null;
    const [cardNumber, signature, extra] = value.slice(PRINT_CARD_QR_PREFIX.length).split('.');
    if (!cardNumber || !signature || extra !== undefined || !CARD_NUMBER.test(cardNumber))
      return null;
    const expected = Buffer.from(this.sign(cardNumber));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given) ? cardNumber : null;
  }
}

/** Alphabet sans caractères ambigus (ni I, L, O, U ; ni 0 ni 1) : un numéro se relit et se dicte. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CARD_NUMBER = /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/;

/** Numéro de carte aléatoire : 3 groupes de 4 caractères (~59 bits), sans aucune donnée personnelle. */
export function newCardNumber(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]!);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}
