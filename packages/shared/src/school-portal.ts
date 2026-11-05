/**
 * Ocall School, Sprint 6 : portail parents, présences, annonces, notifications et SMS. Règles pures,
 * partagées par l'API et l'interface.
 */

import type { SchoolLocale } from './school';

// ─── Comptes parents ───

/** Durée de validité d'une invitation au portail parents. */
export const SCHOOL_INVITATION_TTL_DAYS = 7;

// ─── Présences ───

export const SCHOOL_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type SchoolAttendanceStatus = (typeof SCHOOL_ATTENDANCE_STATUSES)[number];

/** Séance unique de la journée quand l'établissement ne fait qu'un appel par jour. */
export const SCHOOL_DEFAULT_SLOT = 'JOURNEE';
/** Séance : code court en majuscules (« MATIN », « S1 », « 08H00 »…). */
export const SCHOOL_SLOT_PATTERN = /^[A-Z0-9_-]{1,20}$/;
/** Relevés acceptés par enregistrement : l'écran envoie une grande classe en lots successifs. */
export const SCHOOL_ATTENDANCE_BATCH = 200;
/** Annonces par page : liste du personnel, portail parents. */
export const SCHOOL_ANNOUNCEMENTS_PAGE = 200;
export const SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE = 50;

export const SCHOOL_JUSTIFICATION_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type SchoolJustificationStatus = (typeof SCHOOL_JUSTIFICATION_STATUSES)[number];

/** Une absence ou un retard alertent la famille ; présent et absence justifiée, non. */
export function attendanceAlerts(status: SchoolAttendanceStatus): boolean {
  return status === 'ABSENT' || status === 'LATE';
}

export interface AttendanceStats {
  sessions: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Taux de présence en points de base (présent ou en retard, sur les séances relevées). */
  presenceRate: number | null;
}

/** Statistiques d'un ensemble de relevés : un retard compte comme une présence. */
export function attendanceStats(statuses: readonly SchoolAttendanceStatus[]): AttendanceStats {
  const counts: Partial<Record<SchoolAttendanceStatus, number>> = {};
  for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
  return attendanceStatsFromCounts(counts);
}

/** Mêmes statistiques à partir du nombre de relevés par statut (agrégat calculé par la base). */
export function attendanceStatsFromCounts(
  counts: Partial<Record<SchoolAttendanceStatus, number>>,
): AttendanceStats {
  const present = counts.PRESENT ?? 0;
  const late = counts.LATE ?? 0;
  const absent = counts.ABSENT ?? 0;
  const excused = counts.EXCUSED ?? 0;
  const sessions = present + late + absent + excused;
  return {
    sessions,
    present,
    absent,
    late,
    excused,
    presenceRate: sessions === 0 ? null : Math.floor(((present + late) * 10_000) / sessions),
  };
}

// ─── Annonces ───

export const SCHOOL_ANNOUNCEMENT_AUDIENCES = ['SCHOOL', 'CLASS', 'STUDENTS', 'GUARDIANS'] as const;
export type SchoolAnnouncementAudience = (typeof SCHOOL_ANNOUNCEMENT_AUDIENCES)[number];
export const SCHOOL_ANNOUNCEMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type SchoolAnnouncementStatus = (typeof SCHOOL_ANNOUNCEMENT_STATUSES)[number];

/** Annonce visible des familles : publiée, non archivée, non expirée à la date du jour. */
export function announcementVisible(
  a: { status: SchoolAnnouncementStatus; expiresOn: string | null },
  today: string,
): boolean {
  return a.status === 'PUBLISHED' && (a.expiresOn === null || a.expiresOn.slice(0, 10) >= today);
}

// ─── Notifications ───

export const SCHOOL_NOTIFICATION_KINDS = [
  'ANNOUNCEMENT',
  'ABSENCE',
  'LATE',
  'REPORT_CARD',
  'CHARGE_DUE',
  'CHARGE_OVERDUE',
] as const;
export type SchoolNotificationKind = (typeof SCHOOL_NOTIFICATION_KINDS)[number];

/** Page du portail où mène une notification (la ressource reste contrôlée par l'API). */
export function portalNotificationHref(
  kind: SchoolNotificationKind,
  studentId: string | null,
): string {
  const child = studentId ? `/parents/enfants/${studentId}` : '/parents';
  switch (kind) {
    case 'ANNOUNCEMENT':
      return '/parents/annonces';
    case 'ABSENCE':
    case 'LATE':
      return `${child}/presences`;
    case 'REPORT_CARD':
      return `${child}/bulletins`;
    case 'CHARGE_DUE':
    case 'CHARGE_OVERDUE':
      return `${child}/finances`;
  }
}

// ─── SMS ───

export const SCHOOL_SMS_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type SchoolSmsStatus = (typeof SCHOOL_SMS_STATUSES)[number];
/** Tentatives au plus, avant l'échec définitif. */
export const SCHOOL_SMS_MAX_ATTEMPTS = 5;

/** Délai avant une nouvelle tentative : 1, 2, 4, 8 minutes… plafonné à une heure. */
export function smsRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export type SchoolSmsKind = 'INVITATION' | 'ABSENCE' | 'LATE' | 'REPORT_CARD' | 'CHARGE_OVERDUE';

/**
 * Texte d'un SMS : court, sans donnée sensible (ni note, ni montant, ni motif) ; le prénom de l'élève et
 * une date au plus, le détail reste sur le portail. Arabe pour un établissement en Arabe.
 */
export function smsText(
  kind: SchoolSmsKind,
  locale: SchoolLocale,
  params: { school: string; firstName?: string; date?: string; url?: string },
): string {
  const ar = locale === 'AR';
  const who = params.firstName ?? '';
  const when = params.date ? ` ${params.date}` : '';
  switch (kind) {
    case 'INVITATION':
      return ar
        ? `${params.school}: دعوة إلى بوابة الأولياء ${params.url ?? ''}`.trim()
        : `${params.school} : activez votre accès au portail parents ${params.url ?? ''}`.trim();
    case 'ABSENCE':
      return ar
        ? `${params.school}: غياب ${who}${when}. التفاصيل في بوابة الأولياء.`
        : `${params.school} : absence de ${who}${when}. Détails sur le portail parents.`;
    case 'LATE':
      return ar
        ? `${params.school}: تأخر ${who}${when}. التفاصيل في بوابة الأولياء.`
        : `${params.school} : retard de ${who}${when}. Détails sur le portail parents.`;
    case 'REPORT_CARD':
      return ar
        ? `${params.school}: نشر كشف نقاط ${who}. اطلع عليه في بوابة الأولياء.`
        : `${params.school} : bulletin de ${who} publié. Consultez le portail parents.`;
    case 'CHARGE_OVERDUE':
      return ar
        ? `${params.school}: قسط متأخر لـ ${who}. التفاصيل في بوابة الأولياء.`
        : `${params.school} : échéance impayée pour ${who}. Détails sur le portail parents.`;
  }
}
