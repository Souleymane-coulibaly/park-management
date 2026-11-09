import {
  SUITE_NOTIFICATION_KINDS,
  parseReminderOffsets,
  reminderDedupeKey,
  reminderStage,
  suiteNotificationText,
} from './suite-notifications';

const DAY = 86_400_000;
const end = new Date('2026-12-15T00:00:00.000Z');
const at = (daysBefore: number, extraMs = 0) =>
  new Date(end.getTime() - daysBefore * DAY + extraMs);

describe('Rappels d’échéance Ocall Suite (Sprint S2)', () => {
  it('J-7, J-3, J-1 : seuil le plus proche franchi', () => {
    expect(reminderStage(end, at(8))).toBeNull();
    expect(reminderStage(end, at(7))).toEqual({ kind: 'ENDING', offset: 7, daysLeft: 7 });
    expect(reminderStage(end, at(5))).toEqual({ kind: 'ENDING', offset: 7, daysLeft: 5 });
    expect(reminderStage(end, at(3))).toEqual({ kind: 'ENDING', offset: 3, daysLeft: 3 });
    expect(reminderStage(end, at(2))).toEqual({ kind: 'ENDING', offset: 3, daysLeft: 2 });
    expect(reminderStage(end, at(1))).toEqual({ kind: 'ENDING', offset: 1, daysLeft: 1 });
    expect(reminderStage(end, at(0, -1))).toEqual({ kind: 'ENDING', offset: 1, daysLeft: 1 });
  });

  it('jour J : échéance atteinte, notifiée seulement dans la fenêtre de 7 jours', () => {
    expect(reminderStage(end, end)).toEqual({ kind: 'EXPIRED' });
    expect(reminderStage(end, at(-7))).toEqual({ kind: 'EXPIRED' });
    expect(reminderStage(end, at(-7, 1))).toBeNull();
  });

  it('reprise après une interruption : jamais de rafale des seuils manqués', () => {
    // Traitement arrêté de J-8 à J-2 : seul le seuil J-3 est dû, pas J-7.
    expect(reminderStage(end, at(2))).toMatchObject({ offset: 3 });
  });

  it('clé de déduplication : seuil et échéance ; un renouvellement réarme les rappels', () => {
    const stage = reminderStage(end, at(3))!;
    expect(reminderDedupeKey('sub', 'abc', end, stage)).toBe(
      'sub:abc:2026-12-15T00:00:00.000Z:J-3',
    );
    expect(reminderDedupeKey('trial', 'abc', end, { kind: 'EXPIRED' })).toBe(
      'trial:abc:2026-12-15T00:00:00.000Z:J0',
    );
    const renewed = new Date(end.getTime() + 30 * DAY);
    expect(reminderDedupeKey('sub', 'abc', renewed, stage)).not.toBe(
      reminderDedupeKey('sub', 'abc', end, stage),
    );
  });

  it('politique configurable : valeurs valides triées, sinon politique par défaut', () => {
    expect(parseReminderOffsets(undefined)).toEqual([7, 3, 1]);
    expect(parseReminderOffsets('1, 14,3')).toEqual([14, 3, 1]);
    expect(parseReminderOffsets('3,3')).toEqual([3]);
    expect(parseReminderOffsets('0,3')).toEqual([7, 3, 1]);
    expect(parseReminderOffsets('abc')).toEqual([7, 3, 1]);
    expect(reminderStage(end, at(10), [14, 3])).toMatchObject({ offset: 14 });
  });

  it('chaque notification a un titre et un texte, sans paramètre manquant affiché', () => {
    for (const kind of SUITE_NOTIFICATION_KINDS) {
      const t = suiteNotificationText(kind, {
        productName: 'Ocall School',
        endsAt: end.toISOString(),
        daysLeft: 3,
        requestKind: 'RENEWAL',
        credits: 500,
        schoolName: 'École Test',
      });
      expect(t.title.length).toBeGreaterThan(5);
      expect(`${t.title} ${t.body}`).not.toMatch(/undefined|null|NaN/);
    }
    expect(suiteNotificationText('TRIAL_ENDING', { daysLeft: 1 }).title).toContain('1 jour');
    expect(
      suiteNotificationText('SUBSCRIPTION_EXPIRED', { endsAt: end.toISOString() }).body,
    ).toContain('15/12/2026');
  });
});
