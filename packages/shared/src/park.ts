/**
 * Règles du module Parc : catégories de billets, statuts, motifs de refus au contrôle d'accès,
 * horaires d'ouverture et format du QR code. Partagé entre l'API (autorité) et l'interface.
 */

export const TICKET_KINDS = ['ADULT', 'CHILD', 'FAMILY', 'GROUP', 'CUSTOM'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_KIND_LABELS: Record<TicketKind, string> = {
  ADULT: 'Adulte',
  CHILD: 'Enfant',
  FAMILY: 'Famille',
  GROUP: 'Groupe',
  CUSTOM: 'Personnalisée',
};

export const TICKET_STATUSES = ['VALID', 'USED', 'EXPIRED', 'CANCELLED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  VALID: 'Valide',
  USED: 'Utilisé',
  EXPIRED: 'Expiré',
  CANCELLED: 'Annulé',
};

export const SCAN_REFUSAL_REASONS = [
  'ALREADY_USED',
  'EXPIRED',
  'CANCELLED',
  'UNKNOWN',
  'OTHER_ESTABLISHMENT',
  'PARK_CLOSED',
  'NOT_YET_VALID',
] as const;
export type ScanRefusalReason = (typeof SCAN_REFUSAL_REASONS)[number];

export const SCAN_REFUSAL_LABELS: Record<ScanRefusalReason, string> = {
  ALREADY_USED: 'Billet déjà utilisé',
  EXPIRED: 'Billet expiré',
  CANCELLED: 'Billet annulé',
  UNKNOWN: 'Billet inconnu',
  OTHER_ESTABLISHMENT: 'Billet d’un autre établissement',
  PARK_CLOSED: 'Parc fermé ou créneau invalide',
  NOT_YET_VALID: 'Billet pas encore valable',
};

/** Limites de saisie d'une vente de billets. */
export const MAX_PEOPLE_PER_TICKET = 50;
export const MAX_VISITORS_PER_ORDER = 200;

// ─── QR code ───

/**
 * Le QR code ne contient QUE ce préfixe et un jeton aléatoire de 128 bits (base64url, 22 caractères) :
 * aucune donnée personnelle ni secret applicatif. Le serveur retrouve le billet par ce jeton.
 */
export const TICKET_QR_PREFIX = 'OCP1-';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function ticketQrPayload(token: string): string {
  return `${TICKET_QR_PREFIX}${token}`;
}

/** Extrait le jeton d'un contenu scanné ; null si le format ne correspond pas à un billet Ocall Park. */
export function parseTicketQr(scanned: string): string | null {
  const text = scanned.trim();
  if (!text.startsWith(TICKET_QR_PREFIX)) return null;
  const token = text.slice(TICKET_QR_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

// ─── Fuseaux horaires et horaires d'ouverture ───

export interface LocalMoment {
  /** Date locale AAAA-MM-JJ. */
  date: string;
  /** Jour de la semaine : 0 = dimanche … 6 = samedi. */
  weekday: number;
  /** Minutes écoulées depuis minuit, heure locale. */
  minutes: number;
}

/** Date, jour et heure locale d'un instant dans un fuseau IANA (ex. Africa/Bamako). */
export function localMoment(instant: Date, timeZone: string): LocalMoment {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays.indexOf(parts.weekday ?? 'Sun'),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Ajoute des jours à une date AAAA-MM-JJ. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Instant UTC correspondant à minuit (heure locale) de la date dans le fuseau. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  // Décalage du fuseau à cet instant : différence entre l'heure locale affichée et l'heure UTC.
  const local = localMoment(guess, timeZone);
  const localAsUtc = Date.UTC(
    Number(local.date.slice(0, 4)),
    Number(local.date.slice(5, 7)) - 1,
    Number(local.date.slice(8, 10)),
    Math.floor(local.minutes / 60),
    local.minutes % 60,
  );
  return new Date(guess.getTime() - (localAsUtc - guess.getTime()));
}

/** « HH:MM » → minutes depuis minuit ; null si invalide. */
export function parseTime(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface WeeklyOpening {
  weekday: number;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export interface CalendarException {
  date: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  label: string | null;
}

export type OpeningVerdict =
  | {
      open: true;
      source: 'NO_SCHEDULE' | 'WEEKLY' | 'EXCEPTION';
      opensAt?: string;
      closesAt?: string;
    }
  | { open: false; reason: 'CLOSED_DAY' | 'OUTSIDE_HOURS' | 'EXCEPTIONAL_CLOSURE'; label?: string };

/**
 * Le parc est-il ouvert à ce moment local ? Une exception datée (fermeture ou horaires spéciaux)
 * prime sur l'horaire hebdomadaire ; sans aucun horaire configuré, aucune restriction ne s'applique.
 */
export function evaluateOpening(
  weekly: readonly WeeklyOpening[],
  exceptions: readonly CalendarException[],
  moment: LocalMoment,
): OpeningVerdict {
  const exception = exceptions.find((e) => e.date === moment.date);
  if (exception) {
    if (exception.isClosed)
      return { open: false, reason: 'EXCEPTIONAL_CLOSURE', label: exception.label ?? undefined };
    return within(exception.opensAt, exception.closesAt, moment.minutes)
      ? {
          open: true,
          source: 'EXCEPTION',
          opensAt: exception.opensAt ?? undefined,
          closesAt: exception.closesAt ?? undefined,
        }
      : { open: false, reason: 'OUTSIDE_HOURS', label: exception.label ?? undefined };
  }
  if (weekly.length === 0) return { open: true, source: 'NO_SCHEDULE' };
  const day = weekly.find((w) => w.weekday === moment.weekday);
  if (!day || day.isClosed) return { open: false, reason: 'CLOSED_DAY' };
  return within(day.opensAt, day.closesAt, moment.minutes)
    ? {
        open: true,
        source: 'WEEKLY',
        opensAt: day.opensAt ?? undefined,
        closesAt: day.closesAt ?? undefined,
      }
    : { open: false, reason: 'OUTSIDE_HOURS' };
}

function within(opensAt: string | null, closesAt: string | null, minutes: number): boolean {
  const start = opensAt ? parseTime(opensAt) : 0;
  const end = closesAt ? parseTime(closesAt) : 24 * 60;
  if (start === null || end === null) return false;
  return minutes >= start && minutes < end;
}

/** Le parc ouvre-t-il ce jour-là (indépendamment de l'heure) ? Sert à la vente du jour. */
export function isOpenDay(
  weekly: readonly WeeklyOpening[],
  exceptions: readonly CalendarException[],
  moment: LocalMoment,
): boolean {
  const exception = exceptions.find((e) => e.date === moment.date);
  if (exception) return !exception.isClosed;
  if (weekly.length === 0) return true;
  const day = weekly.find((w) => w.weekday === moment.weekday);
  return !!day && !day.isClosed;
}

/** Répartition du prix d'une formule entre ses billets individuels (le reste va au premier billet). */
export function splitPrice(total: number, people: number): number[] {
  const base = Math.floor(total / people);
  return Array.from({ length: people }, (_, i) => (i === 0 ? total - base * (people - 1) : base));
}
