import {
  stockIsSlowMoving,
  stockMarginRate,
  stockMargins,
  stockReportPeriod,
  stockUnitCost,
  stockValue,
  stockWeightedCost,
} from './stock-reports';

const DAY = 86_400_000;

describe('Ocall Stock — rapports', () => {
  it('coût moyen pondéré des réceptions, arrondi ; null sans réception', () => {
    expect(stockWeightedCost([])).toBeNull();
    expect(
      stockWeightedCost([
        { quantity: 10, unitCost: 4000 },
        { quantity: 5, unitCost: 5000 },
      ]),
    ).toBe(4333);
    expect(stockWeightedCost([{ quantity: 0.5, unitCost: 1001 }])).toBe(1001);
    expect(stockWeightedCost([{ quantity: 0, unitCost: 9 }])).toBeNull();
  });

  it('coût retenu : CMUP, sinon prix de la fiche (signalé), sinon aucun', () => {
    expect(stockUnitCost(4333, 4000)).toEqual({ cost: 4333, source: 'RECEIPTS' });
    expect(stockUnitCost(null, 4000)).toEqual({ cost: 4000, source: 'PRODUCT' });
    expect(stockUnitCost(null, null)).toEqual({ cost: null, source: 'NONE' });
  });

  it('marges estimée et brute, lignes sans coût exclues et comptées', () => {
    const m = stockMargins([
      { quantity: 2, revenueHt: 10_000, purchasePrice: 3000, unitCost: 3500 },
      { quantity: 1, revenueHt: 2000, purchasePrice: null, unitCost: 1000 },
      { quantity: 1.5, revenueHt: 3000, purchasePrice: 1000, unitCost: null },
    ]);
    expect(m).toEqual({
      revenueHt: 15_000,
      estimated: 10_000 - 6000 + 3000 - 1500,
      estimatedExcluded: 1,
      gross: 10_000 - 7000 + 2000 - 1000,
      grossExcluded: 1,
    });
    expect(
      stockMargins([{ quantity: 1, revenueHt: 5, purchasePrice: null, unitCost: null }]),
    ).toMatchObject({ estimated: null, gross: null });
    expect(stockMarginRate(4000, 10_000)).toBe(40);
    expect(stockMarginRate(1, 3)).toBe(33.3);
    expect(stockMarginRate(null, 10)).toBeNull();
    expect(stockMarginRate(5, 0)).toBeNull();
  });

  it('valeur du stock au coût, quantités décimales', () => {
    expect(stockValue(2.5, 4000)).toBe(10_000);
    expect(stockValue(3, null)).toBeNull();
  });

  it('faible rotation : en stock et aucune sortie depuis N jours (création à défaut)', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const old = new Date(now.getTime() - 100 * DAY);
    const recent = new Date(now.getTime() - 10 * DAY);
    expect(stockIsSlowMoving(5, old, old, now, 90)).toBe(true);
    expect(stockIsSlowMoving(5, recent, old, now, 90)).toBe(false);
    expect(stockIsSlowMoving(5, null, old, now, 90)).toBe(true);
    expect(stockIsSlowMoving(5, null, recent, now, 90)).toBe(false);
    expect(stockIsSlowMoving(0, old, old, now, 90)).toBe(false);
  });

  it('période : 30 derniers jours par défaut, bornes vérifiées, un an au plus', () => {
    const now = new Date('2026-11-13T15:00:00Z');
    const p = stockReportPeriod(undefined, undefined, now);
    expect(p.error).toBeNull();
    expect(p.to.toISOString()).toBe('2026-11-13T00:00:00.000Z');
    expect(p.from.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(stockReportPeriod('2026-11-14', '2026-11-13', now).error).toMatch('début');
    expect(stockReportPeriod('2025-01-01', '2026-11-13', now).error).toMatch('un an');
    expect(stockReportPeriod('2025-11-13', '2026-11-13', now).error).toBeNull();
    expect(stockReportPeriod('x', undefined, now).error).toBe('Dates invalides.');
  });
});
