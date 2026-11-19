import { PrintQrSigner, newCardNumber } from './print-qr';

describe('QR des cartes Ocall Print', () => {
  const signer = new PrintQrSigner(Buffer.from('cle-de-test-ocall-print-0123456789'));

  it('numéros opaques, lisibles, sans caractère ambigu', () => {
    const numbers = new Set(Array.from({ length: 500 }, newCardNumber));
    expect(numbers.size).toBe(500);
    for (const n of numbers)
      expect(n).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){2}$/);
  });

  it('vérifie un QR authentique et refuse toute altération', () => {
    const number = newCardNumber();
    const qr = signer.qr(number);
    expect(qr.startsWith('OCP1.')).toBe(true);
    expect(signer.verify(qr)).toBe(number);
    const other = newCardNumber();
    const signature = qr.split('.')[2]!;
    expect(signer.verify(`OCP1.${other}.${signature}`)).toBeNull();
    expect(signer.verify(`${qr}x`)).toBeNull();
    expect(signer.verify(`${qr}.extra`)).toBeNull();
    expect(signer.verify(qr.replace('OCP1.', 'OCP2.'))).toBeNull();
    expect(signer.verify('')).toBeNull();
  });

  it('une autre clé serveur ne reconnaît pas le QR (séparation de domaine)', () => {
    const number = newCardNumber();
    const other = new PrintQrSigner(Buffer.from('autre-cle-serveur-0123456789abcdef'));
    expect(other.verify(signer.qr(number))).toBeNull();
  });
});
