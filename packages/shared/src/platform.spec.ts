import {
  PLATFORM_ROLES,
  assignablePlatformRoles,
  computeInvoiceLines,
  effectivePlatformRole,
  formatInvoiceNumber,
  hasPlatformPermission,
  isProductCode,
  platformRoleRequiresMfa,
} from './index';

describe('Ocall Suite — rôles internes', () => {
  it('le rôle historique SUPER_ADMIN vaut propriétaire', () => {
    expect(effectivePlatformRole('SUPER_ADMIN')).toBe('PLATFORM_OWNER');
    expect(effectivePlatformRole(null)).toBeNull();
  });

  it('matrice : comptes internes réservés au propriétaire ; auditeur en lecture seule', () => {
    expect(hasPlatformPermission('PLATFORM_OWNER', 'platform.users.manage')).toBe(true);
    expect(hasPlatformPermission('SUPER_ADMIN', 'platform.users.manage')).toBe(true);
    expect(hasPlatformPermission('PLATFORM_ADMIN', 'platform.users.manage')).toBe(false);
    expect(hasPlatformPermission('BILLING_MANAGER', 'platform.billing.validate')).toBe(true);
    expect(hasPlatformPermission('BILLING_MANAGER', 'platform.products.manage')).toBe(false);
    expect(hasPlatformPermission('SUPPORT_AGENT', 'platform.billing.read')).toBe(false);
    for (const p of [
      'platform.billing.manage',
      'platform.billing.validate',
      'platform.orgs.manage',
    ] as const) {
      expect(hasPlatformPermission('READ_ONLY_AUDITOR', p)).toBe(false);
    }
    expect(hasPlatformPermission('READ_ONLY_AUDITOR', 'platform.audit.read')).toBe(true);
    expect(hasPlatformPermission(null, 'platform.dashboard')).toBe(false);
  });

  it('le rôle propriétaire n’est jamais attribuable ; seul le propriétaire attribue', () => {
    expect(assignablePlatformRoles('PLATFORM_OWNER')).not.toContain('PLATFORM_OWNER');
    expect(assignablePlatformRoles('PLATFORM_OWNER')).toHaveLength(PLATFORM_ROLES.length - 1);
    expect(assignablePlatformRoles('PLATFORM_ADMIN')).toEqual([]);
    expect(assignablePlatformRoles('BILLING_MANAGER')).toEqual([]);
  });

  it('MFA obligatoire pour propriétaire, administrateur, facturation', () => {
    expect(platformRoleRequiresMfa('SUPER_ADMIN')).toBe(true);
    expect(platformRoleRequiresMfa('PLATFORM_ADMIN')).toBe(true);
    expect(platformRoleRequiresMfa('BILLING_MANAGER')).toBe(true);
    expect(platformRoleRequiresMfa('SUPPORT_AGENT')).toBe(false);
    expect(platformRoleRequiresMfa('READ_ONLY_AUDITOR')).toBe(false);
  });
});

describe('Ocall Suite — facturation (montants calculés par le serveur)', () => {
  const agreed = { setupFee: 250_000, monthlyPrice: 15_000 };

  it('mise en service + mensualités au tarif accepté', () => {
    const r = computeInvoiceLines([{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 3 }], agreed);
    expect('total' in r && r.total).toBe(295_000);
    expect(
      'lines' in r && r.lines.map((l) => [l.kind, l.quantity, l.unitAmount, l.amount]),
    ).toEqual([
      ['SETUP', 1, 250_000, 250_000],
      ['MONTHLY', 3, 15_000, 45_000],
    ]);
  });

  it('ajustement motivé (remise), total jamais nul ou négatif', () => {
    const r = computeInvoiceLines(
      [{ kind: 'MONTHLY' }, { kind: 'ADJUSTMENT', amount: -5_000, reason: 'Geste commercial' }],
      agreed,
    );
    expect('total' in r && r.total).toBe(10_000);
    expect(
      computeInvoiceLines([{ kind: 'ADJUSTMENT', amount: -1, reason: 'x' }], agreed),
    ).toHaveProperty('error');
    expect(
      computeInvoiceLines(
        [{ kind: 'MONTHLY' }, { kind: 'ADJUSTMENT', amount: -20_000, reason: 'Remise' }],
        agreed,
      ),
    ).toHaveProperty('error');
    expect(
      computeInvoiceLines([{ kind: 'MONTHLY' }, { kind: 'ADJUSTMENT', amount: 1_000 }], agreed),
    ).toHaveProperty('error');
  });

  it('refus : deux mises en service, mensualités hors bornes, facture vide', () => {
    expect(computeInvoiceLines([{ kind: 'SETUP' }, { kind: 'SETUP' }], agreed)).toHaveProperty(
      'error',
    );
    expect(computeInvoiceLines([{ kind: 'MONTHLY', months: 25 }], agreed)).toHaveProperty('error');
    expect(computeInvoiceLines([], agreed)).toHaveProperty('error');
  });

  it('numérotation et codes produit', () => {
    expect(formatInvoiceNumber(2026, 42)).toBe('OCP-2026-00042');
    expect(isProductCode('OCALL_SCHOOL')).toBe(true);
    expect(isProductCode('ocall-school')).toBe(false);
  });
});
