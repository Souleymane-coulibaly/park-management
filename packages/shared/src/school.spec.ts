import {
  DEFAULT_SCHOOL_GRADING_RULES,
  assignableSchoolRoles,
  canTransitionSchoolYear,
  hasAllSchoolsScope,
  hasSchoolPermission,
  isValidDateRange,
  periodsOverlap,
  validateGradingRules,
} from './school';
import { BUSINESS_TYPES, activitiesOf } from './business';
import { MEMBER_ROLES, ROLE_PERMISSIONS, assignableRoles, isRoleAvailableFor } from './rbac';
import { bestContract, canTransitionContract, contractAccess } from './suite-contracts';

const window = (status: Parameters<typeof contractAccess>[0]['status']) => ({
  status,
  startsOn: '2026-09-01',
  endsOn: '2027-06-30',
});
const during = new Date('2027-01-15T12:00:00Z');

describe('contrats Ocall Suite', () => {
  it('brouillon : aucun accès', () => {
    expect(contractAccess(window('DRAFT'), during)).toBe('none');
  });

  it('actif pendant sa durée : accès complet, dernier jour inclus', () => {
    expect(contractAccess(window('ACTIVE'), during)).toBe('full');
    expect(contractAccess(window('ACTIVE'), new Date('2027-06-30T23:59:00Z'))).toBe('full');
  });

  it('actif avant son début : aucun accès', () => {
    expect(contractAccess(window('ACTIVE'), new Date('2026-08-31T00:00:00Z'))).toBe('none');
  });

  it('date de fin dépassée : lecture seule, sans attendre un traitement planifié', () => {
    expect(contractAccess(window('ACTIVE'), new Date('2027-07-01T00:00:00Z'))).toBe('read_only');
  });

  it.each(['SUSPENDED', 'EXPIRED', 'TERMINATED'] as const)('%s : lecture seule', (status) => {
    expect(contractAccess(window(status), during)).toBe('read_only');
  });

  it('plusieurs contrats : le plus large l’emporte', () => {
    const best = bestContract([window('SUSPENDED'), window('ACTIVE'), window('DRAFT')], during);
    expect(best?.access).toBe('full');
    expect(best?.contract.status).toBe('ACTIVE');
    expect(bestContract([], during)).toBeNull();
  });

  it('transitions : une résiliation est définitive', () => {
    expect(canTransitionContract('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransitionContract('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionContract('EXPIRED', 'ACTIVE')).toBe(false);
    expect(canTransitionContract('TERMINATED', 'ACTIVE')).toBe(false);
  });
});

describe('séparation entre Ocall Park et Ocall School', () => {
  it('PRODUCT_USER n’a aucune permission Park et n’est pas attribuable', () => {
    expect(ROLE_PERMISSIONS.PRODUCT_USER).toEqual([]);
    expect(MEMBER_ROLES).not.toContain('PRODUCT_USER');
    expect(assignableRoles('OWNER')).not.toContain('PRODUCT_USER');
    expect(isRoleAvailableFor('PRODUCT_USER', 'PARK')).toBe(false);
  });

  it('NONE ne couvre aucune activité et n’est pas proposé à l’inscription', () => {
    expect(activitiesOf('NONE')).toEqual([]);
    expect(BUSINESS_TYPES).not.toContain('NONE');
  });
});

describe('rôles Ocall School', () => {
  it('seule la direction du groupe voit tout et crée des établissements', () => {
    expect(hasAllSchoolsScope('GROUP_DIRECTOR')).toBe(true);
    expect(hasAllSchoolsScope('SCHOOL_DIRECTOR')).toBe(false);
    expect(hasSchoolPermission('GROUP_DIRECTOR', 'school.schools.manage')).toBe(true);
    expect(hasSchoolPermission('SCHOOL_DIRECTOR', 'school.schools.manage')).toBe(false);
  });

  it('un enseignant consulte la structure sans la modifier', () => {
    expect(hasSchoolPermission('TEACHER', 'school.structure.read')).toBe(true);
    expect(hasSchoolPermission('TEACHER', 'school.structure.manage')).toBe(false);
    expect(hasSchoolPermission('TEACHER', 'school.export')).toBe(false);
  });

  it('un directeur n’attribue pas de poste de direction', () => {
    expect(assignableSchoolRoles('SCHOOL_DIRECTOR')).not.toContain('GROUP_DIRECTOR');
    expect(assignableSchoolRoles('SCHOOL_DIRECTOR')).not.toContain('SCHOOL_DIRECTOR');
    expect(assignableSchoolRoles('TEACHER')).toEqual([]);
  });
});

describe('années et règles de notation', () => {
  it('une année clôturée reste figée', () => {
    expect(canTransitionSchoolYear('PLANNED', 'ACTIVE')).toBe(true);
    expect(canTransitionSchoolYear('ACTIVE', 'CLOSED')).toBe(true);
    expect(canTransitionSchoolYear('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransitionSchoolYear('PLANNED', 'CLOSED')).toBe(false);
  });

  it('dates et chevauchement', () => {
    expect(isValidDateRange('2026-09-01', '2027-06-30')).toBe(true);
    expect(isValidDateRange('2027-06-30', '2026-09-01')).toBe(false);
    const t1 = { startsOn: '2026-09-01', endsOn: '2026-12-20' };
    expect(periodsOverlap(t1, { startsOn: '2026-12-20', endsOn: '2027-03-01' })).toBe(true);
    expect(periodsOverlap(t1, { startsOn: '2026-12-21', endsOn: '2027-03-01' })).toBe(false);
  });

  it('règles de notation', () => {
    expect(validateGradingRules(DEFAULT_SCHOOL_GRADING_RULES)).toEqual([]);
    const bad = { ...DEFAULT_SCHOOL_GRADING_RULES, scale: 20, passMark: 25, decimals: 9 };
    expect(validateGradingRules(bad)).toHaveLength(2);
  });
});
