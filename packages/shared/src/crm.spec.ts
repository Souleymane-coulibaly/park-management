import {
  computeEarnedPoints,
  customerDisplayName,
  decideRedemption,
  formatKioskNumber,
  hasPermission,
  isKioskPairingCode,
  isSafeImageUrl,
  maskPhone,
  normalizePhone,
  navigationFor,
} from './index';

describe('CRM', () => {
  it('normalise les numéros de téléphone et refuse les saisies invalides', () => {
    expect(normalizePhone('+223 70 00 00 01')).toBe('+22370000001');
    expect(normalizePhone('70.00.00.01')).toBe('70000001');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('abc123456')).toBeNull();
  });

  it('masque le téléphone et nomme une fiche sans nom ou anonymisée', () => {
    expect(maskPhone('+22370000001')).toBe('••••••••0001');
    expect(customerDisplayName({ firstName: null, lastName: null, phone: '70000001' })).toBe(
      '70000001',
    );
    expect(
      customerDisplayName({
        firstName: 'Awa',
        lastName: null,
        phone: null,
        anonymizedAt: new Date(),
      }),
    ).toBe('Client anonymisé');
  });
});

describe('fidélité', () => {
  it('attribue 1 point par tranche complète du montant payé', () => {
    expect(computeEarnedPoints(4500, 1000)).toBe(4);
    expect(computeEarnedPoints(999, 1000)).toBe(0);
    expect(computeEarnedPoints(0, 1000)).toBe(0);
    expect(computeEarnedPoints(5000, 0)).toBe(0);
  });

  it('utilisation : minimum, solde suffisant, remise jamais supérieure au total', () => {
    const rule = { redeemValue: 10, minRedeemPoints: 100 };
    expect(decideRedemption(150, 200, rule, 4000)).toEqual({
      ok: true,
      points: 150,
      discount: 1500,
    });
    expect(decideRedemption(50, 200, rule, 4000)).toEqual({ ok: false, code: 'BELOW_MINIMUM' });
    expect(decideRedemption(300, 200, rule, 4000)).toEqual({
      ok: false,
      code: 'INSUFFICIENT_POINTS',
    });
    expect(decideRedemption(500, 900, rule, 4000)).toEqual({ ok: false, code: 'EXCEEDS_TOTAL' });
    expect(decideRedemption(1.5, 900, rule, 4000)).toEqual({ ok: false, code: 'INVALID_POINTS' });
  });
});

describe('bornes', () => {
  it('codes d’appairage sans caractère ambigu ; numéro affiché', () => {
    expect(isKioskPairingCode('ABCD2345')).toBe(true);
    expect(isKioskPairingCode('ABCD0OI1')).toBe(false);
    expect(formatKioskNumber(42)).toBe('B-0042');
  });

  it('photos produits en https uniquement', () => {
    expect(isSafeImageUrl('https://cdn.example.com/poulet.jpg')).toBe(true);
    expect(isSafeImageUrl('http://cdn.example.com/poulet.jpg')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('droits du Sprint 6', () => {
  it('caissier : recherche et création de clients, sans historique ni anonymisation', () => {
    expect(hasPermission('CASHIER', 'customer.read')).toBe(true);
    expect(hasPermission('CASHIER', 'customer.manage')).toBe(true);
    expect(hasPermission('CASHIER', 'customer.history')).toBe(false);
    expect(hasPermission('CASHIER', 'customer.erase')).toBe(false);
    expect(hasPermission('CASHIER', 'loyalty.adjust')).toBe(false);
  });

  it('superviseur : planning et historique ; seuls propriétaire et administrateur gèrent bornes et fidélité', () => {
    expect(hasPermission('SUPERVISOR', 'planning.manage')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'customer.history')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'kiosk.manage')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'loyalty.configure')).toBe(false);
    expect(hasPermission('ADMIN', 'kiosk.manage')).toBe(true);
    expect(hasPermission('KITCHEN', 'customer.read')).toBe(false);
  });

  it('bornes : uniquement pour une activité restaurant ; planning visible par tous les employés', () => {
    expect(navigationFor('PARK', 'OWNER').map((m) => m.key)).not.toContain('kiosks');
    expect(navigationFor('RESTAURANT', 'KITCHEN').map((m) => m.key)).toContain('hr-planning');
  });
});
