/**
 * Dates calendaires d'un établissement (Sprint 5) : un jour ou un mois s'entend dans son fuseau, comme
 * sur ses reçus. Un fuseau invalide retombe sur UTC.
 */

/** Heure murale d'un instant dans un fuseau, exprimée comme un instant UTC. */
function wallClock(at: number, timezone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(at))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  } catch {
    return at;
  }
}

const MINUTE = 60_000;
/** Écart maximal entre un fuseau et UTC (UTC−12 à UTC+14), avec une marge. */
const WINDOW = 15 * 60 * MINUTE;

/** Date locale `AAAA-MM-JJ` d'un instant. */
function localDay(at: number, timezone: string): string {
  return new Date(wallClock(at, timezone)).toISOString().slice(0, 10);
}

/**
 * Premier instant d'un jour `AAAA-MM-JJ` dans un fuseau : minuit local, ou l'heure qui le remplace quand
 * un changement d'heure supprime minuit (passage de 00:00 à 01:00). La date locale ne fait que croître
 * avec le temps : recherche dichotomique, à la minute, de l'instant où elle atteint ce jour.
 */
export function zonedDayStart(day: string, timezone: string): Date {
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  // localDay(lo) précède le jour, localDay(hi) l'atteint.
  let lo = midnight - WINDOW;
  let hi = midnight + WINDOW;
  while (hi - lo > MINUTE) {
    const mid = lo + Math.floor((hi - lo) / (2 * MINUTE)) * MINUTE;
    if (localDay(mid, timezone) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** Plage d'instants couvrant les jours `from` à `to` inclus, dans un fuseau ; `undefined` sans borne. */
export function zonedDayRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const next = to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000) : null;
  return {
    ...(from ? { gte: zonedDayStart(from, timezone) } : {}),
    ...(next ? { lt: zonedDayStart(next.toISOString().slice(0, 10), timezone) } : {}),
  };
}

/** Mois `AAAA-MM` d'un instant dans un fuseau. */
export function zonedMonth(at: Date, timezone: string): string {
  const wall = new Date(wallClock(at.getTime(), timezone));
  return wall.toISOString().slice(0, 7);
}
