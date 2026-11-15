import {
  INVITABLE_ROLES,
  invitableRolesFor,
  invitationNeedsEstablishments,
  invitationState,
  normalizeInvitationIdentifier,
} from './suite-organizations';

describe('Ocall Suite — invitations dans une autre organisation', () => {
  it('jamais propriétaire ; un administrateur n’invite ni administrateur ni propriétaire', () => {
    expect(INVITABLE_ROLES).not.toContain('OWNER');
    expect(invitableRolesFor('OWNER')).toEqual([...INVITABLE_ROLES]);
    expect(invitableRolesFor('ADMIN')).not.toContain('ADMIN');
    expect(invitableRolesFor('ADMIN')).toContain('PRODUCT_USER');
    expect(invitableRolesFor('SUPERVISOR')).toEqual([]);
    expect(invitableRolesFor('PRODUCT_USER')).toEqual([]);
  });

  it('établissements exigés pour les rôles limités seulement', () => {
    expect(invitationNeedsEstablishments('CASHIER')).toBe(true);
    expect(invitationNeedsEstablishments('ADMIN')).toBe(false);
    expect(invitationNeedsEstablishments('PRODUCT_USER')).toBe(false);
  });

  it('identifiant : e-mail en minuscules, identifiant en majuscules, saisie invalide vide', () => {
    expect(normalizeInvitationIdentifier('  Awa@Exemple.ML ')).toBe('awa@exemple.ml');
    expect(normalizeInvitationIdentifier('aqua-0007')).toBe('AQUA-0007');
    expect(normalizeInvitationIdentifier('pas un mail@')).toBe('');
    expect(normalizeInvitationIdentifier('a b')).toBe('');
    expect(normalizeInvitationIdentifier(null)).toBe('');
  });

  it('état : en attente devient échue à l’échéance, sans écriture', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(invitationState('PENDING', '2026-11-15T00:00:00Z', now)).toBe('PENDING');
    expect(invitationState('PENDING', '2026-11-14T12:00:00Z', now)).toBe('EXPIRED');
    expect(invitationState('ACCEPTED', '2026-11-01T00:00:00Z', now)).toBe('ACCEPTED');
  });
});
