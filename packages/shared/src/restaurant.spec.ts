import {
  type PreparationStatus,
  decidePreparationTransition,
  hasPermission,
  isStockLow,
  isValidStockQuantity,
  layoutKitchenTicket,
  navigationFor,
  previewLines,
  roundStock,
  slotsOverlap,
} from './index';

describe('cycle de préparation', () => {
  it('seul l’envoi explicite fait quitter « non envoyée »', () => {
    expect(decidePreparationTransition('NOT_SENT', 'send')).toEqual({ kind: 'apply', to: 'SENT' });
    expect(decidePreparationTransition('NOT_SENT', 'start')).toEqual({
      kind: 'refuse',
      code: 'ORDER_NOT_SENT',
    });
    expect(decidePreparationTransition('NOT_SENT', 'ready')).toEqual({
      kind: 'refuse',
      code: 'ORDER_NOT_SENT',
    });
    expect(decidePreparationTransition('NOT_SENT', 'serve')).toEqual({
      kind: 'refuse',
      code: 'ORDER_NOT_SENT',
    });
  });

  it('enchaîne envoyée → en préparation → prête → servie, « prête » directe autorisée', () => {
    expect(decidePreparationTransition('SENT', 'start')).toEqual({
      kind: 'apply',
      to: 'IN_PREPARATION',
    });
    expect(decidePreparationTransition('SENT', 'ready')).toEqual({ kind: 'apply', to: 'READY' });
    expect(decidePreparationTransition('IN_PREPARATION', 'ready')).toEqual({
      kind: 'apply',
      to: 'READY',
    });
    expect(decidePreparationTransition('READY', 'serve')).toEqual({ kind: 'apply', to: 'SERVED' });
    expect(decidePreparationTransition('IN_PREPARATION', 'serve')).toEqual({
      kind: 'refuse',
      code: 'ORDER_NOT_READY',
    });
  });

  it('une action rejouée ou dépassée ne modifie rien (idempotence, pas de retour en arrière)', () => {
    const cases: [PreparationStatus, Parameters<typeof decidePreparationTransition>[1]][] = [
      ['SENT', 'send'],
      ['READY', 'send'],
      ['IN_PREPARATION', 'start'],
      ['READY', 'start'],
      ['READY', 'ready'],
      ['SERVED', 'ready'],
      ['SERVED', 'serve'],
    ];
    for (const [from, action] of cases) {
      expect(decidePreparationTransition(from, action)).toEqual({ kind: 'noop' });
    }
  });
});

describe('ticket cuisine', () => {
  const lines = layoutKitchenTicket(
    {
      establishmentName: 'Restaurant du Lac',
      timezone: 'Africa/Bamako',
      saleNumber: 42,
      channelLabel: 'Sur place',
      location: 'Terrasse · Table 4',
      sentAt: '2026-10-30T12:05:00.000Z',
      notes: 'Allergie arachide',
      lines: [
        { productName: 'Poulet braisé', variantName: 'Grand', quantity: 2, notes: 'Bien cuit' },
        { productName: 'Jus de bissap', variantName: 'Standard', quantity: 1, notes: null },
      ],
      duplicate: false,
    },
    80,
  );
  const text = previewLines(lines, 80).join('\n');

  it('contient numéro, articles, quantités, variantes, instructions, table et heure', () => {
    expect(text).toContain('N° 000042');
    expect(text).toContain('2 x Poulet braisé');
    expect(text).toContain('Grand');
    expect(text).toContain('>> Bien cuit');
    expect(text).toContain('Allergie arachide');
    expect(text).toContain('Terrasse · Table 4');
    expect(text).toContain('30/10/2026 12:05');
  });

  it('n’affiche aucun prix', () => {
    expect(text).not.toMatch(/FCFA|\d+\s?\d{3}\s?F|total/i);
  });
});

describe('stocks', () => {
  it('arrondit à 3 décimales et valide les quantités', () => {
    expect(roundStock(0.1 + 0.2)).toBe(0.3);
    expect(isValidStockQuantity(1.25)).toBe(true);
    expect(isValidStockQuantity(0.0001)).toBe(false);
    expect(isValidStockQuantity(Number.NaN)).toBe(false);
  });

  it('alerte au seuil ou en dessous, jamais sans seuil', () => {
    expect(isStockLow(5, 5)).toBe(true);
    expect(isStockLow(5.001, 5)).toBe(false);
    expect(isStockLow(-2, 0)).toBe(true);
    expect(isStockLow(0, null)).toBe(false);
  });
});

describe('réservations', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
  it('détecte un chevauchement ; des créneaux bout à bout ne sont pas en conflit', () => {
    expect(slotsOverlap(at(12), at(13, 30), at(13), at(14))).toBe(true);
    expect(slotsOverlap(at(12), at(13), at(13), at(14))).toBe(false);
    expect(slotsOverlap(at(12), at(15), at(13), at(14))).toBe(true);
  });
});

describe('droits du module restaurant', () => {
  it('la cuisine voit et fait avancer la préparation, sans encaisser ni envoyer', () => {
    expect(hasPermission('KITCHEN', 'kitchen.view')).toBe(true);
    expect(hasPermission('KITCHEN', 'kitchen.update')).toBe(true);
    expect(hasPermission('KITCHEN', 'pos.sell')).toBe(false);
    expect(hasPermission('KITCHEN', 'order.send_kitchen')).toBe(false);
  });

  it('le caissier envoie en cuisine mais ne configure ni tables ni stocks', () => {
    expect(hasPermission('CASHIER', 'order.send_kitchen')).toBe(true);
    expect(hasPermission('CASHIER', 'kitchen.update')).toBe(false);
    expect(hasPermission('CASHIER', 'tables.manage')).toBe(false);
    expect(hasPermission('CASHIER', 'stock.read')).toBe(false);
  });

  it('un établissement parc seul ne voit aucun module restaurant', () => {
    const keys = navigationFor('PARK', 'OWNER').map((m) => m.key);
    for (const k of ['orders', 'kitchen', 'stock', 'reservations', 'tables']) {
      expect(keys).not.toContain(k);
    }
  });
});
