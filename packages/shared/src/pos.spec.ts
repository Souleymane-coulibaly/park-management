import {
  MAX_AMOUNT,
  computeCashVariance,
  computeChange,
  computeExpectedCash,
  computeSaleTotals,
  formatSaleNumber,
  hasPermission,
  navigationFor,
} from './index';

describe('computeSaleTotals', () => {
  it('calcule les totaux de ligne et le total', () => {
    expect(
      computeSaleTotals([
        { unitPrice: 1500, quantity: 2 },
        { unitPrice: 500, quantity: 3 },
      ]),
    ).toEqual({ lineTotals: [3000, 1500], total: 4500 });
  });

  it.each([
    [[], 'vente vide'],
    [[{ unitPrice: 1000, quantity: 0 }], 'quantité nulle'],
    [[{ unitPrice: 1000, quantity: 1.5 }], 'quantité décimale'],
    [[{ unitPrice: 1000, quantity: 1000 }], 'quantité trop grande'],
    [[{ unitPrice: -1, quantity: 1 }], 'prix négatif'],
    [[{ unitPrice: 10.5, quantity: 1 }], 'prix décimal'],
    [[{ unitPrice: MAX_AMOUNT, quantity: 2 }], 'total au-delà du plafond'],
  ])('refuse : %s (%s)', (lines) => {
    expect(() => computeSaleTotals(lines)).toThrow(RangeError);
  });
});

describe('computeChange', () => {
  it('rend la monnaie', () => {
    expect(computeChange(4500, 5000)).toBe(500);
    expect(computeChange(4500, 4500)).toBe(0);
  });

  it('signale un montant insuffisant', () => {
    expect(computeChange(4500, 4000)).toBeNull();
  });
});

describe('session de caisse', () => {
  it('espèces attendues = fond de caisse + encaissements', () => {
    expect(computeExpectedCash(10_000, [4500, 2000])).toBe(16_500);
    expect(computeExpectedCash(0, [])).toBe(0);
  });

  it('écart négatif en cas de manque, positif en cas d’excédent', () => {
    expect(computeCashVariance(16_500, 16_000)).toBe(-500);
    expect(computeCashVariance(16_500, 16_500)).toBe(0);
    expect(computeCashVariance(16_500, 17_000)).toBe(500);
  });
});

describe('POS et permissions', () => {
  it('formate le numéro de vente', () => {
    expect(formatSaleNumber(42)).toBe('000042');
  });

  it('caissier : encaisse mais ne voit pas toutes les ventes ni ne gère le catalogue', () => {
    expect(hasPermission('CASHIER', 'pos.sell')).toBe(true);
    expect(hasPermission('CASHIER', 'sale.read_all')).toBe(false);
    expect(hasPermission('CASHIER', 'catalog.manage')).toBe(false);
    expect(hasPermission('CASHIER', 'sale.cancel')).toBe(false);
  });

  it('cuisine : consulte le catalogue sans encaisser', () => {
    expect(hasPermission('KITCHEN', 'catalog.read')).toBe(true);
    expect(hasPermission('KITCHEN', 'pos.sell')).toBe(false);
  });

  it('la caisse et le catalogue sont disponibles pour un restaurant, absents pour un parc', () => {
    const restaurant = navigationFor('RESTAURANT', 'CASHIER');
    expect(restaurant.find((m) => m.key === 'pos')).toMatchObject({
      status: 'available',
      href: '/app/caisse',
    });
    expect(navigationFor('PARK', 'OWNER').some((m) => m.key === 'pos')).toBe(false);
  });
});
