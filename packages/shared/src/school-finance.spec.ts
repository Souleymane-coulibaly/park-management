import {
  allocateOldestFirst,
  benefitValueError,
  buildInstallments,
  chargeBalance,
  chargeDiscount,
  chargeDue,
  chargeStatus,
  formatAmount,
  guardianChargeView,
  parseAmount,
  paymentReferenceRequired,
  paymentVerification,
  receiptNumber,
  splitAmount,
} from './school-finance';

describe('Ocall School — montants exacts', () => {
  it('saisie convertie en unités mineures selon la devise, sans nombre à virgule', () => {
    expect(parseAmount('150 000', 'XOF')).toBe(150_000);
    expect(parseAmount('12,50', 'EUR')).toBe(1250);
    expect(parseAmount('12.5', 'EUR')).toBe(1250);
    expect(parseAmount('0,1', 'EUR')).toBe(10);
    expect(parseAmount('1,234', 'TND')).toBe(1234);
    // Décimales refusées pour une devise sans décimale, trop de décimales refusées ailleurs.
    expect(parseAmount('12,5', 'XOF')).toBeNull();
    expect(parseAmount('1,005', 'EUR')).toBeNull();
    expect(parseAmount('-5', 'XOF')).toBeNull();
    expect(parseAmount('abc', 'XOF')).toBeNull();
    expect(parseAmount('2000000000', 'XOF')).toBeNull();
  });

  it('affichage dans la devise', () => {
    expect(formatAmount(150_000, 'XOF').replace(/\s/g, ' ')).toBe('150 000 XOF');
    expect(formatAmount(1250, 'EUR').replace(/\s/g, ' ')).toBe('12,50 EUR');
    expect(formatAmount(-5, 'EUR')).toBe('-0,05 EUR');
    expect(formatAmount(1250, 'EUR', 'en-US')).toBe('12.50 EUR');
  });

  it('partage exact : la somme vaut toujours le total', () => {
    expect(splitAmount(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
    expect(splitAmount(10, 4)).toEqual([3, 3, 2, 2]);
    expect(splitAmount(0, 2)).toEqual([0, 0]);
    for (const [total, n] of [
      [999_999, 7],
      [1, 9],
      [123_457, 10],
    ] as const) {
      expect(splitAmount(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(() => splitAmount(10, 0)).toThrow();
    expect(() => splitAmount(1.5, 2)).toThrow();
  });
});

describe('Ocall School — échéanciers', () => {
  it('mensuel : une échéance par mois, jour limite ramené à la fin d’un mois court', () => {
    const rows = buildInstallments(
      { kind: 'MONTHLY', firstMonth: '2026-10', lastMonth: '2027-06', dueDay: 31 },
      90_000,
    );
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({ position: 1, dueOn: '2026-10-31', amount: 10_000 });
    expect(rows[1]!.dueOn).toBe('2026-11-30');
    expect(rows[4]!.dueOn).toBe('2027-02-28');
    expect(rows[8]!.dueOn).toBe('2027-06-30');
  });

  it('trimestriel : une échéance par tranche de trois mois', () => {
    const rows = buildInstallments(
      { kind: 'QUARTERLY', firstMonth: '2026-10', lastMonth: '2027-06', dueDay: 5 },
      100_000,
    );
    expect(rows.map((r) => r.dueOn)).toEqual(['2026-10-05', '2027-01-05', '2027-04-05']);
    expect(rows.map((r) => r.amount)).toEqual([33_334, 33_333, 33_333]);
  });

  it('annuel et personnalisé ; somme personnalisée contrôlée', () => {
    expect(buildInstallments({ kind: 'ANNUAL', dueOn: '2026-10-15' }, 25_000)).toEqual([
      { position: 1, dueOn: '2026-10-15', amount: 25_000 },
    ]);
    const custom = buildInstallments(
      {
        kind: 'CUSTOM',
        installments: [
          { dueOn: '2027-01-10', amount: 40_000 },
          { dueOn: '2026-10-10', amount: 60_000 },
        ],
      },
      100_000,
    );
    expect(custom.map((r) => [r.position, r.dueOn])).toEqual([
      [1, '2026-10-10'],
      [2, '2027-01-10'],
    ]);
    expect(() =>
      buildInstallments({ kind: 'CUSTOM', installments: [{ dueOn: '2026-10-10', amount: 1 }] }, 2),
    ).toThrow(/somme/);
    expect(() =>
      buildInstallments(
        { kind: 'MONTHLY', firstMonth: '2027-06', lastMonth: '2026-10', dueDay: 1 },
        1,
      ),
    ).toThrow();
  });
});

describe('Ocall School — réductions, bourses et exonérations', () => {
  it('taux additionnés et plafonnés, réduction fixe ajoutée, jamais au-delà du montant', () => {
    expect(chargeDiscount(10_000, [])).toBe(0);
    expect(chargeDiscount(10_000, [{ kind: 'PERCENT', value: 1500 }])).toBe(1500);
    expect(
      chargeDiscount(10_000, [
        { kind: 'SCHOLARSHIP', value: 5000 },
        { kind: 'FAMILY', value: 1000 },
      ]),
    ).toBe(6000);
    expect(
      chargeDiscount(10_000, [
        { kind: 'FIXED', value: 2500 },
        { kind: 'PERCENT', value: 1000 },
      ]),
    ).toBe(3500);
    expect(
      chargeDiscount(10_000, [
        { kind: 'PERCENT', value: 8000 },
        { kind: 'PERCENT', value: 8000 },
      ]),
    ).toBe(10_000);
    expect(chargeDiscount(3000, [{ kind: 'FIXED', value: 5000 }])).toBe(3000);
    expect(chargeDiscount(10_000, [{ kind: 'EXEMPTION', value: 0 }])).toBe(10_000);
    // Arrondi à l'unité inférieure : 33,33 % de 100 = 33.
    expect(chargeDiscount(100, [{ kind: 'PERCENT', value: 3333 }])).toBe(33);
    // Produits élevés restés exacts.
    expect(chargeDiscount(999_999_999, [{ kind: 'PERCENT', value: 9999 }])).toBe(999_899_999);
  });

  it('valeur contrôlée selon la nature', () => {
    expect(benefitValueError('EXEMPTION', 0)).toBeNull();
    expect(benefitValueError('PERCENT', 10_000)).toBeNull();
    expect(benefitValueError('PERCENT', 10_001)).toMatch(/100 %/);
    expect(benefitValueError('FIXED', 0)).toMatch(/positif/);
    expect(benefitValueError('FIXED', 1.5)).toMatch(/entier/);
  });
});

describe('Ocall School — soldes et statuts', () => {
  const c = { amount: 10_000, discount: 1000, adjustment: 0, paid: 0, dueOn: '2026-11-05' };

  it('dû, reste et statut selon la date', () => {
    expect(chargeDue(c)).toBe(9000);
    expect(chargeBalance(c)).toBe(9000);
    expect(chargeStatus(c, '2026-11-01')).toBe('UPCOMING');
    expect(chargeStatus(c, '2026-11-05')).toBe('UPCOMING');
    expect(chargeStatus(c, '2026-11-06')).toBe('OVERDUE');
    expect(chargeStatus({ ...c, paid: 4000 }, '2026-11-01')).toBe('PARTIAL');
    expect(chargeStatus({ ...c, paid: 4000 }, '2026-12-01')).toBe('OVERDUE');
    expect(chargeStatus({ ...c, paid: 9000 }, '2026-12-01')).toBe('PAID');
    expect(chargeStatus({ ...c, discount: 10_000 }, '2026-12-01')).toBe('PAID');
    expect(chargeBalance({ ...c, adjustment: -500, paid: 8500 })).toBe(0);
  });

  it('affectation automatique de la plus ancienne à la plus récente, reliquat signalé', () => {
    const charges = [
      { id: 'b', dueOn: '2026-11-05', balance: 5000 },
      { id: 'a', dueOn: '2026-10-05', balance: 3000 },
      { id: 'c', dueOn: '2026-12-05', balance: 5000 },
    ];
    expect(allocateOldestFirst(6000, charges)).toEqual({
      allocations: [
        { chargeId: 'a', amount: 3000 },
        { chargeId: 'b', amount: 3000 },
      ],
      remainder: 0,
    });
    expect(allocateOldestFirst(20_000, charges).remainder).toBe(7000);
  });

  it('moyens de paiement : référence et vérification', () => {
    expect(paymentReferenceRequired('CASH')).toBe(false);
    expect(paymentReferenceRequired('MOBILE_MONEY')).toBe(true);
    // Un mobile money saisi à la main n'est jamais présenté comme vérifié par l'opérateur.
    expect(paymentVerification('MOBILE_MONEY')).toBe('DECLARED_UNVERIFIED');
    expect(paymentVerification('CASH')).toBe('NOT_APPLICABLE');
  });

  it('numéro de reçu et vue famille en lecture seule', () => {
    expect(receiptNumber('REC', 2026, 42)).toBe('REC-2026-000042');
    const view = guardianChargeView(
      { ...c, label: 'Scolarité octobre', labelAr: null, currency: 'XOF', paid: 2000 },
      '2026-12-01',
    );
    expect(view).toEqual({
      label: 'Scolarité octobre',
      labelAr: null,
      dueOn: '2026-11-05',
      currency: 'XOF',
      amount: 10_000,
      discount: 1000,
      due: 9000,
      paid: 2000,
      balance: 7000,
      status: 'OVERDUE',
    });
  });
});
