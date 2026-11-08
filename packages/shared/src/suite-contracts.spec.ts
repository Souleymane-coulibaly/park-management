import {
  type CoveringContract,
  resolveProductEntitlement,
  schoolAccessIn,
} from './suite-contracts';

/** Droits School avec plusieurs contrats : jamais un seul contrat retenu arbitrairement. */
describe('Contrats multiples d’un client', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const contract = (over: Partial<CoveringContract>): CoveringContract => ({
    status: 'ACTIVE',
    startsOn: '2026-01-01',
    endsOn: '2099-12-31',
    modules: [],
    limits: {},
    coveredSchoolIds: [],
    ...over,
  });
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';

  it('un contrat actif par établissement : chacun écrit sur le sien, quel que soit l’ordre', () => {
    const ca = contract({ coveredSchoolIds: [A] });
    const cb = contract({ coveredSchoolIds: [B] });
    for (const list of [
      [ca, cb],
      [cb, ca],
    ]) {
      const r = resolveProductEntitlement(list, now);
      expect(r).toMatchObject({ access: 'full', readSchoolIds: [A, B], writeSchoolIds: [A, B] });
      expect(schoolAccessIn(r, A)).toBe('full');
      expect(schoolAccessIn(r, B)).toBe('full');
      expect(schoolAccessIn(r, C)).toBe('none');
    }
  });

  it('A actif, B seulement suspendu : écriture sur A, lecture seule sur B', () => {
    const r = resolveProductEntitlement(
      [
        contract({ coveredSchoolIds: [A] }),
        contract({ status: 'SUSPENDED', coveredSchoolIds: [B] }),
      ],
      now,
    );
    expect(r).toMatchObject({ access: 'full', readSchoolIds: [A, B], writeSchoolIds: [A] });
    expect(schoolAccessIn(r, B)).toBe('read_only');
  });

  it('contrat sans couverture précise : tous les établissements ; échu ou brouillon pris en compte', () => {
    const all = resolveProductEntitlement([contract({})], now);
    expect(all).toMatchObject({ readSchoolIds: null, writeSchoolIds: null });
    expect(schoolAccessIn(all, C)).toBe('full');
    // Actif mais échu : lecture seule ; brouillon ou pas encore commencé : aucun droit.
    const late = resolveProductEntitlement([contract({ endsOn: '2026-10-01' })], now);
    expect(late).toMatchObject({ access: 'read_only', readSchoolIds: null, writeSchoolIds: [] });
    expect(
      resolveProductEntitlement(
        [contract({ status: 'DRAFT' }), contract({ startsOn: '2027-01-01' })],
        now,
      ),
    ).toMatchObject({ access: 'none', readSchoolIds: [], writeSchoolIds: [] });
  });

  it('modules : union des contrats valides ; maxSchools : la plus favorable, sans cumul', () => {
    const r = resolveProductEntitlement(
      [
        contract({ modules: ['finance'], limits: { maxSchools: 3 } }),
        contract({ modules: ['portail'], limits: { maxSchools: 5 } }),
        contract({ status: 'EXPIRED', modules: ['ia'], limits: { maxSchools: 50 } }),
        contract({ status: 'DRAFT', modules: ['brouillon'] }),
      ],
      now,
    );
    expect(r.modules).toEqual(['finance', 'ia', 'portail']);
    // Le contrat expiré n'ouvre aucune création : sa limite ne compte pas.
    expect(r.limits).toEqual({ maxSchools: 5 });
    expect(
      resolveProductEntitlement(
        [contract({ limits: { maxSchools: 3 } }), contract({ limits: {} })],
        now,
      ).limits,
    ).toEqual({});
  });

  it('aucun contrat : aucun droit', () => {
    expect(resolveProductEntitlement([], now)).toEqual({
      access: 'none',
      readSchoolIds: [],
      writeSchoolIds: [],
      modules: [],
      limits: {},
    });
  });
});
