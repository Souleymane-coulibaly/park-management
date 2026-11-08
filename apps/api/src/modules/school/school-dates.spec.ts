import { zonedDayRange, zonedDayStart, zonedMonth } from './school-dates';

describe('Ocall School — dates dans le fuseau de l’établissement', () => {
  it('début de journée locale, y compris aux changements d’heure', () => {
    expect(zonedDayStart('2026-11-04', 'Africa/Dakar').toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    );
    expect(zonedDayStart('2026-11-04', 'Africa/Lagos').toISOString()).toBe(
      '2026-11-03T23:00:00.000Z',
    );
    expect(zonedDayStart('2026-07-01', 'Europe/Paris').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
    // Passage à l'heure d'été (29 mars 2026) et retour à l'heure d'hiver (25 octobre 2026).
    expect(zonedDayStart('2026-03-29', 'Europe/Paris').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(zonedDayStart('2026-10-25', 'Europe/Paris').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    );
    // Minuit inexistant : à La Havane, le 8 mars 2026 passe de 00:00 à 01:00 (UTC−5 → UTC−4).
    expect(zonedDayStart('2026-03-08', 'America/Havana').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(zonedDayStart('2026-03-09', 'America/Havana').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    // UTC+14 et UTC−11 : bornes de l'écart possible.
    expect(zonedDayStart('2026-11-04', 'Pacific/Kiritimati').toISOString()).toBe(
      '2026-11-03T10:00:00.000Z',
    );
    expect(zonedDayStart('2026-11-04', 'Pacific/Pago_Pago').toISOString()).toBe(
      '2026-11-04T11:00:00.000Z',
    );
    expect(zonedDayStart('2026-11-04', 'Fuseau/Invalide').toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    );
  });

  it('plage de jours inclusive ; un paiement de 23 h 30 UTC appartient au lendemain local', () => {
    const range = zonedDayRange('2026-11-04', '2026-11-04', 'Africa/Lagos')!;
    const late = new Date('2026-11-03T23:30:00.000Z');
    expect(late >= range.gte! && late < range.lt!).toBe(true);
    expect(range.lt!.toISOString()).toBe('2026-11-04T23:00:00.000Z');
    expect(zonedDayRange(undefined, undefined, 'Africa/Lagos')).toBeUndefined();
    expect(zonedDayRange('2026-11-01', undefined, 'Africa/Dakar')).toEqual({
      gte: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('mois local d’un instant', () => {
    expect(zonedMonth(new Date('2026-11-30T23:30:00.000Z'), 'Africa/Lagos')).toBe('2026-12');
    expect(zonedMonth(new Date('2026-11-30T23:30:00.000Z'), 'Africa/Dakar')).toBe('2026-11');
  });
});
