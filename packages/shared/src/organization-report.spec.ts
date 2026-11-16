import { resolveAnalyticsPeriod } from './analytics';
import { formatMoneyLabel, orgReportChange, orgReportDays } from './organization-report';
import { formatXof } from './subscription';

describe('Ocall Suite étape 5 — tableau de bord de l’organisation (règles partagées)', () => {
  it('jours entiers d’une période, dans le fuseau de l’organisation', () => {
    // 23 h 30 UTC le 14/11 : déjà le 15/11 à Kiritimati (UTC+14), encore le 14/11 à Bamako.
    const now = new Date('2026-11-14T23:30:00Z');
    const kiritimati = resolveAnalyticsPeriod({ period: 'today' }, now, 'Pacific/Kiritimati');
    const bamako = resolveAnalyticsPeriod({ period: 'today' }, now, 'Africa/Bamako');
    if ('error' in kiritimati || 'error' in bamako) throw new Error('période');
    expect(orgReportDays(kiritimati.current)).toEqual({ from: '2026-11-15', to: '2026-11-15' });
    expect(orgReportDays(bamako.current)).toEqual({ from: '2026-11-14', to: '2026-11-14' });
    const month = resolveAnalyticsPeriod({ period: 'this_month' }, now, 'Africa/Bamako');
    if ('error' in month) throw new Error('période');
    expect(orgReportDays(month.current)).toEqual({ from: '2026-11-01', to: '2026-11-14' });
  });

  it('« Aujourd’hui » comparé à hier jusqu’à la même heure : pas de jour entier, pas de comparaison au jour', () => {
    const now = new Date('2026-11-14T15:00:00Z');
    const today = resolveAnalyticsPeriod({ period: 'today' }, now, 'Africa/Bamako');
    if ('error' in today) throw new Error('période');
    expect(orgReportDays(today.previous)).toBeNull();
    const week = resolveAnalyticsPeriod({ period: 'last_7_days' }, now, 'Africa/Bamako');
    if ('error' in week) throw new Error('période');
    expect(orgReportDays(week.previous)).toEqual({ from: '2026-11-01', to: '2026-11-07' });
  });

  it('montants lisibles par devise, variation sans base nulle', () => {
    // Même écriture que le reste de l'application (formatXof) ; une autre devise en code ISO.
    expect(formatMoneyLabel(12_500, 'XOF')).toBe(formatXof(12_500));
    expect(formatMoneyLabel(12_500, 'EUR')).toBe(formatXof(12_500).replace('FCFA', 'EUR'));
    expect(orgReportChange({ value: 150, previous: 100 })).toBe(50);
    expect(orgReportChange({ value: 150, previous: 0 })).toBeNull();
    expect(orgReportChange({ value: 150, previous: null })).toBeNull();
  });
});
