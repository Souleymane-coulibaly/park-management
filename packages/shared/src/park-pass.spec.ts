import {
  type PassRules,
  addMonthsLocal,
  parseAccessQr,
  passPhotoRequired,
  passQrWindow,
  passRefusal,
  passState,
  periodEndDate,
  renewalStartDate,
  suspensionExtensionDays,
  weekdayOf,
} from './park-pass';
import { localMoment } from './park';

const rules = (over: Partial<PassRules> = {}): PassRules => ({
  offerName: 'Pass',
  totalEntries: null,
  dailyEntries: 1,
  allowedWeekdays: [],
  qrMode: 'STATIC',
  siteIds: ['p1', 'p2'],
  durationUnit: 'DAYS',
  durationValue: 7,
  maxSuspensionDays: 30,
  suspensionExtends: true,
  renewable: false,
  timezone: 'Africa/Abidjan',
  ...over,
});
const period = (startDate: string, endDate: string, entriesUsed = 0) => ({
  id: 'per',
  startDate,
  endDate,
  entriesUsed,
});
const check = (over: Partial<Parameters<typeof passRefusal>[0]> = {}) =>
  passRefusal({
    status: 'ACTIVE',
    rules: rules(),
    establishmentId: 'p1',
    today: '2026-11-18',
    periods: [period('2026-11-16', '2026-11-22')],
    entriesToday: 0,
    ...over,
  }).reason;

describe('Ocall Parc sprint 8 — règles des pass', () => {
  it('périodes : jours consécutifs ou mois calendaires (fin de mois et années bissextiles)', () => {
    expect(periodEndDate('2026-11-16', 'DAYS', 7)).toBe('2026-11-22');
    expect(periodEndDate('2026-11-16', 'DAYS', 1)).toBe('2026-11-16');
    expect(periodEndDate('2026-11-16', 'MONTHS', 1)).toBe('2026-12-15');
    expect(periodEndDate('2026-01-31', 'MONTHS', 1)).toBe('2026-02-27');
    expect(addMonthsLocal('2028-01-31', 1)).toBe('2028-02-29');
    expect(periodEndDate('2026-11-16', 'MONTHS', 12)).toBe('2027-11-15');
    expect(addMonthsLocal('2026-12-15', 1)).toBe('2027-01-15');
    expect(weekdayOf('2026-11-16')).toBe(1);
  });

  it('renouvellement : à l’échéance précédente, ou au jour du paiement si expiré ; sans chevauchement', () => {
    expect(renewalStartDate('2026-12-15', '2026-12-10')).toBe('2026-12-16');
    expect(renewalStartDate('2026-12-15', '2026-12-15')).toBe('2026-12-16');
    expect(renewalStartDate('2026-12-15', '2026-12-20')).toBe('2026-12-20');
  });

  it('suspension : jours entiers, plafonnés par l’offre, rien si l’offre ne reporte pas', () => {
    const r = { maxSuspensionDays: 10, suspensionExtends: true };
    expect(suspensionExtensionDays('2026-11-01', '2026-11-05', r)).toBe(4);
    expect(suspensionExtensionDays('2026-11-01', '2026-12-01', r)).toBe(10);
    expect(
      suspensionExtensionDays('2026-11-01', '2026-11-05', { ...r, suspensionExtends: false }),
    ).toBe(0);
    expect(suspensionExtensionDays('2026-11-05', '2026-11-05', r)).toBe(0);
  });

  it('photo obligatoire pour un abonnement mensuel ou annuel', () => {
    expect(passPhotoRequired('MONTHLY', false)).toBe(true);
    expect(passPhotoRequired('ANNUAL', false)).toBe(true);
    expect(passPhotoRequired('DAY', false)).toBe(false);
    expect(passPhotoRequired('WEEK', true)).toBe(true);
  });

  it('refus dans l’ordre : parc, annulé, suspendu, en attente, dates, jour, quota du jour, quota total', () => {
    expect(check()).toBeNull();
    expect(check({ establishmentId: 'p3' })).toBe('OTHER_ESTABLISHMENT');
    expect(check({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(check({ status: 'SUSPENDED' })).toBe('SUSPENDED');
    expect(check({ status: 'PENDING' })).toBe('NOT_YET_VALID');
    expect(check({ today: '2026-11-15' })).toBe('NOT_YET_VALID');
    expect(check({ today: '2026-11-23' })).toBe('EXPIRED');
    // Premier et dernier jour de la période inclus.
    expect(check({ today: '2026-11-16' })).toBeNull();
    expect(check({ today: '2026-11-22' })).toBeNull();
    expect(check({ rules: rules({ allowedWeekdays: [0, 6] }) })).toBe('DAY_NOT_ALLOWED');
    expect(check({ entriesToday: 1 })).toBe('DAILY_QUOTA_REACHED');
    expect(check({ rules: rules({ dailyEntries: 2 }), entriesToday: 1 })).toBeNull();
    expect(check({ rules: rules({ dailyEntries: null }), entriesToday: 9 })).toBeNull();
    expect(
      check({
        rules: rules({ totalEntries: 3 }),
        periods: [period('2026-11-16', '2026-11-22', 3)],
      }),
    ).toBe('QUOTA_REACHED');
    expect(
      check({
        rules: rules({ totalEntries: 3 }),
        periods: [period('2026-11-16', '2026-11-22', 2)],
      }),
    ).toBeNull();
    // Périodes successives : seule celle du jour compte (quota remis à zéro au renouvellement).
    expect(
      check({
        rules: rules({ totalEntries: 3 }),
        today: '2026-11-23',
        periods: [period('2026-11-16', '2026-11-22', 3), period('2026-11-23', '2026-11-29', 0)],
      }),
    ).toBeNull();
  });

  it('état présenté', () => {
    expect(passState('ACTIVE', '2026-11-16', '2026-11-22', '2026-11-23')).toBe('EXPIRED');
    expect(passState('ACTIVE', '2026-11-16', '2026-11-22', '2026-11-15')).toBe('UPCOMING');
    expect(passState('ACTIVE', '2026-11-16', '2026-11-22', '2026-11-16')).toBe('ACTIVE');
    expect(passState('SUSPENDED', '2026-11-16', '2026-11-22', '2026-11-18')).toBe('SUSPENDED');
  });

  it('QR : formats reconnus, fenêtres de 30 s, tout autre contenu rejeté', () => {
    const id = 'AbCdEfGhIjKlMnOp';
    const sig = 'A'.repeat(22);
    expect(parseAccessQr(`OCPS-${id}.${sig}`)).toEqual({
      type: 'pass_static',
      publicId: id,
      signature: sig,
    });
    expect(parseAccessQr(` OCPD-${id}.59000000.${sig} `)).toEqual({
      type: 'pass_dynamic',
      publicId: id,
      window: 59000000,
      signature: sig,
    });
    expect(parseAccessQr(`OCPC-${id}.${sig}`)).toEqual({
      type: 'card',
      cardNumber: id,
      signature: sig,
    });
    expect(parseAccessQr(`OCPS-${id}`)).toBeNull();
    // Contenu exact uniquement : rien avant ni après le QR signé.
    expect(parseAccessQr(`xOCPS-${id}.${sig}`)).toBeNull();
    expect(parseAccessQr(`OCPS-${id}.${sig}x`)).toBeNull();
    expect(parseAccessQr(`OCPC-${id}.${sig}.${sig}`)).toBeNull();
    expect(parseAccessQr(`OCPD-${id}.x.${sig}`)).toBeNull();
    expect(parseAccessQr(`OCP1-${'a'.repeat(22)}`)).toBeNull();
    expect(passQrWindow(60_000)).toBe(2);
    expect(passQrWindow(89_999)).toBe(2);
  });

  it('heure d’été : le jour du parc change à minuit local, avant et après chaque changement d’heure', () => {
    // Europe/Paris passe à UTC+2 le 29 mars 2026 et revient à UTC+1 le 25 octobre 2026.
    expect(localMoment(new Date('2026-03-28T22:59:00Z'), 'Europe/Paris').date).toBe('2026-03-28');
    expect(localMoment(new Date('2026-03-28T23:00:00Z'), 'Europe/Paris').date).toBe('2026-03-29');
    expect(localMoment(new Date('2026-03-29T21:59:00Z'), 'Europe/Paris').date).toBe('2026-03-29');
    expect(localMoment(new Date('2026-03-29T22:00:00Z'), 'Europe/Paris').date).toBe('2026-03-30');
    expect(localMoment(new Date('2026-10-24T21:59:00Z'), 'Europe/Paris').date).toBe('2026-10-24');
    expect(localMoment(new Date('2026-10-24T22:00:00Z'), 'Europe/Paris').date).toBe('2026-10-25');
    expect(localMoment(new Date('2026-10-25T22:59:00Z'), 'Europe/Paris').date).toBe('2026-10-25');
    expect(localMoment(new Date('2026-10-25T23:00:00Z'), 'Europe/Paris').date).toBe('2026-10-26');
    // Heure qui n'existe pas / heure jouée deux fois : la minute locale reste cohérente.
    expect(localMoment(new Date('2026-03-29T01:00:00Z'), 'Europe/Paris').minutes).toBe(3 * 60);
    expect(localMoment(new Date('2026-10-25T00:30:00Z'), 'Europe/Paris').minutes).toBe(2 * 60 + 30);
    expect(localMoment(new Date('2026-10-25T01:30:00Z'), 'Europe/Paris').minutes).toBe(2 * 60 + 30);
    // Hémisphère sud (Santiago) et pays sans heure d'été (Abidjan).
    expect(localMoment(new Date('2026-04-05T03:30:00Z'), 'America/Santiago').date).toBe(
      '2026-04-04',
    );
    expect(localMoment(new Date('2026-07-01T23:59:00Z'), 'Africa/Abidjan').date).toBe('2026-07-01');
    // Une durée en jours ne dépend pas du changement d'heure : 7 jours restent 7 dates.
    expect(periodEndDate('2026-03-25', 'DAYS', 7)).toBe('2026-03-31');
    expect(periodEndDate('2026-10-22', 'DAYS', 7)).toBe('2026-10-28');
    expect(weekdayOf('2026-03-29')).toBe(0);
  });
});
