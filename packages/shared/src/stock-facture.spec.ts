import {
  STOCK_FACTURE_MAX_ATTEMPTS,
  stockFactureNetExit,
  stockFactureRetryDelayMs,
  stockFactureReturn,
  stockQuantitiesByVariant,
  stockTtcToHt,
} from './stock-facture';

describe('Ocall Stock ↔ Facture', () => {
  it('convertit un prix TTC en prix hors taxe arrondi', () => {
    expect(stockTtcToHt(11_800, 18)).toBe(10_000);
    expect(stockTtcToHt(6000, 18)).toBe(5085);
    expect(stockTtcToHt(2500, 0)).toBe(2500);
  });

  it('additionne les quantités par article en millièmes, sans les lignes libres', () => {
    const m = stockQuantitiesByVariant([
      { variantId: 'a', quantity: 0.1 },
      { variantId: 'a', quantity: 0.2 },
      { variantId: null, quantity: 5 },
      { variantId: 'b', quantity: 2.5 },
    ]);
    expect(m.get('a')).toBe(300);
    expect(m.get('b')).toBe(2500);
    expect(m.size).toBe(2);
  });

  it('ne déstocke que ce que la source n’a pas déjà sorti, jamais en positif', () => {
    const wanted = new Map([
      ['b', 5000],
      ['a', 3000],
      ['c', 1000],
    ]);
    const covered = new Map([
      ['a', 3000],
      ['b', 2000],
      ['c', 4000],
    ]);
    expect(stockFactureNetExit(wanted, covered)).toEqual([{ variantId: 'b', quantity: -3 }]);
    expect(stockFactureNetExit(wanted, new Map())).toEqual([
      { variantId: 'a', quantity: -3 },
      { variantId: 'b', quantity: -5 },
      { variantId: 'c', quantity: -1 },
    ]);
  });

  it('un avoir ne remet jamais plus que ce qui est sorti, avoirs précédents déduits', () => {
    const out = new Map([
      ['a', 5000],
      ['b', 1000],
    ]);
    const returned = new Map([['a', 4000]]);
    expect(
      stockFactureReturn(
        new Map([
          ['a', 3000],
          ['b', 1000],
          ['z', 1000],
        ]),
        out,
        returned,
      ),
    ).toEqual([
      { variantId: 'a', quantity: 1 },
      { variantId: 'b', quantity: 1 },
    ]);
    expect(stockFactureReturn(new Map([['a', 1000]]), out, new Map([['a', 5000]]))).toEqual([]);
  });

  it('espace les nouvelles tentatives, plafonnées à une heure', () => {
    expect(stockFactureRetryDelayMs(1)).toBe(60_000);
    expect(stockFactureRetryDelayMs(3)).toBe(240_000);
    expect(stockFactureRetryDelayMs(30)).toBe(3_600_000);
    expect(STOCK_FACTURE_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
