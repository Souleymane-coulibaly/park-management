import { addDays } from './park';

/**
 * Ocall School, Sprint 7 : emplois du temps, salles, calendrier scolaire et examens. Règles pures,
 * partagées par l'API (contrôle) et les écrans (affichage) : heures, chevauchements, conflits, fermetures.
 */

// ─── Heures ───

/** Jours de la semaine ISO : 1 = lundi … 7 = dimanche (les établissements choisissent leurs jours). */
export const SCHOOL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type SchoolWeekday = (typeof SCHOOL_WEEKDAYS)[number];

/** Heure « HH:MM » sur 24 heures. */
export const SCHOOL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** « 08:30 » → 510 minutes depuis minuit. */
export function timeToMinutes(time: string): number {
  if (!SCHOOL_TIME_PATTERN.test(time)) throw new RangeError(`Heure invalide : ${time}`);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 510 → « 08:30 » (1440 accepté pour une fin à minuit). */
export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new RangeError(`Minutes invalides : ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Deux plages [début, fin[ se chevauchent ; des plages contiguës (08:00-09:00, 09:00-10:00) non. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Deux périodes de dates AAAA-MM-JJ incluses [début, fin] se chevauchent. */
export function datesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Jour ISO (1 = lundi) d'une date AAAA-MM-JJ, indépendant du fuseau. */
export function isoWeekday(date: string): SchoolWeekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as SchoolWeekday;
}

/** Le jour ISO a-t-il au moins une date dans la période [from, to] (incluse) ? */
export function weekdayOccurs(weekday: number, from: string, to: string): boolean {
  if (to < from) return false;
  return addDays(from, (weekday - isoWeekday(from) + 7) % 7) <= to;
}

/** Lundi de la semaine d'une date AAAA-MM-JJ. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

// ─── Emplois du temps ───

export const SCHOOL_TIMETABLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type SchoolTimetableStatus = (typeof SCHOOL_TIMETABLE_STATUSES)[number];

/** Cours (matière et enseignant) ou pause (récréation, déjeuner), sans matière ni enseignant. */
export const SCHOOL_SLOT_KINDS = ['LESSON', 'BREAK'] as const;
export type SchoolSlotKind = (typeof SCHOOL_SLOT_KINDS)[number];

/** Créneau d'une semaine type, tel que les contrôles de conflit le comparent. */
export interface PlanningSlot {
  id?: string;
  timetableId: string;
  classId: string;
  /** Groupe de la classe : deux groupes différents peuvent avoir cours en même temps. */
  groupId: string | null;
  kind: SchoolSlotKind;
  weekday: number;
  start: number;
  end: number;
  memberId: string | null;
  roomId: string | null;
  /** Validité de la version (AAAA-MM-JJ incluses). */
  validFrom: string;
  validTo: string;
}

export const SCHOOL_CONFLICT_CODES = [
  'SLOT_CLASS_OVERLAP',
  'SLOT_TEACHER_CONFLICT',
  'SLOT_ROOM_CONFLICT',
  'SLOT_TEACHER_UNAVAILABLE',
] as const;
export type SchoolConflictCode = (typeof SCHOOL_CONFLICT_CODES)[number];

export interface PlanningConflict {
  code: SchoolConflictCode;
  /** Créneau existant en conflit (absent pour une indisponibilité). */
  slotId?: string;
  classId?: string;
  weekday: number;
  start: number;
  end: number;
}

export interface Unavailability {
  memberId: string;
  weekday: number;
  start: number;
  end: number;
}

/**
 * Conflits d'un créneau candidat avec des créneaux existants et des indisponibilités : même jour, plages
 * qui se chevauchent, versions dont les validités se recouvrent. Une pause n'occupe ni enseignant ni
 * salle ; dans la même classe, elle n'est en conflit qu'avec un autre créneau de la même version.
 */
export function slotConflicts(
  candidate: PlanningSlot,
  others: readonly PlanningSlot[],
  unavailable: readonly Unavailability[] = [],
): PlanningConflict[] {
  // Créneau sans aucune occurrence dans sa propre validité : il ne peut rien occuper.
  if (!weekdayOccurs(candidate.weekday, candidate.validFrom, candidate.validTo)) return [];
  const conflicts: PlanningConflict[] = [];
  for (const other of others) {
    if (other.id && other.id === candidate.id) continue;
    if (other.weekday !== candidate.weekday) continue;
    if (!rangesOverlap(candidate.start, candidate.end, other.start, other.end)) continue;
    // Une occurrence commune : le jour doit exister dans l'intersection des validités.
    const from = candidate.validFrom > other.validFrom ? candidate.validFrom : other.validFrom;
    const to = candidate.validTo < other.validTo ? candidate.validTo : other.validTo;
    if (!weekdayOccurs(candidate.weekday, from, to)) continue;
    const at = { slotId: other.id, classId: other.classId, weekday: other.weekday };
    const range = { start: other.start, end: other.end };
    if (other.classId === candidate.classId) {
      // Même classe : deux versions différentes ne coexistent jamais une fois publiées (remplacement).
      if (other.timetableId !== candidate.timetableId) continue;
      const distinctGroups =
        candidate.kind === 'LESSON' &&
        other.kind === 'LESSON' &&
        candidate.groupId !== null &&
        other.groupId !== null &&
        candidate.groupId !== other.groupId;
      if (!distinctGroups) conflicts.push({ code: 'SLOT_CLASS_OVERLAP', ...at, ...range });
      else if (sameResource(candidate.memberId, other.memberId)) {
        conflicts.push({ code: 'SLOT_TEACHER_CONFLICT', ...at, ...range });
      } else if (sameResource(candidate.roomId, other.roomId)) {
        conflicts.push({ code: 'SLOT_ROOM_CONFLICT', ...at, ...range });
      }
      continue;
    }
    if (candidate.kind !== 'LESSON' || other.kind !== 'LESSON') continue;
    if (sameResource(candidate.memberId, other.memberId)) {
      conflicts.push({ code: 'SLOT_TEACHER_CONFLICT', ...at, ...range });
    } else if (sameResource(candidate.roomId, other.roomId)) {
      conflicts.push({ code: 'SLOT_ROOM_CONFLICT', ...at, ...range });
    }
  }
  if (candidate.kind === 'LESSON' && candidate.memberId) {
    for (const u of unavailable) {
      if (
        u.memberId === candidate.memberId &&
        u.weekday === candidate.weekday &&
        rangesOverlap(candidate.start, candidate.end, u.start, u.end)
      ) {
        conflicts.push({
          code: 'SLOT_TEACHER_UNAVAILABLE',
          weekday: u.weekday,
          start: u.start,
          end: u.end,
        });
      }
    }
  }
  return conflicts;
}

function sameResource(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

// ─── Calendrier ───

export const SCHOOL_EVENT_CATEGORIES = [
  'HOLIDAY',
  'PUBLIC_HOLIDAY',
  'PEDAGOGICAL_DAY',
  'EXAM_SESSION',
  'PARENT_MEETING',
  'FIELD_TRIP',
  'SCHOOL_EVENT',
] as const;
export type SchoolEventCategory = (typeof SCHOOL_EVENT_CATEGORIES)[number];

/** Vacances, jours fériés et journées pédagogiques suspendent les cours (et refusent un examen). */
export const SCHOOL_CLOSURE_CATEGORIES: readonly SchoolEventCategory[] = [
  'HOLIDAY',
  'PUBLIC_HOLIDAY',
  'PEDAGOGICAL_DAY',
];

export function isClosure(category: SchoolEventCategory): boolean {
  return SCHOOL_CLOSURE_CATEGORIES.includes(category);
}

/** Public d'un événement : tout l'établissement, des classes ou des groupes de classe. */
export const SCHOOL_EVENT_AUDIENCES = ['SCHOOL', 'CLASSES', 'GROUPS'] as const;
export type SchoolEventAudience = (typeof SCHOOL_EVENT_AUDIENCES)[number];

/** Visibilité : personnel seulement, ou personnel et familles (portail parents). */
export const SCHOOL_EVENT_VISIBILITIES = ['STAFF', 'FAMILIES'] as const;
export type SchoolEventVisibility = (typeof SCHOOL_EVENT_VISIBILITIES)[number];

export const SCHOOL_PLANNING_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export type SchoolPlanningStatus = (typeof SCHOOL_PLANNING_STATUSES)[number];

/**
 * Une fermeture s'applique-t-elle à ce cours, cet examen ou cet enfant ? Elle doit être de son
 * établissement ; fermeture de tout l'établissement : oui ; de classes : la sienne ; de groupes : l'un des
 * siens seulement (un cours de toute la classe n'est pas suspendu par la fermeture d'un seul groupe).
 */
export function closureApplies(
  event: {
    schoolId: string;
    audience: SchoolEventAudience;
    classIds: readonly string[];
    groupIds: readonly string[];
  },
  target: { schoolId: string; classId: string; groupIds: readonly string[] },
): boolean {
  if (event.schoolId !== target.schoolId) return false;
  if (event.audience === 'SCHOOL') return true;
  if (event.audience === 'CLASSES') return event.classIds.includes(target.classId);
  return event.groupIds.some((g) => target.groupIds.includes(g));
}

// ─── Examens ───

/** Durée d'un examen : 5 minutes à 8 heures. */
export const SCHOOL_EXAM_MIN_MINUTES = 5;
export const SCHOOL_EXAM_MAX_MINUTES = 480;
