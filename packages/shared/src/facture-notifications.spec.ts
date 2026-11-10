import {
  factureNotificationRetryDelayMs,
  factureReminderTimes,
  formatFactureAppointment,
  renderFactureAppointmentMessage,
} from './facture-notifications';

const HOUR = 3_600_000;

describe('Ocall Facture — notifications de rendez-vous (F4)', () => {
  const start = new Date('2026-11-12T08:00:00Z');

  it('rappels : la veille et quelques heures avant ; jamais dans le passé ; pas de doublon proche', () => {
    const now = new Date('2026-11-10T08:00:00Z');
    expect(
      factureReminderTimes(start, { reminderDayBefore: true, reminderHoursBefore: 2 }, now),
    ).toEqual([
      { key: 'J-1', at: new Date('2026-11-11T08:00:00Z') },
      { key: 'H-2', at: new Date('2026-11-12T06:00:00Z') },
    ]);
    // Rendez-vous dans 10 heures : le rappel de la veille est déjà passé.
    expect(
      factureReminderTimes(
        start,
        { reminderDayBefore: true, reminderHoursBefore: 2 },
        new Date(start.getTime() - 10 * HOUR),
      ).map((r) => r.key),
    ).toEqual(['H-2']);
    expect(
      factureReminderTimes(start, { reminderDayBefore: false, reminderHoursBefore: null }, now),
    ).toEqual([]);
    // 12 h avant et la veille sont distincts ; aucun rappel en double.
    expect(
      factureReminderTimes(start, { reminderDayBefore: true, reminderHoursBefore: 12 }, now).map(
        (r) => r.key,
      ),
    ).toEqual(['J-1', 'H-12']);
  });

  it('textes : date en heure du Mali, lieu, référence, téléphone de l’entreprise', () => {
    expect(formatFactureAppointment(start)).toBe('jeudi 12 novembre à 08:00');
    const m = {
      business: 'Froid Services',
      businessPhone: '+223 20 22 00 00',
      recipientName: 'Awa Traoré',
      reference: 'INT-2026-00001',
      title: 'Climatiseur en panne',
      appointmentAt: start,
      place: 'ACI 2000, Bamako',
    };
    expect(renderFactureAppointmentMessage('CONFIRMATION', m)).toBe(
      'Bonjour Awa Traoré, Froid Services confirme votre rendez-vous « Climatiseur en panne » le jeudi 12 novembre à 08:00 (ACI 2000, Bamako). Réf. INT-2026-00001. Pour toute question : +223 20 22 00 00.',
    );
    expect(renderFactureAppointmentMessage('RESCHEDULED', m)).toContain('est reporté au jeudi');
    expect(renderFactureAppointmentMessage('REMINDER', m)).toContain('rappel : Froid Services');
    expect(renderFactureAppointmentMessage('CANCELLATION', { ...m, place: null })).toContain(
      'du jeudi 12 novembre à 08:00 avec Froid Services est annulé',
    );
  });

  it('nouvelles tentatives : délai croissant, borné', () => {
    expect([1, 2, 3, 9].map(factureNotificationRetryDelayMs)).toEqual([
      60_000, 300_000, 900_000, 900_000,
    ]);
  });
});
