import {
  eventTicketWindow,
  layoutTickets,
  placesLeft,
  previewLines,
  sessionInstants,
  sessionLabel,
  ticketQrPayload,
} from './index';

describe('événements du parc', () => {
  it('séance du jour : horaires locaux convertis dans le fuseau du parc', () => {
    const { startsAt, endsAt } = sessionInstants('2026-12-24', '20:00', '23:30', 'Africa/Bamako');
    expect(startsAt.toISOString()).toBe('2026-12-24T20:00:00.000Z');
    expect(endsAt.toISOString()).toBe('2026-12-24T23:30:00.000Z');
    const paris = sessionInstants('2026-07-14', '21:00', '23:00', 'Europe/Paris');
    expect(paris.startsAt.toISOString()).toBe('2026-07-14T19:00:00.000Z');
  });

  it('séance de nuit : une fin antérieure ou égale au début désigne le lendemain', () => {
    const night = sessionInstants('2026-12-31', '22:00', '02:00', 'Africa/Bamako');
    expect(night.endsAt.toISOString()).toBe('2027-01-01T02:00:00.000Z');
    const full = sessionInstants('2026-12-31', '10:00', '10:00', 'Africa/Bamako');
    expect(full.endsAt.getTime() - full.startsAt.getTime()).toBe(24 * 3600_000);
    expect(() => sessionInstants('2026-12-31', '25:00', '02:00', 'Africa/Bamako')).toThrow();
  });

  it('validité du billet : tolérance d’entrée avant le début et après la fin', () => {
    const session = sessionInstants('2026-12-24', '20:00', '23:30', 'Africa/Bamako');
    const w = eventTicketWindow(session, 60, 15);
    expect(w.validFrom.toISOString()).toBe('2026-12-24T19:00:00.000Z');
    expect(w.validUntil.toISOString()).toBe('2026-12-24T23:45:00.000Z');
    const strict = eventTicketWindow(session, 0, 0);
    expect(strict.validFrom).toEqual(session.startsAt);
    expect(strict.validUntil).toEqual(session.endsAt);
  });

  it('places restantes et libellé de séance', () => {
    expect(placesLeft(100, 40)).toBe(60);
    expect(placesLeft(100, 120)).toBe(0);
    expect(sessionLabel({ date: '2026-12-24', startTime: '20:00', endTime: '23:30' })).toBe(
      '24/12/2026 · 20:00 – 23:30',
    );
  });

  it('billet imprimé : événement et séance, sans ligne de prénom pour un billet non nominatif', () => {
    const lines = layoutTickets(
      {
        organizationName: 'Aqua Splash',
        establishmentName: 'Bamako',
        timezone: 'Africa/Bamako',
        saleNumber: 12,
        duplicate: false,
        tickets: [
          {
            id: '00000001-aaaa-bbbb-cccc-dddddddddddd',
            visitorName: '',
            categoryName: 'Standard',
            pricePaid: 5000,
            validFrom: '2026-12-24T19:00:00Z',
            validUntil: '2026-12-24T23:30:00Z',
            qr: ticketQrPayload('AbCdEfGhIjKlMnOpQrStUv'),
            event: { name: 'Concert de Noël', session: '24/12/2026 · 20:00 – 23:30' },
          },
        ],
      },
      58,
    );
    const text = previewLines(lines, 58).join('\n');
    expect(text).toContain('BILLET ÉVÉNEMENT');
    expect(text).toContain('Concert de Noël');
    expect(text.replace(/\s+/g, ' ')).toContain('Séance du 24/12/2026 · 20:00 - 23:30');
    expect(previewLines(lines, 58).every((l) => l.length <= 32)).toBe(true);
    expect(text).not.toContain('Valable le');
    expect(lines.some((l) => l.text === '')).toBe(false);
    expect(lines.filter((l) => l.qr)).toHaveLength(1);
  });
});
