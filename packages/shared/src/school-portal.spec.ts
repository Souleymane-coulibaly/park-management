import {
  SCHOOL_SLOT_PATTERN,
  announcementVisible,
  attendanceAlerts,
  attendanceStats,
  attendanceStatsFromCounts,
  portalNotificationHref,
  smsRetryDelayMs,
  smsText,
} from './school-portal';

describe('Ocall School — portail parents, présences, notifications (règles)', () => {
  it('statistiques de présence : un retard compte comme présent, taux en points de base', () => {
    expect(attendanceStats([])).toEqual({
      sessions: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      presenceRate: null,
    });
    expect(attendanceStats(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toEqual({
      sessions: 4,
      present: 1,
      absent: 1,
      late: 1,
      excused: 1,
      presenceRate: 5000,
    });
    expect(attendanceStats(['PRESENT', 'PRESENT', 'ABSENT']).presenceRate).toBe(6666);
  });

  it('statistiques depuis un agrégat : mêmes résultats que depuis les relevés', () => {
    expect(attendanceStatsFromCounts({})).toEqual(attendanceStats([]));
    expect(attendanceStatsFromCounts({ PRESENT: 500, ABSENT: 100 })).toEqual({
      sessions: 600,
      present: 500,
      absent: 100,
      late: 0,
      excused: 0,
      presenceRate: 8333,
    });
    expect(attendanceStatsFromCounts({ PRESENT: 1, LATE: 1, ABSENT: 1, EXCUSED: 1 })).toEqual(
      attendanceStats(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']),
    );
  });

  it('seules absence et retard alertent la famille', () => {
    expect(attendanceAlerts('ABSENT')).toBe(true);
    expect(attendanceAlerts('LATE')).toBe(true);
    expect(attendanceAlerts('PRESENT')).toBe(false);
    expect(attendanceAlerts('EXCUSED')).toBe(false);
  });

  it('séance : code court en majuscules', () => {
    expect(SCHOOL_SLOT_PATTERN.test('JOURNEE')).toBe(true);
    expect(SCHOOL_SLOT_PATTERN.test('S1')).toBe(true);
    expect(SCHOOL_SLOT_PATTERN.test('matin')).toBe(false);
    expect(SCHOOL_SLOT_PATTERN.test('A'.repeat(21))).toBe(false);
  });

  it('annonce visible : publiée et non expirée à la date du jour', () => {
    expect(announcementVisible({ status: 'PUBLISHED', expiresOn: null }, '2026-11-04')).toBe(true);
    expect(
      announcementVisible({ status: 'PUBLISHED', expiresOn: '2026-11-04' }, '2026-11-04'),
    ).toBe(true);
    expect(
      announcementVisible({ status: 'PUBLISHED', expiresOn: '2026-11-03' }, '2026-11-04'),
    ).toBe(false);
    expect(announcementVisible({ status: 'DRAFT', expiresOn: null }, '2026-11-04')).toBe(false);
    expect(announcementVisible({ status: 'ARCHIVED', expiresOn: null }, '2026-11-04')).toBe(false);
  });

  it('notification : page du portail de l’enfant concerné', () => {
    expect(portalNotificationHref('ABSENCE', 'abc')).toBe('/parents/enfants/abc/presences');
    expect(portalNotificationHref('REPORT_CARD', 'abc')).toBe('/parents/enfants/abc/bulletins');
    expect(portalNotificationHref('CHARGE_OVERDUE', 'abc')).toBe('/parents/enfants/abc/finances');
    expect(portalNotificationHref('ANNOUNCEMENT', null)).toBe('/parents/annonces');
  });

  it('SMS : nouvelle tentative après un délai croissant, plafonné à une heure', () => {
    expect(smsRetryDelayMs(1)).toBe(60_000);
    expect(smsRetryDelayMs(2)).toBe(120_000);
    expect(smsRetryDelayMs(4)).toBe(480_000);
    expect(smsRetryDelayMs(20)).toBe(3_600_000);
  });

  it('SMS : court, sans note, montant ni motif ; arabe pour un établissement en Arabe', () => {
    const fr = smsText('ABSENCE', 'FR', {
      school: 'École Les Palmiers',
      firstName: 'Awa',
      date: '04/11',
    });
    expect(fr).toBe('École Les Palmiers : absence de Awa 04/11. Détails sur le portail parents.');
    expect(fr.length).toBeLessThanOrEqual(160);
    const ar = smsText('LATE', 'AR', { school: 'مدرسة النخيل', firstName: 'عوا' });
    expect(ar).toContain('مدرسة النخيل');
    expect(ar).not.toContain('portail');
    const bilingual = smsText('REPORT_CARD', 'BILINGUAL', { school: 'École', firstName: 'Awa' });
    expect(bilingual).toContain('bulletin de Awa');
    expect(smsText('INVITATION', 'FR', { school: 'École', url: 'https://x.test/a' })).toContain(
      'https://x.test/a',
    );
  });
});
