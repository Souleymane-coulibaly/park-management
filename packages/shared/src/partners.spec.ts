import {
  PROPOSED_COMMISSION_PRESETS,
  addMonthsUtc,
  commissionPayableFrom,
  isCommissionPayable,
  partnerCan,
  allocatePayment,
  computeCommissions,
  formatPayoutNumber,
  formatRateBps,
  isPartnerCode,
  normalizeCompanyName,
  normalizeEmail,
  phoneMatchKey,
} from './index';

describe('Sprint 12B — partenaires : doublons, répartition, commissions', () => {
  it('clés de comparaison des prospects', () => {
    expect(phoneMatchKey('+223 70 11 22 33')).toBe('70112233');
    expect(phoneMatchKey('0022370112233')).toBe('70112233');
    expect(phoneMatchKey('70.11.22.33')).toBe('70112233');
    expect(normalizeCompanyName('SARL Maquis « Le Fleuve »')).toBe('maquis le fleuve');
    expect(normalizeCompanyName('Établissements Côté Sud')).toBe('cote sud');
    expect(normalizeEmail('  Awa@Exemple.ML ')).toBe('awa@exemple.ml');
    expect(normalizeEmail(undefined)).toBeNull();
    expect(isPartnerCode('AB12CD')).toBe(true);
    expect(isPartnerCode('ab12')).toBe(false);
    expect(formatPayoutNumber(2026, 3)).toBe('VER-2026-00003');
    expect(formatRateBps(1500)).toBe('15 %');
  });

  it('répartition au prorata des lignes, somme exacte', () => {
    const lines = [
      { kind: 'SETUP' as const, amount: 250_000 },
      { kind: 'MONTHLY' as const, amount: 15_000 },
    ];
    expect(allocatePayment(lines, 265_000, 265_000)).toEqual({
      setup: 250_000,
      monthly: 15_000,
      adjustments: 0,
    });
    const partial = allocatePayment(lines, 265_000, 100_000);
    expect(partial.setup + partial.monthly).toBe(100_000);
    expect(partial.setup).toBe(94_340);
    expect(allocatePayment([], 0, 1000)).toEqual({ setup: 0, monthly: 0, adjustments: 0 });
  });

  it('commissions : taux de la règle, fenêtre des mensualités, arrondi inférieur', () => {
    const rule = { setupRateBps: 1500, monthlyRateBps: 1000, monthlyWindowMonths: 12 };
    const start = new Date('2026-01-15T00:00:00Z');
    expect(
      computeCommissions({
        allocation: { setup: 250_000, monthly: 15_000 },
        rule,
        windowStart: start,
        paidAt: start,
      }),
    ).toEqual([
      { kind: 'SETUP', baseAmount: 250_000, rateBps: 1500, amount: 37_500 },
      { kind: 'MONTHLY', baseAmount: 15_000, rateBps: 1000, amount: 1_500 },
    ]);
    // Dernier jour de la fenêtre inclus, lendemain exclu.
    const inside = new Date('2027-01-14T23:59:00Z');
    const outside = new Date('2027-01-15T00:00:00Z');
    const monthly = (paidAt: Date) =>
      computeCommissions({
        allocation: { setup: 0, monthly: 15_000 },
        rule,
        windowStart: start,
        paidAt,
      });
    expect(monthly(inside)).toHaveLength(1);
    expect(monthly(outside)).toHaveLength(0);
    expect(
      computeCommissions({
        allocation: { setup: 9, monthly: 0 },
        rule,
        windowStart: start,
        paidAt: start,
      }),
    ).toEqual([{ kind: 'SETUP', baseAmount: 9, rateBps: 1500, amount: 1 }]);
    expect(
      computeCommissions({
        allocation: { setup: 1000, monthly: 1000 },
        rule: { setupRateBps: 0, monthlyRateBps: 0, monthlyWindowMonths: 12 },
        windowStart: start,
        paidAt: start,
      }),
    ).toEqual([]);
  });

  it('ajout de mois borné à la fin du mois', () => {
    expect(addMonthsUtc(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
  });
});

describe('Ocall Partner (Sprint S3)', () => {
  it('règlement à la fin du mois suivant l’encaissement (novembre → fin décembre)', () => {
    expect(commissionPayableFrom(new Date('2026-11-03T08:00:00Z')).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
    expect(commissionPayableFrom(new Date('2026-11-30T23:59:59Z')).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
    // Décembre → fin janvier ; janvier → fin février (année bissextile ou non).
    expect(commissionPayableFrom(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe(
      '2027-01-31T00:00:00.000Z',
    );
    expect(commissionPayableFrom(new Date('2027-01-10T00:00:00Z')).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
    expect(commissionPayableFrom(new Date('2028-01-10T00:00:00Z')).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    const due = commissionPayableFrom(new Date('2026-11-03T00:00:00Z'));
    expect(isCommissionPayable(due, new Date('2026-12-30T23:59:59Z'))).toBe(false);
    expect(isCommissionPayable(due, new Date('2026-12-31T00:00:00Z'))).toBe(true);
    expect(isCommissionPayable(null)).toBe(false);
  });

  it('mensualités jusqu’à la fin du contrat (durée vide) ; durée bornée respectée sinon', () => {
    const allocation = { setup: 0, monthly: 50_000 };
    const start = new Date('2020-01-01T00:00:00Z');
    const paidAt = new Date('2026-11-01T00:00:00Z');
    expect(
      computeCommissions({
        allocation,
        rule: { setupRateBps: 0, monthlyRateBps: 1000, monthlyWindowMonths: null },
        windowStart: start,
        paidAt,
      }),
    ).toEqual([{ kind: 'MONTHLY', baseAmount: 50_000, rateBps: 1000, amount: 5_000 }]);
    expect(
      computeCommissions({
        allocation,
        rule: { setupRateBps: 0, monthlyRateBps: 1000, monthlyWindowMonths: 12 },
        windowStart: start,
        paidAt,
      }),
    ).toEqual([]);
  });

  it('arrondi XOF à l’inférieur, jamais de fraction de franc', () => {
    const [c] = computeCommissions({
      allocation: { setup: 0, monthly: 33_333 },
      rule: { setupRateBps: 0, monthlyRateBps: 750, monthlyWindowMonths: null },
      windowStart: new Date(),
      paidAt: new Date(),
    });
    expect(c!.amount).toBe(2_499);
    expect(Number.isInteger(c!.amount)).toBe(true);
  });

  it('capacités : seul le revendeur prépare des demandes et voit les contrats', () => {
    expect(partnerCan('RESELLER', 'subscription.requests')).toBe(true);
    expect(partnerCan('RESELLER', 'contracts.read')).toBe(true);
    expect(partnerCan('REFERRER', 'subscription.requests')).toBe(false);
    expect(partnerCan('REFERRER', 'contracts.read')).toBe(false);
  });

  it('barèmes proposés : jamais validés par défaut, mensualités jusqu’à la fin du contrat', () => {
    expect(PROPOSED_COMMISSION_PRESETS.REFERRER).toMatchObject({
      setupRateBps: 1000,
      monthlyRateBps: 500,
      monthlyWindowMonths: null,
    });
    expect(PROPOSED_COMMISSION_PRESETS.RESELLER).toMatchObject({
      setupRateBps: 1500,
      monthlyRateBps: 1000,
      monthlyWindowMonths: null,
    });
  });
});
