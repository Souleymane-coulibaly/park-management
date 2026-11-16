import { allocatePayment } from './partners';
import { computeInvoiceLines } from './platform';
import {
  SITE_PRICING,
  billedSiteCount,
  billedSiteSources,
  computeSiteProrata,
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

  it('Parc et Restaurant comptés séparément ; séparation commerciale non activée par défaut', () => {
    expect(billedSiteSources('OCALL_PARK')).toEqual(['OCALL_PARK', 'OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_PARK', true)).toEqual(['OCALL_PARK']);
    expect(billedSiteSources('OCALL_RESTAURANT')).toEqual(['OCALL_RESTAURANT']);
    expect(billedSiteSources('OCALL_PARK_RESTAURANT', true)).toEqual([
      'OCALL_PARK',
      'OCALL_RESTAURANT',
    ]);
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

  it('prorata : site ajouté en cours de période jusqu’à l’échéance, jamais pour un simple rattachement', () => {
    const issuedAt = at('2026-11-01T00:00:00Z');
    const coverageEnd = at('2026-12-01T00:00:00Z');
    const now = at('2026-11-20T10:00:00Z');
    const base = { siteKey: 'a', label: 'A', startedAt: at('2026-10-01T00:00:00Z') };
    const added = { siteKey: 'b', label: 'B', startedAt: at('2026-11-16T00:00:00Z') };
    const items = computeSiteProrata({
      extraSitePrice: 7_500,
      previous: { billedSites: 1, issuedAt },
      open: [base, added],
      coverageEnd,
      now,
    });
    expect(items).toEqual([expect.objectContaining({ siteKey: 'b', days: 15, amount: 3_750 })]);
    // Rattachement : une activation fermée, une ouverte, même nombre de sites → aucun prorata.
    expect(
      computeSiteProrata({
        extraSitePrice: 7_500,
        previous: { billedSites: 2, issuedAt },
        open: [base, added],
        coverageEnd,
        now,
      }),
    ).toEqual([]);
    // Trois sites retirés, deux ajoutés : moins de sites qu'à la facture précédente, aucun prorata.
    const added2 = { siteKey: 'c', label: 'C', startedAt: at('2026-11-18T00:00:00Z') };
    expect(
      computeSiteProrata({
        extraSitePrice: 7_500,
        previous: { billedSites: 4, issuedAt },
        open: [base, added, added2],
        coverageEnd,
        now,
      }),
    ).toEqual([]);
    // Premier site réel couvert par le minimum d'un site.
    expect(
      computeSiteProrata({
        extraSitePrice: 7_500,
        previous: { billedSites: 1, issuedAt },
        open: [added],
        coverageEnd,
        now,
      }),
    ).toEqual([]);
    // Sans facture précédente ni période en cours : rien.
    expect(
      computeSiteProrata({
        extraSitePrice: 7_500,
        previous: null,
        open: [base, added],
        coverageEnd,
        now,
      }),
    ).toEqual([]);
    expect(
      computeSiteProrata({
        extraSitePrice: 7_500,
        previous: { billedSites: 1, issuedAt },
        open: [base, added],
        coverageEnd: new Date(now.getTime() - DAY),
        now,
      }),
    ).toEqual([]);
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
    });
    expect(mixed).toMatchObject({ combined: true, monthlyAmount: 50_000 });
    expect(mixed.targets).toEqual([
      { productCode: 'OCALL_PARK', sites: 2, indicativeMonthly: 25_000 },
      { productCode: 'OCALL_RESTAURANT', sites: 1, indicativeMonthly: 17_500 },
    ]);
    const parkOnly = proposeParkRestaurantSplit({
      ...base,
      productCode: 'OCALL_PARK',
      parkSites: 1,
      restaurantSites: 0,
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
