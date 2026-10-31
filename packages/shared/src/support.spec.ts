import {
  DEFAULT_STORAGE_QUOTA_MB,
  bytesToMb,
  effectiveQuota,
  formatSupportNumber,
  hasPermission,
  hasPlatformPermission,
  safeDisplayName,
  statusAfterMessage,
} from './index';

describe('Support — règles partagées', () => {
  it('référence lisible SUP-AAAA-NNNNN', () => {
    expect(formatSupportNumber(2026, 42)).toBe('SUP-2026-00042');
  });

  it('une réponse du client relance la demande ; une réponse Ocall attend le client', () => {
    expect(statusAfterMessage('WAITING_CUSTOMER', 'customer')).toBe('IN_PROGRESS');
    expect(statusAfterMessage('RESOLVED', 'customer')).toBe('IN_PROGRESS');
    expect(statusAfterMessage('OPEN', 'customer')).toBe('OPEN');
    expect(statusAfterMessage('IN_PROGRESS', 'ocall')).toBe('WAITING_CUSTOMER');
    expect(statusAfterMessage('CLOSED', 'ocall')).toBe('CLOSED');
  });

  it('nom de fichier affiché nettoyé (jamais utilisé comme clé)', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeDisplayName('facture<script>.pdf')).toBe('facture_script_.pdf');
    expect(safeDisplayName('   ')).toBe('fichier');
    expect(safeDisplayName('a'.repeat(200))).toHaveLength(80);
  });

  it('accès : propriétaire, administrateur et superviseur contactent le support ; pas le caissier', () => {
    expect(hasPermission('OWNER', 'support.use')).toBe(true);
    expect(hasPermission('ADMIN', 'support.use')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'support.use')).toBe(true);
    expect(hasPermission('CASHIER', 'support.use')).toBe(false);
  });

  it('côté Ocall : assistance traite le support ; facturation et audit non', () => {
    expect(hasPlatformPermission('SUPPORT_AGENT', 'platform.support.manage')).toBe(true);
    expect(hasPlatformPermission('PLATFORM_ADMIN', 'platform.support.manage')).toBe(true);
    expect(hasPlatformPermission('BILLING_MANAGER', 'platform.support.manage')).toBe(false);
    expect(hasPlatformPermission('READ_ONLY_AUDITOR', 'platform.support.manage')).toBe(false);
    expect(hasPlatformPermission('READ_ONLY_AUDITOR', 'platform.settings.read')).toBe(true);
    expect(hasPlatformPermission('SUPPORT_AGENT', 'platform.quotas.manage')).toBe(false);
  });
});

describe('Quotas', () => {
  it('dérogation, sinon offre, sinon défaut (0 est une valeur valide)', () => {
    expect(effectiveQuota(2000, 500, 100)).toBe(2000);
    expect(effectiveQuota(null, 500, 100)).toBe(500);
    expect(effectiveQuota(undefined, undefined, DEFAULT_STORAGE_QUOTA_MB)).toBe(1024);
    expect(effectiveQuota(0, 500, 100)).toBe(0);
  });

  it('conversion en Mo arrondie au dixième', () => {
    expect(bytesToMb(1024 * 1024 * 1.25)).toBe(1.3);
    expect(bytesToMb(0)).toBe(0);
  });
});
