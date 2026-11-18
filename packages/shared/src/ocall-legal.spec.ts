import {
  EMPTY_OCALL_LEGAL_IDENTITY,
  OCALL_INVOICE_REQUIRED_FIELDS,
  cleanLegalValue,
  missingInvoiceLegalFields,
  publicLegalIdentity,
} from './ocall-legal';
import { hasPlatformPermission } from './platform';

describe('Identité légale Ocall (commercialisation J2)', () => {
  it('identité vide : toutes les mentions obligatoires manquent', () => {
    expect(missingInvoiceLegalFields(EMPTY_OCALL_LEGAL_IDENTITY)).toEqual([
      ...OCALL_INVOICE_REQUIRED_FIELDS,
    ]);
    expect(missingInvoiceLegalFields(null)).toEqual([...OCALL_INVOICE_REQUIRED_FIELDS]);
  });

  it('un blanc ne compte pas comme renseigné', () => {
    expect(cleanLegalValue('   ')).toBeNull();
    expect(cleanLegalValue('  NIF 1 ')).toBe('NIF 1');
    const full = Object.fromEntries(OCALL_INVOICE_REQUIRED_FIELDS.map((f) => [f, 'x']));
    expect(missingInvoiceLegalFields(full)).toEqual([]);
    expect(missingInvoiceLegalFields({ ...full, nif: ' ' })).toEqual(['nif']);
  });

  it('les coordonnées bancaires ne sont jamais publiées', () => {
    const pub = publicLegalIdentity({ ...EMPTY_OCALL_LEGAL_IDENTITY, bankDetails: 'IBAN' });
    expect(pub).not.toHaveProperty('bankDetails');
  });

  it('modification réservée au propriétaire et à l’administrateur délégué', () => {
    expect(hasPlatformPermission('PLATFORM_OWNER', 'platform.legal.manage')).toBe(true);
    expect(hasPlatformPermission('SUPER_ADMIN', 'platform.legal.manage')).toBe(true);
    expect(hasPlatformPermission('PLATFORM_ADMIN', 'platform.legal.manage')).toBe(true);
    for (const role of ['BILLING_MANAGER', 'SUPPORT_AGENT', 'READ_ONLY_AUDITOR'] as const) {
      expect(hasPlatformPermission(role, 'platform.legal.manage')).toBe(false);
    }
  });
});
