import { randomBytes } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp';

describe('Double authentification (TOTP, RFC 6238)', () => {
  // Vecteur de test officiel RFC 6238 (SHA-1) : secret ASCII « 12345678901234567890 ».
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it('vecteurs officiels RFC 6238 (6 derniers chiffres)', () => {
    expect(totpCode(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(rfcSecret, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('base32 aller-retour', () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it('tolérance d’un pas, rejeu refusé, format strict', () => {
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const code = totpCode(rfcSecret, step);
    expect(verifyTotp(rfcSecret, code, null, now)).toBe(step);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(rfcSecret, code, step, now)).toBeNull(); // déjà utilisé
    expect(verifyTotp(rfcSecret, '12345', null, now)).toBeNull();
  });

  it('secret chiffré AES-256-GCM ; altération détectée ; mauvaise clé refusée', () => {
    const key = randomBytes(32);
    const box = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(box).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(box, key)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, tag, data] = box.split('.');
    const tampered = [iv, tag, `${data!.slice(0, -2)}AA`].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(box, randomBytes(32))).toThrow();
  });

  it('codes de secours : uniques, hachage insensible à la casse et aux tirets', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(hashRecoveryCode(codes[0]!.toLowerCase().replace('-', ''))).toBe(
      hashRecoveryCode(codes[0]!),
    );
  });

  it('URI otpauth pour l’application d’authentification', () => {
    expect(otpauthUri('ABC', 'admin@ocall.ml')).toBe(
      'otpauth://totp/Ocall%20Suite%3Aadmin%40ocall.ml?secret=ABC&issuer=Ocall%20Suite&algorithm=SHA1&digits=6&period=30',
    );
  });
});
