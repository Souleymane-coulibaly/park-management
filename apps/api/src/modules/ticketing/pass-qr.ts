import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  PASS_CARD_QR_PREFIX,
  PASS_DYNAMIC_QR_PREFIX,
  PASS_QR_TOLERANCE_WINDOWS,
  PASS_QR_WINDOW_SECONDS,
  PASS_STATIC_QR_PREFIX,
  passQrWindow,
} from '@ocall/shared';

/**
 * Ocall Parc sprint 8 : signature des QR de pass et de carte. Clé HMAC-SHA256 dérivée de la clé de
 * signature du serveur (séparation de domaine) : jamais stockée en base, jamais envoyée au navigateur.
 * Aucun QR n'est stocké : il se recalcule à partir de l'identifiant public et de la version du pass, ce
 * qui permet de le révoquer (nouvelle version) sans rien supprimer.
 */
export class PassQrSigner {
  private readonly key: Buffer;

  constructor(serverKey: Buffer) {
    this.key = createHmac('sha256', serverKey).update('ocall-pass-qr-v1').digest();
  }

  private sign(message: string): string {
    return createHmac('sha256', this.key)
      .update(message)
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  }

  private same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  /** QR fixe d'un pass journalier ou hebdomadaire. */
  staticQr(publicId: string, version: number): string {
    return `${PASS_STATIC_QR_PREFIX}${publicId}.${this.sign(`static:${publicId}:${version}`)}`;
  }

  verifyStatic(publicId: string, version: number, signature: string): boolean {
    return this.same(this.sign(`static:${publicId}:${version}`), signature);
  }

  /** QR dynamique d'un abonnement : valable pour une fenêtre de 30 s. */
  dynamicQr(publicId: string, version: number, now = Date.now()) {
    const window = passQrWindow(now);
    return {
      qr: `${PASS_DYNAMIC_QR_PREFIX}${publicId}.${window}.${this.sign(`dynamic:${publicId}:${version}:${window}`)}`,
      window,
      expiresAt: new Date((window + 1) * PASS_QR_WINDOW_SECONDS * 1000).toISOString(),
      refreshInSeconds: PASS_QR_WINDOW_SECONDS - Math.floor((now / 1000) % PASS_QR_WINDOW_SECONDS),
    };
  }

  /**
   * Vérifie un QR dynamique : signature d'abord (une falsification est inconnue, sans détail), puis la
   * fenêtre (actuelle, ou précédente / suivante pour un écart d'horloge) ; au-delà, « périmé ».
   */
  verifyDynamic(
    publicId: string,
    version: number,
    window: number,
    signature: string,
    now = Date.now(),
  ): 'valid' | 'expired' | 'invalid' {
    if (!this.same(this.sign(`dynamic:${publicId}:${version}:${window}`), signature))
      return 'invalid';
    return Math.abs(passQrWindow(now) - window) <= PASS_QR_TOLERANCE_WINDOWS ? 'valid' : 'expired';
  }

  /** QR fixe d'une carte physique (production par Ocall Print). */
  cardQr(cardNumber: string): string {
    return `${PASS_CARD_QR_PREFIX}${cardNumber}.${this.sign(`card:${cardNumber}`)}`;
  }

  verifyCard(cardNumber: string, signature: string): boolean {
    return this.same(this.sign(`card:${cardNumber}`), signature);
  }
}

/** Identifiant public (QR, carte) : 16 caractères aléatoires, sans aucune donnée personnelle. */
export const newPublicId = (): string => randomBytes(12).toString('base64url');

/** Jeton du lien personnel du titulaire (montré une seule fois ; seule son empreinte est gardée). */
export const newLinkToken = (): string => randomBytes(24).toString('base64url');
