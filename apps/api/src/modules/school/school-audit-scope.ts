/**
 * Rattachement des entrées du journal d'audit School à leur établissement (contrats multiples) : pour
 * chaque type de cible journalisé, le modèle de la base School et le filtre qui le relie à un ensemble
 * d'établissements de l'organisation. Un type absent de cette table n'est pas rattachable : ses entrées
 * n'apparaissent que pour un périmètre complet. `school-audit-scope.spec.ts` vérifie que tout type
 * journalisé par le module y figure (ou est déclaré non rattachable).
 */
export interface AuditSchoolFilter {
  organizationId: string;
  schoolId: { in: string[] };
}

interface AuditTargetScope {
  /** Délégué Prisma de la base School. */
  model: string;
  /** Filtre « cible appartenant à l'un de ces établissements de l'organisation ». */
  where: (s: AuditSchoolFilter) => object;
}

const direct = (model: string): AuditTargetScope => ({ model, where: (s) => s });
const via = (model: string, relation: (s: AuditSchoolFilter) => object): AuditTargetScope => ({
  model,
  where: (s) => ({ organizationId: s.organizationId, ...relation(s) }),
});

export const AUDIT_TARGET_SCOPES: Readonly<Record<string, AuditTargetScope>> = {
  School: { model: 'school', where: (s) => ({ organizationId: s.organizationId, id: s.schoolId }) },
  Cycle: direct('cycle'),
  GradingPolicyVersion: direct('gradingPolicyVersion'),
  PedagogicalTrack: direct('pedagogicalTrack'),
  SchoolAiDocument: direct('schoolAiDocument'),
  SchoolAnnouncement: direct('schoolAnnouncement'),
  SchoolAttendanceSession: direct('schoolAttendanceSession'),
  SchoolCalendarEvent: direct('schoolCalendarEvent'),
  SchoolCharge: direct('schoolCharge'),
  SchoolEnrollment: direct('schoolEnrollment'),
  SchoolEvaluation: direct('schoolEvaluation'),
  SchoolExamSchedule: direct('schoolExamSchedule'),
  SchoolFee: direct('schoolFee'),
  SchoolGuardian: direct('schoolGuardian'),
  SchoolImportJob: direct('schoolImportJob'),
  SchoolPayment: direct('schoolPayment'),
  SchoolRoom: direct('schoolRoom'),
  SchoolSite: direct('schoolSite'),
  // Sprint S2 : demandes de recharge SMS, propres à un établissement.
  SchoolSmsTopUpRequest: direct('schoolSmsTopUpRequest'),
  SchoolStudent: direct('schoolStudent'),
  SchoolTimetable: direct('schoolTimetable'),
  SchoolYear: direct('schoolYear'),
  Subject: direct('subject'),
  Level: via('level', (s) => ({ cycle: s })),
  AcademicPeriod: via('academicPeriod', (s) => ({ year: s })),
  SchoolClass: via('schoolClass', (s) => ({ year: s })),
  SchoolClassGroup: via('schoolClassGroup', (s) => ({ class: { year: s } })),
  SchoolStudentDocument: via('schoolStudentDocument', (s) => ({ student: s })),
  SchoolSiteLink: via('schoolSiteLink', (s) => ({ site: s })),
  SchoolSiteMedia: via('schoolSiteMedia', (s) => ({ site: s })),
  SchoolSiteNews: via('schoolSiteNews', (s) => ({ site: s })),
};

/**
 * Types journalisés volontairement NON rattachables : un membre du personnel ou un compte utilisateur
 * peut relever de plusieurs établissements. Sprint S2 : le tarif SMS et les corrections de portefeuille
 * sont des actions Ocall, journalisées sans organisation (jamais dans le journal d'un client ; le
 * portefeuille a pour clé l'établissement, sans identifiant propre).
 */
export const UNSCOPED_AUDIT_TARGETS: readonly string[] = [
  'SchoolMember',
  'User',
  'SchoolSmsTariff',
  'SchoolSmsWallet',
];
