/**
 * Événements du parc : billets datés vendus par séance, distincts des pass. Règles partagées entre
 * l'API (vente, émission, contrôle d'accès) et l'interface (guichet, gestion, suivi).
 */
import { addDays, parseTime, zonedMidnight } from './park';

export const PARK_EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ParkEventStatus = (typeof PARK_EVENT_STATUSES)[number];

export const PARK_EVENT_STATUS_LABELS: Record<ParkEventStatus, string> = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};

export const PARK_EVENT_SESSION_STATUSES = ['SCHEDULED', 'CANCELLED'] as const;
export type ParkEventSessionStatus = (typeof PARK_EVENT_SESSION_STATUSES)[number];

export const PARK_EVENT_SESSION_STATUS_LABELS: Record<ParkEventSessionStatus, string> = {
  SCHEDULED: 'Programmée',
  CANCELLED: 'Annulée',
};

export const PARK_EVENT_LIMITS = {
  name: 80,
  description: 1000,
  conditions: 300,
  /** Places d'une séance (billets individuels). */
  maxCapacity: 100_000,
  /** Tolérance d'entrée avant le début ou après la fin, en minutes (12 h). */
  maxToleranceMinutes: 720,
  /** Séances d'un événement. */
  maxSessions: 200,
  /** Une séance se programme au plus deux ans à l'avance. */
  maxDaysAhead: 730,
} as const;

/**
 * Début et fin d'une séance (instants UTC) à partir de sa date et de ses horaires locaux. Une fin
 * antérieure ou égale au début désigne le lendemain (séance de nuit, ex. 22:00 → 02:00).
 */
export function sessionInstants(
  date: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (start === null || end === null) throw new Error('Horaire invalide (HH:MM attendu).');
  const startsAt = new Date(zonedMidnight(date, timeZone).getTime() + start * 60_000);
  const endDay = end <= start ? addDays(date, 1) : date;
  const endsAt = new Date(zonedMidnight(endDay, timeZone).getTime() + end * 60_000);
  return { startsAt, endsAt };
}

/**
 * Validité d'un billet d'événement : de N minutes avant le début de la séance à N minutes après sa
 * fin. Le contrôle d'accès s'appuie sur ces bornes (refus « pas encore valable » ou « expiré »),
 * sans tenir compte des horaires d'ouverture du parc.
 */
export function eventTicketWindow(
  session: { startsAt: Date; endsAt: Date },
  entryOpensBeforeMinutes: number,
  entryClosesAfterMinutes: number,
): { validFrom: Date; validUntil: Date } {
  return {
    validFrom: new Date(session.startsAt.getTime() - entryOpensBeforeMinutes * 60_000),
    validUntil: new Date(session.endsAt.getTime() + entryClosesAfterMinutes * 60_000),
  };
}

/** Places restantes (jamais négatives). */
export function placesLeft(capacity: number, sold: number): number {
  return Math.max(0, capacity - sold);
}

/** Libellé court d'une séance : « 24/12/2026 · 20:00 – 23:30 ». */
export function sessionLabel(session: {
  date: string;
  startTime: string;
  endTime: string;
}): string {
  const [y, m, d] = session.date.split('-');
  return `${d}/${m}/${y} · ${session.startTime} – ${session.endTime}`;
}
