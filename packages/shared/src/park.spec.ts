import {
  type CalendarException,
  type WeeklyOpening,
  addDays,
  containsDrawerKick,
  encodeReceiptLines,
  evaluateOpening,
  hasPermission,
  isOpenDay,
  layoutTickets,
  localMoment,
  navigationFor,
  parseTicketQr,
  previewLines,
  qrCode,
  splitPrice,
  ticketQrPayload,
  zonedMidnight,
} from './index';

const WEEKLY: WeeklyOpening[] = [
  { weekday: 1, isClosed: true, opensAt: null, closesAt: null }, // lundi fermé
  ...[0, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '18:00',
  })),
];

describe('QR code des billets', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUv';

  it('ne contient que le préfixe et le jeton', () => {
    expect(ticketQrPayload(token)).toBe('OCP1-AbCdEfGhIjKlMnOpQrStUv');
    expect(parseTicketQr(' OCP1-AbCdEfGhIjKlMnOpQrStUv ')).toBe(token);
  });

  it.each([
    '',
    'OCP1-',
    'OCP1-court',
    'XYZ-AbCdEfGhIjKlMnOpQrStUv',
    'OCP1-AbCdEfGhIjKlMnOpQrSt!v',
    'https://exemple.com',
  ])('refuse un contenu falsifié ou étranger : « %s »', (scanned) => {
    expect(parseTicketQr(scanned)).toBeNull();
  });

  it('encode la commande ESC/POS de QR (GS ( k) sans séquence de tiroir', () => {
    const bytes = qrCode(ticketQrPayload(token));
    expect(bytes.slice(0, 3)).toEqual([0x1d, 0x28, 0x6b]);
    expect(containsDrawerKick(Uint8Array.from(bytes))).toBe(false);
    expect(() => qrCode('é')).toThrow(RangeError);
  });
});

describe('fuseaux et horaires', () => {
  it('calcule la date et l’heure locales', () => {
    expect(localMoment(new Date('2026-10-29T23:30:00Z'), 'Africa/Bamako')).toEqual({
      date: '2026-10-29',
      weekday: 4,
      minutes: 23 * 60 + 30,
    });
    // Niamey est à UTC+1 : 23h30 UTC = 00h30 le lendemain.
    expect(localMoment(new Date('2026-10-29T23:30:00Z'), 'Africa/Niamey').date).toBe('2026-10-30');
  });

  it('minuit local en UTC', () => {
    expect(zonedMidnight('2026-10-30', 'Africa/Bamako').toISOString()).toBe(
      '2026-10-30T00:00:00.000Z',
    );
    expect(zonedMidnight('2026-10-30', 'Africa/Niamey').toISOString()).toBe(
      '2026-10-29T23:00:00.000Z',
    );
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('sans horaire configuré : aucune restriction', () => {
    expect(evaluateOpening([], [], { date: '2026-10-26', weekday: 1, minutes: 3 * 60 })).toEqual({
      open: true,
      source: 'NO_SCHEDULE',
    });
  });

  it('horaire hebdomadaire : jour fermé, avant / pendant / après les heures', () => {
    expect(evaluateOpening(WEEKLY, [], { date: '2026-10-26', weekday: 1, minutes: 600 })).toEqual({
      open: false,
      reason: 'CLOSED_DAY',
    });
    expect(
      evaluateOpening(WEEKLY, [], { date: '2026-10-27', weekday: 2, minutes: 8 * 60 + 59 }),
    ).toMatchObject({ open: false, reason: 'OUTSIDE_HOURS' });
    expect(
      evaluateOpening(WEEKLY, [], { date: '2026-10-27', weekday: 2, minutes: 9 * 60 }),
    ).toMatchObject({ open: true, source: 'WEEKLY' });
    expect(
      evaluateOpening(WEEKLY, [], { date: '2026-10-27', weekday: 2, minutes: 18 * 60 }),
    ).toMatchObject({ open: false, reason: 'OUTSIDE_HOURS' });
  });

  it('les exceptions priment : fermeture exceptionnelle et horaires spéciaux', () => {
    const exceptions: CalendarException[] = [
      { date: '2026-10-27', isClosed: true, opensAt: null, closesAt: null, label: 'Maintenance' },
      {
        date: '2026-10-26',
        isClosed: false,
        opensAt: '14:00',
        closesAt: '22:00',
        label: 'Nocturne',
      },
    ];
    expect(
      evaluateOpening(WEEKLY, exceptions, { date: '2026-10-27', weekday: 2, minutes: 600 }),
    ).toEqual({ open: false, reason: 'EXCEPTIONAL_CLOSURE', label: 'Maintenance' });
    // Lundi habituellement fermé, ouvert en nocturne.
    expect(
      evaluateOpening(WEEKLY, exceptions, { date: '2026-10-26', weekday: 1, minutes: 20 * 60 }),
    ).toMatchObject({ open: true, source: 'EXCEPTION' });
    expect(isOpenDay(WEEKLY, exceptions, { date: '2026-10-26', weekday: 1, minutes: 0 })).toBe(
      true,
    );
    expect(isOpenDay(WEEKLY, exceptions, { date: '2026-10-27', weekday: 2, minutes: 0 })).toBe(
      false,
    );
  });
});

describe('billets', () => {
  it('répartit le prix d’une formule sans perte de centime', () => {
    expect(splitPrice(10_000, 5)).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(splitPrice(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitPrice(10_000, 3).reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('un billet imprimé par visiteur, chacun avec son QR et une coupe', () => {
    const lines = layoutTickets(
      {
        organizationName: 'Aqua Splash',
        establishmentName: 'Bamako',
        timezone: 'Africa/Bamako',
        saleNumber: 7,
        duplicate: false,
        tickets: ['Awa', 'Moussa'].map((visitorName, i) => ({
          id: `0000000${i}-aaaa-bbbb-cccc-dddddddddddd`,
          visitorName,
          categoryName: 'Famille',
          pricePaid: 2000,
          validFrom: '2026-10-29T00:00:00Z',
          validUntil: '2026-10-29T23:59:59Z',
          qr: ticketQrPayload('AbCdEfGhIjKlMnOpQrStUv'),
        })),
      },
      58,
    );
    expect(lines.filter((l) => l.qr)).toHaveLength(2);
    expect(lines.filter((l) => l.cut)).toHaveLength(2);
    const preview = previewLines(lines, 58);
    expect(preview.every((l) => l.length <= 32)).toBe(true);
    expect(preview.join('\n')).toContain('Valable le 29/10/2026');
    const bytes = encodeReceiptLines(lines);
    expect(containsDrawerKick(bytes)).toBe(false);
  });

  it('permissions et navigation du parc', () => {
    expect(hasPermission('GATE_AGENT', 'access.scan')).toBe(true);
    expect(hasPermission('GATE_AGENT', 'pos.sell')).toBe(false);
    expect(hasPermission('CASHIER', 'access.scan')).toBe(false);
    expect(hasPermission('CASHIER', 'ticketing.manage')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'ticket.cancel')).toBe(true);
    const agentNav = navigationFor('PARK', 'GATE_AGENT').map((m) => m.key);
    expect(agentNav).toContain('gate-control');
    expect(agentNav).not.toContain('ticketing');
    expect(agentNav).not.toContain('employees');
    expect(navigationFor('PARK', 'CASHIER').find((m) => m.key === 'ticketing')).toMatchObject({
      status: 'available',
      href: '/app/billetterie',
    });
    expect(navigationFor('RESTAURANT', 'OWNER').some((m) => m.key === 'ticketing')).toBe(false);
  });
});
