import {
  FACTURE_DEFAULT_VAT_RATE,
  FACTURE_PERMISSIONS,
  FACTURE_VAT_RATES,
  assignableFactureRoles,
  factureLegalMissing,
  formatFactureNumber,
  formatVatRate,
  hasFacturePermission,
  isFactureVatRate,
} from './facture';

describe('Ocall Facture — règles partagées', () => {
  it('TVA : liste de 0 à 20 %, 18 % par défaut, aucun autre taux admis', () => {
    expect(FACTURE_VAT_RATES).toEqual([...Array(21).keys()]);
    expect(FACTURE_DEFAULT_VAT_RATE).toBe(18);
    expect([0, 18, 20].every(isFactureVatRate)).toBe(true);
    expect([-1, 21, 18.5, '18', null].some(isFactureVatRate)).toBe(false);
    expect(formatVatRate(0)).toBe('Exonéré (0 %)');
    expect(formatVatRate(18)).toBe('18 %');
  });

  it('numérotation : préfixe, année et rang sur 5 chiffres ; rang invalide refusé', () => {
    expect(formatFactureNumber('INVOICE', 2026, 1)).toBe('FAC-2026-00001');
    expect(formatFactureNumber('QUOTE', 2026, 42)).toBe('DEV-2026-00042');
    expect(formatFactureNumber('CREDIT_NOTE', 2027, 123456)).toBe('AV-2027-123456');
    expect(() => formatFactureNumber('INVOICE', 2026, 0)).toThrow();
    expect(() => formatFactureNumber('INVOICE', 2026, 1.5)).toThrow();
  });

  it('mentions légales : raison sociale, adresse, NIF et régime exigés avant émission', () => {
    expect(factureLegalMissing({})).toEqual([
      'Raison sociale',
      'Adresse',
      'Numéro d’identification fiscale (NIF)',
      'Régime d’imposition',
    ]);
    expect(
      factureLegalMissing({
        legalName: 'Ocall Démo SARL',
        address: 'ACI 2000',
        city: 'Bamako',
        nif: '084123456A',
        taxRegime: 'Régime du réel normal',
      }),
    ).toEqual([]);
    expect(
      factureLegalMissing({
        legalName: '  ',
        address: 'x',
        city: 'Bamako',
        nif: 'X',
        taxRegime: 'R',
      }),
    ).toEqual(['Raison sociale']);
  });

  it('permissions : le gérant a tout ; le technicien entre seulement ; seul le gérant gère l’équipe', () => {
    expect(FACTURE_PERMISSIONS.every((p) => hasFacturePermission('MANAGER', p))).toBe(true);
    expect(hasFacturePermission('TECHNICIAN', 'facture.access')).toBe(true);
    expect(hasFacturePermission('TECHNICIAN', 'facture.members.read')).toBe(false);
    expect(hasFacturePermission('SALES', 'facture.settings.manage')).toBe(false);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.members.manage')).toBe(false);
    expect(assignableFactureRoles('MANAGER')).toHaveLength(4);
    expect(assignableFactureRoles('SALES')).toEqual([]);
  });
});
