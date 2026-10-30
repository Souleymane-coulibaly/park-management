import {
  type BusinessType,
  assignableRoles,
  canChangeBusinessType,
  formatXof,
  hasPermission,
  isCompatibleBusinessType,
  isRoleAvailableFor,
  navigationFor,
  passwordPolicyErrors,
} from './index';

const ownerNav = (bt: BusinessType) => navigationFor(bt, 'OWNER').map((m) => m.label);

describe('navigation par métier', () => {
  it('PARK : modules parc uniquement', () => {
    expect(ownerNav('PARK')).toEqual([
      'Tableau de bord',
      'Billetterie',
      'Contrôle des entrées',
      'Clients et fidélité',
      'Planning',
      'Copilote IA',
      'Employés',
      'Paramètres',
    ]);
  });

  it('RESTAURANT : modules restaurant uniquement', () => {
    expect(ownerNav('RESTAURANT')).toEqual([
      'Tableau de bord',
      'Caisse POS',
      'Catalogue',
      'Commandes',
      'Cuisine KDS',
      'Réservations',
      'Salles et tables',
      'Stocks',
      'Bornes de commande',
      'Clients et fidélité',
      'Planning',
      'Copilote IA',
      'Employés',
      'Paramètres',
    ]);
  });

  it('PARK_RESTAURANT : navigation combinée', () => {
    const nav = ownerNav('PARK_RESTAURANT');
    expect(nav).toEqual(
      expect.arrayContaining(['Billetterie', 'Contrôle des entrées', 'Caisse POS', 'Cuisine KDS']),
    );
    expect(nav).toHaveLength(16);
  });

  it('masque Employés à un caissier', () => {
    const keys = navigationFor('RESTAURANT', 'CASHIER').map((m) => m.key);
    expect(keys).not.toContain('employees');
    expect(keys).toContain('dashboard');
  });
});

describe('RBAC', () => {
  it('seul OWNER fait évoluer le métier', () => {
    expect(hasPermission('OWNER', 'organization.change_business_type')).toBe(true);
    expect(hasPermission('ADMIN', 'organization.change_business_type')).toBe(false);
  });

  it('un caissier ne consulte ni ne gère les employés', () => {
    expect(hasPermission('CASHIER', 'employee.read')).toBe(false);
    expect(hasPermission('CASHIER', 'employee.manage')).toBe(false);
  });

  it('un ADMIN ne peut attribuer ni ADMIN ni OWNER', () => {
    expect(assignableRoles('ADMIN')).not.toContain('OWNER');
    expect(assignableRoles('ADMIN')).not.toContain('ADMIN');
    expect(assignableRoles('SUPERVISOR')).toEqual([]);
  });

  it('rôles conditionnés par le métier', () => {
    expect(isRoleAvailableFor('KITCHEN', 'PARK')).toBe(false);
    expect(isRoleAvailableFor('GATE_AGENT', 'RESTAURANT')).toBe(false);
    expect(isRoleAvailableFor('KITCHEN', 'PARK_RESTAURANT')).toBe(true);
  });
});

describe('métier', () => {
  it('évolution vers PARK_RESTAURANT uniquement', () => {
    expect(canChangeBusinessType('PARK', 'PARK_RESTAURANT')).toBe(true);
    expect(canChangeBusinessType('RESTAURANT', 'PARK_RESTAURANT')).toBe(true);
    expect(canChangeBusinessType('PARK_RESTAURANT', 'PARK')).toBe(false);
    expect(canChangeBusinessType('PARK', 'RESTAURANT')).toBe(false);
  });

  it('compatibilité établissement / organisation', () => {
    expect(isCompatibleBusinessType('PARK', 'RESTAURANT')).toBe(false);
    expect(isCompatibleBusinessType('PARK', 'PARK_RESTAURANT')).toBe(false);
    expect(isCompatibleBusinessType('PARK_RESTAURANT', 'RESTAURANT')).toBe(true);
  });
});

describe('utilitaires', () => {
  it('formate le FCFA', () => {
    expect(formatXof(25000)).toBe('25 000 FCFA');
  });

  it('applique la politique de mot de passe', () => {
    expect(passwordPolicyErrors('Bamako2026x')).toEqual([]);
    expect(passwordPolicyErrors('court').length).toBeGreaterThan(0);
  });
});
