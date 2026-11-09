import { isInternationalSms, smsCost, smsSegments, smsTopUpQuote } from './school-sms-billing';

describe('Facturation des SMS School (Sprint S2)', () => {
  it('GSM-7 : 160 caractères = 1 segment, au-delà 153 par segment', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM7', units: 160, segments: 1 });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('a'.repeat(306)).segments).toBe(2);
    expect(smsSegments('a'.repeat(307)).segments).toBe(3);
  });

  it('caractères de l’extension GSM comptés pour deux', () => {
    const s = smsSegments('€'.repeat(80));
    expect(s).toEqual({ encoding: 'GSM7', units: 160, segments: 1 });
    expect(smsSegments('€'.repeat(81)).segments).toBe(2);
  });

  it('français accentué courant reste en GSM-7 (é, è, à) ; ê ou ç minuscule imposent l’UCS-2', () => {
    expect(smsSegments('Élève absent ce matin à 8h, merci de prévenir l’école').encoding).toBe(
      'UCS2', // l’apostrophe typographique n’appartient pas à l’alphabet GSM-7
    );
    expect(smsSegments('Eleve absent ce matin a 8h, éè à').encoding).toBe('GSM7');
    expect(smsSegments('fête').encoding).toBe('UCS2');
  });

  it('UCS-2 (arabe) : 70 unités = 1 segment, au-delà 67 par segment', () => {
    expect(smsSegments('ب'.repeat(70))).toEqual({ encoding: 'UCS2', units: 70, segments: 1 });
    expect(smsSegments('ب'.repeat(71)).segments).toBe(2);
    expect(smsSegments('ب'.repeat(134)).segments).toBe(2);
    expect(smsSegments('ب'.repeat(135)).segments).toBe(3);
  });

  it('destination : numéro local ou indicatif du pays = national ; autre indicatif = international', () => {
    expect(isInternationalSms('70 00 00 01', 'ML')).toBe(false);
    expect(isInternationalSms('+223 70 00 00 01', 'ML')).toBe(false);
    expect(isInternationalSms('00223 70000001', 'ML')).toBe(false);
    expect(isInternationalSms('+225 07 00 00 00', 'ML')).toBe(true);
    expect(isInternationalSms('+33 6 00 00 00 00', 'CI')).toBe(true);
    // Pays sans indicatif connu : jamais sous-facturé.
    expect(isInternationalSms('+999 1234567', 'ZZ')).toBe(true);
    expect(isInternationalSms('1234567', 'ZZ')).toBe(false);
  });

  it('coût : segments × 1 en national ; × tarif à l’international ; refusé sans tarif', () => {
    const long = 'a'.repeat(200);
    expect(smsCost(long, '70000001', 'ML', null)).toEqual({
      encoding: 'GSM7',
      segments: 2,
      international: false,
      credits: 2,
    });
    expect(smsCost(long, '+33600000000', 'ML', { internationalCreditsPerSegment: 5 }).credits).toBe(
      10,
    );
    expect(
      smsCost(long, '+33600000000', 'ML', { internationalCreditsPerSegment: null }).credits,
    ).toBe(null);
    expect(smsCost(long, '+33600000000', 'ML', null).credits).toBe(null);
  });

  it('montant indicatif d’une recharge : nul tant qu’aucun prix n’est publié', () => {
    expect(smsTopUpQuote(500, null)).toBeNull();
    expect(smsTopUpQuote(500, 25)).toBe(12_500);
  });
});
