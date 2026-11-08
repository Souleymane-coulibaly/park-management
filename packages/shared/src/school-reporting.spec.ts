import {
  averageDistribution,
  deltaOf,
  insufficientSample,
  meanOf,
  passRate,
  rateOf,
  trendOf,
} from './school-reporting';

describe('reporting School (Sprint 8)', () => {
  it('répartit les moyennes en tranches du barème, note maximale dans la dernière', () => {
    const { bins, missing } = averageDistribution([0, 3.99, 4, 12.5, 20, null], 20);
    expect(bins.map((b) => b.count)).toEqual([2, 1, 0, 1, 1]);
    expect(bins[0]).toMatchObject({ from: 0, to: 4 });
    expect(bins[4]).toMatchObject({ from: 16, to: 20 });
    expect(missing).toBe(1);
  });

  it('répartition sur un barème de 10', () => {
    expect(averageDistribution([9.5, 10], 10).bins.map((b) => b.count)).toEqual([0, 0, 0, 0, 2]);
  });

  it('taux de réussite en points de base, sans les élèves sans résultat', () => {
    expect(passRate([true, false, null, true])).toBe(6666);
    expect(passRate([null])).toBeNull();
  });

  it('moyenne simple arrondie, null sans valeur', () => {
    expect(meanOf([10, 11, null, 12.335])).toBe(11.11);
    expect(meanOf([null])).toBeNull();
  });

  it('tendance : hausse, baisse, stabilité sous 2,5 % du barème, données insuffisantes', () => {
    const series = (values: (number | null)[]) =>
      values.map((value, i) => ({ key: `T${i + 1}`, value }));
    expect(trendOf(series([10, 11, 12]), 20)).toMatchObject({
      direction: 'UP',
      delta: 2,
      from: 'T1',
      to: 'T3',
    });
    expect(trendOf(series([12, null, 10.5]), 20)).toMatchObject({ direction: 'DOWN', delta: -1.5 });
    expect(trendOf(series([12, 12.4]), 20)).toMatchObject({ direction: 'STABLE' });
    expect(trendOf(series([12, null]), 20)).toMatchObject({
      direction: 'INSUFFICIENT',
      delta: null,
    });
  });

  it('écart, taux et effectif insuffisant', () => {
    expect(deltaOf(10.25, 12)).toBe(1.75);
    expect(deltaOf(null, 12)).toBeNull();
    expect(rateOf(1, 3)).toBe(3333);
    expect(rateOf(1, 0)).toBeNull();
    expect(insufficientSample(2)).toBe(true);
    expect(insufficientSample(3)).toBe(false);
  });
});
