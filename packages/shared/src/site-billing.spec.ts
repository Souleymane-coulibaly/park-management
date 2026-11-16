import { allocatePayment } from './partners';
import { computeInvoiceLines } from './platform';
import {
  SITE_PRICING,
  billedSiteCount,
  billedSiteSources,
  computeSiteProrata,
  coveredUnitsForPeriod,
  perSiteMonthlyAmount,
  planSetupFee,
  proposeParkRestaurantSplit,
  subscriptionMonthlyAmount,
} from './site-billing';
import { quoteSubscription } from './suite-commercial';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('Ocall Suite étape 6 — facturation par site', () => {
  it('grille : 17 500 le premier site, 7 500 chaque site supplémentaire, vitrine 5 000', () => {
    const prices = { firstSite: 17_500, extraSite: 7_500, showcase: 0 };
    expect(perSiteMonthlyAmount(prices, 1)).toBe(17_500);
    expect(perSiteMonthlyAmount(prices, 3)).toBe(32_500);
    expect(perSiteMonthlyAmount({ ...prices, showcase: 5_000 }, 3)).toBe(37_500);
    // Toujours au moins un site facturé.
    expect(perSiteMonthlyAmount(prices, 0)).toBe(17_500);
    expect(billedSiteCount([])).toBe(1);
    expect(billedSiteCount(['a', 'b', 'a'])).toBe(2);
    expect(SITE_PRICING).toMatchObject({ firstAppSetupFee: 150_000, extraAppSetupFee: 112_500 });
  });

  it('Parc et Restaurant comptés séparément ; un contrat combiné compte les deux activités', () => {
    expect(billedSiteSources('OCALL_PARK')).toEqual(['OCALL_PARK']);
    expect(billedSiteSources('OCALL_PARK', true)).toEqual(['OCALL_PARK', 'OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_RESTAURANT')).toEqual(['OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_RESTAURANT', true)).toEqual(['OCALL_PARK', 'OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_STOCK', true)).toEqual(['OCALL_STOCK']);
    expect(billedSiteSources('OCALL_PARK_RESTAURANT')).toEqual(['OCALL_PARK', 'OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_STOCK')).toEqual(['OCALL_STOCK']);
  });

  it('revenu mensuel : forfait inchangé, par site sur le dernier décompte et les prix figés', () => {
    const flat = { agreedMonthlyPrice: 50_000, plan: { monthlyPrice: 65_000 } };
    expect(subscriptionMonthlyAmount(flat)).toBe(50_000);
    expect(
      subscriptionMonthlyAmount({ agreedMonthlyPrice: null, plan: { monthlyPrice: 65_000 } }),
    ).toBe(65_000);
    const plan = {
      monthlyPrice: 17_500,
      pricingMode: 'PER_SITE',
      extraSiteMonthlyPrice: 7_500,
      showcaseMonthlyPrice: 5_000,
      includesShowcase: true,
    };
    // Avant tout tarif figé : prix de l'offre, vitrine incluse.
    expect(subscriptionMonthlyAmount({ agreedMonthlyPrice: null, billedSiteCount: 2, plan })).toBe(
      30_000,
    );
    // Prix figés : jamais ceux de l'offre modifiée ensuite.
    expect(
      subscriptionMonthlyAmount({
        agreedMonthlyPrice: 17_500,
        agreedExtraSitePrice: 7_500,
        agreedShowcasePrice: 0,
        billedSiteCount: 3,
        plan: { ...plan, monthlyPrice: 99_000 },
      }),
    ).toBe(32_500);
  });

  it('mise en service dégressive : 150 000 la première application, 112 500 les suivantes', () => {
    const plan = { setupFee: 150_000, extraAppSetupFee: 112_500 };
    expect(planSetupFee(plan, false)).toBe(150_000);
    expect(planSetupFee(plan, true)).toBe(112_500);
    // Offre forfaitaire historique : inchangée.
    expect(planSetupFee({ setupFee: 200_000, extraAppSetupFee: null }, true)).toBe(200_000);
  });

  describe('prorata des sites ajoutés (retrait effectif à l’échéance)', () => {
    const issuedAt = at('2026-11-01T00:00:00Z');
    const coverageEnd = at('2026-12-01T00:00:00Z');
    const now = at('2026-11-25T10:00:00Z');
    const previous = { issuedAt, billedSites: 1, coveredUnits: ['a'] };
    const act = (unitKey: string, day: number) => ({
      unitKey,
      label: unitKey.toUpperCase(),
      startedAt: at(`2026-11-${String(day).padStart(2, '0')}T00:00:00Z`),
    });
    const run = (activations: ReturnType<typeof act>[], prev = previous) =>
      computeSiteProrata({ extraSitePrice: 7_500, previous: prev, activations, coverageEnd, now });

    it('site ajouté : du jour d’activation à l’échéance, prix d’un site supplémentaire', () => {
      expect(run([act('b', 16)]).items).toEqual([
        expect.objectContaining({ unitKey: 'b', days: 15, amount: 3_750 }),
      ]);
    });

    it('ajouté puis retiré dans la période : dû jusqu’à l’échéance, une seule fois', () => {
      // L'activation fermée est fournie (retrait à l'échéance) : facturée comme si le site était resté.
      expect(run([act('b', 16)]).items.map((i) => [i.unitKey, i.amount])).toEqual([['b', 3_750]]);
      // Facture suivante : le site est couvert, jamais refacturé.
      const next = {
        issuedAt: at('2026-11-20T00:00:00Z'),
        billedSites: 1,
        coveredUnits: ['a', 'b'],
      };
      expect(run([act('b', 16)], next).items).toEqual([]);
    });

    it('ajouté, retiré puis rajouté dans la période : une seule activation retenue (la première)', () => {
      expect(run([act('b', 22), act('b', 10)]).items).toEqual([
        expect.objectContaining({ unitKey: 'b', days: 21, amount: 5_250 }),
      ]);
    });

    it('site payé retiré puis rajouté dans la période : aucun prorata', () => {
      expect(run([act('a', 12)]).items).toEqual([]);
    });

    it('plusieurs ajouts et retraits successifs : chacun une fois, du jour de son activation', () => {
      const r = run([act('b', 6), act('c', 11), act('b', 20), act('d', 24)]);
      expect(r.items.map((i) => [i.unitKey, i.days, i.amount])).toEqual([
        ['b', 25, 6_250],
        ['c', 20, 5_000],
        ['d', 7, 1_750],
      ]);
    });

    it('rattachement à un autre établissement : même site (unité), aucun prorata', () => {
      // La clé de décompte change, l'unité (fiche de l'application) reste : déjà couverte.
      expect(run([act('a', 18)]).items).toEqual([]);
    });

    it('minimum d’un site sans site réel : le premier ajouté est couvert, le suivant facturé', () => {
      const empty = { issuedAt, billedSites: 1, coveredUnits: [] };
      const r = run([act('b', 6), act('c', 16)], empty);
      expect(r.freeUnits).toEqual(['b']);
      expect(r.items.map((i) => i.unitKey)).toEqual(['c']);
      // Le site gratuit retiré puis remplacé : le remplaçant est facturé (le minimum reste occupé).
      const after = { issuedAt: at('2026-11-10T00:00:00Z'), billedSites: 1, coveredUnits: ['b'] };
      expect(run([act('c', 16)], after).items.map((i) => i.unitKey)).toEqual(['c']);
    });

    it('période : cumul tant que l’échéance ne bouge pas, mensualités seules après un règlement', () => {
      const prev = {
        coveredUnits: ['a', 'b', 'gone'],
        coverageEnd: coverageEnd.toISOString(),
        sites: [{ siteKey: 'a', unitKeys: ['a'], label: 'A', sources: [] }],
      };
      expect(coveredUnitsForPeriod(prev, coverageEnd)).toEqual(['a', 'b', 'gone']);
      expect(coveredUnitsForPeriod(prev, at('2026-12-31T00:00:00Z'))).toEqual(['a']);
      expect(coveredUnitsForPeriod({}, null)).toEqual([]);
    });

    it('activations antérieures à la facture précédente ou après l’échéance : ignorées', () => {
      expect(run([act('b', 1), act('c', 1)]).items).toEqual([]);
      expect(
        computeSiteProrata({
          extraSitePrice: 7_500,
          previous,
          activations: [{ unitKey: 'b', label: 'B', startedAt: at('2026-12-02T00:00:00Z') }],
          coverageEnd,
          now,
        }).items,
      ).toEqual([]);
    });

    it('sans facture précédente (ou après un changement d’offre) ni couverture : rien', () => {
      expect(run([act('b', 16)], null as unknown as typeof previous).items).toEqual([]);
      expect(
        computeSiteProrata({
          extraSitePrice: 7_500,
          previous,
          activations: [act('b', 16)],
          coverageEnd: new Date(now.getTime() - DAY),
          now,
        }).items,
      ).toEqual([]);
    });
  });

  it('facture par site : premier site, sites supplémentaires, vitrine et prorata ; forfait inchangé', () => {
    const perSite = computeInvoiceLines([{ kind: 'MONTHLY', months: 2 }, { kind: 'SETUP' }], {
      setupFee: 112_500,
      monthlyPrice: 17_500,
      perSite: {
        billedSites: 3,
        extraSitePrice: 7_500,
        showcasePrice: 5_000,
        prorata: [{ amount: 3_750 }],
      },
    });
    if ('error' in perSite) throw new Error(perSite.error);
    expect(perSite.lines.map((l) => [l.kind, l.quantity, l.unitAmount, l.amount])).toEqual([
      ['MONTHLY', 2, 17_500, 35_000],
      ['EXTRA_SITES', 4, 7_500, 30_000],
      ['SHOWCASE', 2, 5_000, 10_000],
      ['SITE_PRORATA', 1, 3_750, 3_750],
      ['SETUP', 1, 112_500, 112_500],
    ]);
    expect(perSite.total).toBe(191_250);
    // Une seule mensualité par facture par site.
    expect(
      computeInvoiceLines([{ kind: 'MONTHLY' }, { kind: 'MONTHLY' }], {
        setupFee: 0,
        monthlyPrice: 17_500,
        perSite: { billedSites: 1, extraSitePrice: 7_500, showcasePrice: 0, prorata: [] },
      }),
    ).toEqual({ error: 'Une seule ligne de mensualités.' });
    // Forfait : plusieurs mensualités toujours acceptées, aucune ligne de site.
    const flat = computeInvoiceLines(
      [
        { kind: 'MONTHLY', months: 1 },
        { kind: 'MONTHLY', months: 2 },
      ],
      {
        setupFee: 200_000,
        monthlyPrice: 50_000,
      },
    );
    if ('error' in flat) throw new Error(flat.error);
    expect(flat.lines.map((l) => l.kind)).toEqual(['MONTHLY', 'MONTHLY']);
    expect(flat.total).toBe(150_000);
  });

  it('encaissements et commissions : sites, vitrine et prorata comptent comme mensualités', () => {
    const lines = [
      { kind: 'SETUP' as const, amount: 100 },
      { kind: 'MONTHLY' as const, amount: 100 },
      { kind: 'EXTRA_SITES' as const, amount: 100 },
      { kind: 'SHOWCASE' as const, amount: 100 },
      { kind: 'SITE_PRORATA' as const, amount: 100 },
      { kind: 'ADJUSTMENT' as const, amount: 100 },
    ];
    expect(allocatePayment(lines, 600, 600)).toEqual({
      setup: 100,
      monthly: 400,
      adjustments: 100,
    });
  });

  it('devis : par site avec mise en service dégressive ; forfait inchangé', () => {
    const plan = {
      monthlyPrice: 17_500,
      setupFee: 150_000,
      pricingMode: 'PER_SITE',
      extraSiteMonthlyPrice: 7_500,
      showcaseMonthlyPrice: 5_000,
      includesShowcase: true,
      extraAppSetupFee: 112_500,
    };
    expect(quoteSubscription(plan, 'DUE', { sites: 3, otherAppInstalled: true })).toEqual({
      setupFee: 112_500,
      monthlyPrice: 37_500,
      firstPayment: 150_000,
      recurring: 37_500,
    });
    expect(quoteSubscription(plan, 'PAID', { sites: 1, otherAppInstalled: false }).setupFee).toBe(
      0,
    );
    expect(quoteSubscription({ monthlyPrice: 50_000, setupFee: 200_000 }, 'DUE')).toEqual({
      setupFee: 200_000,
      monthlyPrice: 50_000,
      firstPayment: 250_000,
      recurring: 50_000,
    });
  });

  it('séparation Parc / Restaurant : aperçu sans changement de prix', () => {
    const base = {
      subscriptionId: 's',
      organizationId: 'o',
      organizationName: 'Org',
      status: 'ACTIVE',
      planName: 'Ocall Park — Sans vitrine',
      monthlyAmount: 50_000,
      expiresAt: null,
    };
    const mixed = proposeParkRestaurantSplit({
      ...base,
      productCode: 'OCALL_PARK',
      parkSites: 2,
      restaurantSites: 1,
      contractCombined: true,
    });
    expect(mixed).toMatchObject({ combined: true, monthlyAmount: 50_000 });
    // Montant total conservé, réparti au prorata de la grille (25 000 / 17 500).
    expect(mixed.defaultSplit).toEqual({ park: 29_412, restaurant: 20_588 });
    // Abonnement Ocall Parc séparé (pas de contrat combiné) : rien à basculer.
    expect(
      proposeParkRestaurantSplit({
        ...base,
        productCode: 'OCALL_PARK',
        parkSites: 2,
        restaurantSites: 1,
        contractCombined: false,
      }),
    ).toMatchObject({ combined: false, defaultSplit: null });
    expect(mixed.targets).toEqual([
      { productCode: 'OCALL_PARK', sites: 2, indicativeMonthly: 25_000 },
      { productCode: 'OCALL_RESTAURANT', sites: 1, indicativeMonthly: 17_500 },
    ]);
    const parkOnly = proposeParkRestaurantSplit({
      ...base,
      productCode: 'OCALL_PARK',
      parkSites: 1,
      restaurantSites: 0,
      contractCombined: true,
    });
    expect(parkOnly.combined).toBe(false);
    expect(
      proposeParkRestaurantSplit({
        ...base,
        productCode: 'OCALL_PARK_RESTAURANT',
        parkSites: 1,
        restaurantSites: 0,
      }).combined,
    ).toBe(true);
  });
});
