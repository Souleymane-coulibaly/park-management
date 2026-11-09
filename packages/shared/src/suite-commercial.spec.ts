import {
  SUITE_PRICING,
  TRIAL_DAYS,
  canPublishShowcase,
  canStartTrial,
  commercialState,
  isSetupFeeDue,
  quoteSubscription,
  quoteTotal,
  subscriptionAccess,
  trialDaysRemaining,
  trialEndsAt,
} from './suite-commercial';
import { canSubscribeToProduct, isProductBillable } from './platform';
import {
  type CoveringContract,
  SCHOOL_FREE_LIMITS,
  resolveProductEntitlement,
} from './suite-contracts';

const without = {
  monthlyPrice: SUITE_PRICING.monthlyWithoutShowcase,
  setupFee: SUITE_PRICING.setupFee,
};
const withShowcase = {
  monthlyPrice: SUITE_PRICING.monthlyWithShowcase,
  setupFee: SUITE_PRICING.setupFee,
};

describe('Grille tarifaire Ocall Suite (S1)', () => {
  it('50 000 sans vitrine, 65 000 avec vitrine, 200 000 de setup', () => {
    expect(quoteSubscription(without, null)).toEqual({
      setupFee: 200_000,
      monthlyPrice: 50_000,
      firstPayment: 250_000,
      recurring: 50_000,
    });
    expect(quoteSubscription(withShowcase, null).firstPayment).toBe(265_000);
  });

  it('exemple validé : Park + School sans vitrine → 500 000 puis 100 000', () => {
    const total = quoteTotal([quoteSubscription(without, null), quoteSubscription(without, 'DUE')]);
    expect(total.setupFee).toBe(400_000);
    expect(total.firstPayment).toBe(500_000);
    expect(total.recurring).toBe(100_000);
  });

  it('setup jamais refacturé : facturé, réglé ou non dû (offre gratuite) → 0', () => {
    for (const status of ['INVOICED', 'PAID', 'WAIVED'] as const) {
      expect(isSetupFeeDue(status)).toBe(false);
      expect(quoteSubscription(withShowcase, status)).toMatchObject({
        setupFee: 0,
        firstPayment: 65_000,
      });
    }
    expect(isSetupFeeDue('DUE')).toBe(true);
    expect(isSetupFeeDue(undefined)).toBe(true);
  });

  it('tarif négatif refusé', () => {
    expect(() => quoteSubscription({ monthlyPrice: -1, setupFee: 0 }, null)).toThrow();
  });
});

describe('Essai gratuit de 14 jours', () => {
  const start = new Date('2026-11-01T10:00:00Z');

  it('fin calculée en UTC : début + 14 jours', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAt(start).toISOString()).toBe('2026-11-15T10:00:00.000Z');
  });

  it('jours restants : 14 au départ, 1 la dernière journée, 0 à l’échéance', () => {
    const end = trialEndsAt(start);
    expect(trialDaysRemaining(end, start)).toBe(14);
    expect(trialDaysRemaining(end, new Date('2026-11-15T09:00:00Z'))).toBe(1);
    expect(trialDaysRemaining(end, end)).toBe(0);
    expect(trialDaysRemaining(end, new Date('2026-12-01T00:00:00Z'))).toBe(0);
  });

  it('durée invalide refusée', () => {
    expect(() => trialEndsAt(start, 0)).toThrow();
    expect(() => trialEndsAt(start, 1.5)).toThrow();
    expect(() => trialEndsAt(start, 365)).toThrow();
  });

  it('client : essai seulement sur une application disponible ; Ocall : aussi pilote et préproduction (D1)', () => {
    expect(canStartTrial('ACTIVE', 'customer')).toBe(true);
    for (const s of [
      'PREPRODUCTION',
      'PILOT',
      'COMING_SOON',
      'PLANNED',
      'SUSPENDED',
      'RETIRED',
    ] as const)
      expect(canStartTrial(s, 'customer')).toBe(false);
    expect(canStartTrial('PREPRODUCTION', 'ocall')).toBe(true);
    expect(canStartTrial('PILOT', 'ocall')).toBe(true);
    for (const s of ['COMING_SOON', 'PLANNED', 'SUSPENDED', 'RETIRED'] as const)
      expect(canStartTrial(s, 'ocall')).toBe(false);
  });

  it('préproduction : souscription et facturation par Ocall seulement', () => {
    expect(canSubscribeToProduct('PREPRODUCTION', 'customer')).toBe(false);
    expect(canSubscribeToProduct('PREPRODUCTION', 'ocall')).toBe(true);
    expect(isProductBillable('PREPRODUCTION')).toBe(true);
    expect(isProductBillable('COMING_SOON')).toBe(false);
  });
});

describe('États et droits d’accès (D3)', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const past = '2026-11-09T12:00:00Z';
  const future = '2026-11-20T12:00:00Z';

  it('essai en cours → complet ; essai échu → lecture seule, sans tâche planifiée', () => {
    expect(
      subscriptionAccess({ status: 'TRIALING', expiresAt: null, trialEndsAt: future }, now),
    ).toBe('full');
    expect(commercialState({ status: 'TRIALING', expiresAt: null, trialEndsAt: past }, now)).toBe(
      'TRIAL_EXPIRED',
    );
    expect(
      subscriptionAccess({ status: 'TRIALING', expiresAt: null, trialEndsAt: past }, now),
    ).toBe('read_only');
    // Essai sans date (incohérence) : jamais d'accès complet.
    expect(
      subscriptionAccess({ status: 'TRIALING', expiresAt: null, trialEndsAt: null }, now),
    ).toBe('read_only');
  });

  it('abonnement actif → complet ; échéance passée → lecture seule dès l’instant de l’échéance', () => {
    expect(
      subscriptionAccess({ status: 'ACTIVE', expiresAt: future, trialEndsAt: null }, now),
    ).toBe('full');
    expect(subscriptionAccess({ status: 'ACTIVE', expiresAt: past, trialEndsAt: null }, now)).toBe(
      'read_only',
    );
  });

  it('expiré, suspendu, résilié → lecture seule (données conservées)', () => {
    for (const status of ['EXPIRED', 'SUSPENDED', 'CANCELED'] as const)
      expect(subscriptionAccess({ status, expiresAt: null, trialEndsAt: null }, now)).toBe(
        'read_only',
      );
  });

  it('renouvellement en attente → complet ; « non activé » antérieur à S1 → complet (pas de rétroactivité)', () => {
    expect(
      subscriptionAccess({ status: 'PAST_DUE', expiresAt: past, trialEndsAt: null }, now),
    ).toBe('full');
    expect(
      subscriptionAccess({ status: 'PENDING_ACTIVATION', expiresAt: null, trialEndsAt: null }, now),
    ).toBe('full');
    expect(
      subscriptionAccess({ status: 'NOT_ACTIVATED', expiresAt: null, trialEndsAt: null }, now),
    ).toBe('full');
  });

  it('aucun abonnement → aucun accès ; statut inconnu → jamais complet', () => {
    expect(subscriptionAccess(null, now)).toBe('none');
    expect(
      subscriptionAccess({ status: 'MYSTERE' as never, expiresAt: null, trialEndsAt: null }, now),
    ).toBe('read_only');
  });
});

describe('Option vitrine (D5)', () => {
  it('publication : offre avec vitrine ou antériorité', () => {
    expect(canPublishShowcase({ planIncludesShowcase: true, grandfathered: false })).toBe(true);
    expect(canPublishShowcase({ planIncludesShowcase: false, grandfathered: true })).toBe(true);
    expect(canPublishShowcase({ planIncludesShowcase: false, grandfathered: false })).toBe(false);
  });
});

describe('Offre Ocall School Free dans le résolveur de contrats', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const contract = (over: Partial<CoveringContract>): CoveringContract => ({
    status: 'ACTIVE',
    startsOn: '2026-01-01',
    endsOn: '9999-12-31',
    modules: [],
    limits: {},
    coveredSchoolIds: [],
    ...over,
  });

  it('gratuit seul : 50 élèves, 20 requêtes IA par établissement, pas de SMS', () => {
    const r = resolveProductEntitlement([contract({ limits: { ...SCHOOL_FREE_LIMITS } })], now);
    expect(r.access).toBe('full');
    expect(r.tier).toBe('FREE');
    expect(r.limits).toEqual({ maxStudents: 50, aiMonthlyCallsPerSchool: 20, sms: false });
  });

  it('gratuit + payant sans limite : limites levées, SMS permis, nature payante', () => {
    const r = resolveProductEntitlement(
      [contract({ limits: { ...SCHOOL_FREE_LIMITS } }), contract({ limits: {} })],
      now,
    );
    expect(r.tier).toBe('PAID');
    expect(r.limits).toEqual({});
  });

  it('gratuit + payant expiré : seul le gratuit donne les limites', () => {
    const r = resolveProductEntitlement(
      [
        contract({ limits: { ...SCHOOL_FREE_LIMITS } }),
        contract({ status: 'EXPIRED', limits: { tier: 'PAID' } }),
      ],
      now,
    );
    expect(r.tier).toBe('FREE');
    expect(r.limits.maxStudents).toBe(50);
  });

  it('essai + gratuit : nature essai, limites de l’essai (aucune) prévalent', () => {
    const r = resolveProductEntitlement(
      [contract({ limits: { ...SCHOOL_FREE_LIMITS } }), contract({ limits: { tier: 'TRIAL' } })],
      now,
    );
    expect(r.tier).toBe('TRIAL');
    expect(r.limits).toEqual({});
  });

  it('aucun contrat actif : nature nulle', () => {
    expect(resolveProductEntitlement([], now).tier).toBeNull();
  });
});
