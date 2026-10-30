import {
  type ResolvedAnalyticsPeriod,
  averageBasket,
  hasPermission,
  marginRate,
  navigationFor,
  percentChange,
  resolveAnalyticsPeriod,
  unitMaterialCost,
  weekdayOccurrences,
} from './index';

const resolved = (r: ReturnType<typeof resolveAnalyticsPeriod>) => {
  if ('error' in r) throw new Error(r.error);
  return r as ResolvedAnalyticsPeriod;
};

describe('Analyses — périodes (fuseau de l’organisation)', () => {
  // 30/10/2026 14:25 à Bamako (UTC+0) ; 31/10/2026 00:25 à Nouméa (UTC+11).
  const now = new Date('2026-10-30T14:25:00Z');

  it("aujourd'hui est comparé à hier jusqu'à la même heure", () => {
    const p = resolved(resolveAnalyticsPeriod({ period: 'today' }, now, 'Africa/Bamako'));
    expect(p.current).toMatchObject({ from: '2026-10-30T00:00', to: '2026-10-31T00:00' });
    expect(p.previous).toMatchObject({ from: '2026-10-29T00:00', to: '2026-10-29T14:25' });
    expect(p.days).toEqual(['2026-10-30']);
  });

  it('le jour local dépend du fuseau', () => {
    const p = resolved(resolveAnalyticsPeriod({ period: 'today' }, now, 'Pacific/Noumea'));
    expect(p.current.from).toBe('2026-10-31T00:00');
  });

  it('7 et 30 derniers jours : période précédente de même durée, sans chevauchement', () => {
    const w = resolved(resolveAnalyticsPeriod({ period: 'last_7_days' }, now, 'Africa/Bamako'));
    expect(w.current).toMatchObject({ from: '2026-10-24T00:00', to: '2026-10-31T00:00' });
    expect(w.previous).toMatchObject({ from: '2026-10-17T00:00', to: '2026-10-24T00:00' });
    expect(w.days).toHaveLength(7);
    const m = resolved(resolveAnalyticsPeriod({ period: 'last_30_days' }, now, 'Africa/Bamako'));
    expect(m.days).toHaveLength(30);
    expect(m.previous.to).toBe(m.current.from);
  });

  it('mois en cours comparé aux mêmes jours du mois précédent', () => {
    const p = resolved(resolveAnalyticsPeriod({ period: 'this_month' }, now, 'Africa/Bamako'));
    expect(p.current).toMatchObject({ from: '2026-10-01T00:00', to: '2026-10-31T00:00' });
    expect(p.previous).toMatchObject({ from: '2026-09-01T00:00', to: '2026-10-01T00:00' });
    // 31 mars → le mois précédent (février) est tronqué à sa fin.
    const march = resolved(
      resolveAnalyticsPeriod({ period: 'this_month' }, new Date('2026-03-31T10:00:00Z'), 'UTC'),
    );
    expect(march.previous).toMatchObject({ from: '2026-02-01T00:00', to: '2026-03-01T00:00' });
  });

  it('période personnalisée : dates incluses, bornée, validée', () => {
    const p = resolved(
      resolveAnalyticsPeriod(
        { period: 'custom', from: '2026-10-01', to: '2026-10-10' },
        now,
        'Africa/Bamako',
      ),
    );
    expect(p.current).toMatchObject({ from: '2026-10-01T00:00', to: '2026-10-11T00:00' });
    expect(p.previous).toMatchObject({ from: '2026-09-21T00:00', to: '2026-10-01T00:00' });
    const err = (from?: string, to?: string) =>
      resolveAnalyticsPeriod({ period: 'custom', from, to }, now, 'UTC');
    expect(err()).toEqual({ error: 'MISSING_DATES' });
    expect(err('2026-02-30', '2026-03-01')).toEqual({ error: 'INVALID_DATE' });
    expect(err('2026-10-10', '2026-10-01')).toEqual({ error: 'RANGE_INVERTED' });
    expect(err('2025-01-01', '2026-10-01')).toEqual({ error: 'RANGE_TOO_LONG' });
    expect('error' in err('2025-10-01', '2026-10-01')).toBe(false); // 366 jours : accepté
  });
});

describe('Analyses — règles de calcul', () => {
  it('variation et panier moyen sans division par zéro', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 0)).toBeNull();
    expect(averageBasket(10_000, 3)).toBe(3333);
    expect(averageBasket(0, 0)).toBeNull();
  });

  it('occurrences des jours de la semaine (lundi en premier)', () => {
    // 26/10/2026 est un lundi.
    expect(weekdayOccurrences(['2026-10-26', '2026-10-27', '2026-11-02'])).toEqual([
      2, 1, 0, 0, 0, 0, 0,
    ]);
  });

  it('coût matière : complet, sans recette, ou incomplet — jamais estimé', () => {
    expect(
      unitMaterialCost([
        { stockItemName: 'Poulet', quantity: 0.5, unitCost: 3000 },
        { stockItemName: 'Oignon', quantity: 0.1, unitCost: 500 },
      ]),
    ).toEqual({ cost: 1550, gap: null, missing: [] });
    expect(unitMaterialCost([])).toEqual({ cost: null, gap: 'NO_RECIPE', missing: [] });
    expect(
      unitMaterialCost([
        { stockItemName: 'Poulet', quantity: 0.5, unitCost: 3000 },
        { stockItemName: 'Épices', quantity: 0.01, unitCost: null },
      ]),
    ).toEqual({ cost: null, gap: 'MISSING_COST', missing: ['Épices'] });
    expect(marginRate(4000, 2450)).toBe(61.3);
    expect(marginRate(0, 0)).toBeNull();
  });
});

describe('Analyses — permissions', () => {
  it('lecture : propriétaire, administrateur, superviseur ; jamais caissier, cuisine, agent', () => {
    expect(hasPermission('OWNER', 'analytics.read')).toBe(true);
    expect(hasPermission('ADMIN', 'analytics.read')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'analytics.read')).toBe(true);
    for (const role of ['CASHIER', 'KITCHEN', 'GATE_AGENT'] as const) {
      expect(hasPermission(role, 'analytics.read')).toBe(false);
    }
  });

  it('marges et exports réservés au propriétaire et à l’administrateur', () => {
    for (const p of ['analytics.margins', 'analytics.export'] as const) {
      expect(hasPermission('OWNER', p)).toBe(true);
      expect(hasPermission('ADMIN', p)).toBe(true);
      expect(hasPermission('SUPERVISOR', p)).toBe(false);
    }
  });

  it('module Analyses visible selon le rôle', () => {
    expect(navigationFor('PARK', 'SUPERVISOR').map((m) => m.key)).toContain('analytics');
    expect(navigationFor('RESTAURANT', 'CASHIER').map((m) => m.key)).not.toContain('analytics');
  });
});
