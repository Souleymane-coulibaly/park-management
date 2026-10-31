import { localMoment, zonedMidnight } from '@ocall/shared';
import { PLATFORM_TIMEZONE } from '../../common/platform-counter';

export { PLATFORM_TIMEZONE };
const DAY_MS = 86_400_000;

/**
 * Période d'un rapport de la plateforme (dates AAAA-MM-JJ incluses) ; par défaut, le mois civil
 * en cours jusqu'à aujourd'hui.
 */
export function platformPeriod(filters: { from?: string; to?: string }, now = new Date()) {
  const today = localMoment(now, PLATFORM_TIMEZONE).date;
  const from = filters.from ?? `${today.slice(0, 8)}01`;
  const to = filters.to ?? today;
  return {
    from,
    to,
    range: {
      gte: zonedMidnight(from, PLATFORM_TIMEZONE),
      lt: new Date(zonedMidnight(to, PLATFORM_TIMEZONE).getTime() + DAY_MS),
    },
    monthStart: zonedMidnight(`${today.slice(0, 8)}01`, PLATFORM_TIMEZONE),
  };
}
