import {
  type ReceiptData,
  charsPerLine,
  columns,
  containsDrawerKick,
  encodePc858,
  encodeReceiptLines,
  fromBase64,
  layoutReceipt,
  layoutTestPage,
  previewLines,
  toBase64,
  validateHardwareCommand,
  validatePrinterAddress,
  wrap,
} from './index';
import { hasPermission } from '../rbac';

const SALE: ReceiptData = {
  organizationName: 'Chez Fanta',
  establishmentName: 'Bamako — ACI 2000',
  saleNumber: 42,
  date: '2026-10-29T12:30:00Z',
  timezone: 'Africa/Bamako',
  cashierName: 'Moussa Diarra',
  lines: [
    {
      productName: 'Jus de bissap',
      variantName: 'Grand',
      quantity: 2,
      unitPrice: 1000,
      lineTotal: 2000,
    },
    {
      productName: 'Brochettes de mouton grillées au feu de bois',
      variantName: 'Portion',
      quantity: 1,
      unitPrice: 2500,
      lineTotal: 2500,
    },
  ],
  total: 4500,
  payment: { method: 'CASH', amount: 4500, amountTendered: 5000, changeGiven: 500 },
  duplicate: false,
};

describe('encodage ESC/POS', () => {
  it('largeur : 32 caractères en 58 mm, 48 en 80 mm', () => {
    expect(charsPerLine(58)).toBe(32);
    expect(charsPerLine(80)).toBe(48);
  });

  it('encode les accents français en PC858 et remplace les caractères inconnus', () => {
    expect(encodePc858('éèàç€')).toEqual([0x82, 0x8a, 0x85, 0x87, 0xd5]);
    expect(encodePc858('2 500')).toEqual([0x32, 0x20, 0x35, 0x30, 0x30]);
    expect(encodePc858('漢')).toEqual([0x3f]);
  });

  it('commence par l’initialisation et la page de code, finit par la coupe', () => {
    const bytes = encodeReceiptLines([{ text: 'Bonjour' }]);
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  it('un ticket ne contient jamais la commande d’ouverture du tiroir', () => {
    for (const width of [58, 80] as const) {
      expect(containsDrawerKick(encodeReceiptLines(layoutReceipt(SALE, width)))).toBe(false);
    }
    expect(containsDrawerKick(Uint8Array.from([0x1b, 0x70, 0x00, 0x19, 0xfa]))).toBe(true);
    expect(containsDrawerKick(Uint8Array.from([0x10, 0x14, 0x01]))).toBe(true);
  });

  it('base64 aller-retour sans dépendance', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 0x1b, 0x40]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(Uint8Array.from([0x66, 0x6f]))).toBe('Zm8=');
    expect(() => fromBase64('@@@')).toThrow();
  });
});

describe('mise en page du ticket', () => {
  it.each([58, 80] as const)('aucune ligne ne dépasse la largeur du papier (%i mm)', (width) => {
    const lines = layoutReceipt(SALE, width);
    for (const line of previewLines(lines, width))
      expect(line.length).toBeLessThanOrEqual(charsPerLine(width));
  });

  it('contient numéro, total, montant remis et monnaie rendue', () => {
    const text = previewLines(layoutReceipt(SALE, 80), 80).join('\n');
    expect(text).toContain('Ticket n° 000042');
    expect(text).toMatch(/TOTAL\s+4\s500 FCFA/);
    expect(text).toMatch(/Monnaie rendue\s+500 FCFA/);
    expect(text).toContain('29/10/2026 12:30');
  });

  it('une réimpression porte la mention DUPLICATA', () => {
    expect(layoutReceipt({ ...SALE, duplicate: true }, 58)[0]).toMatchObject({
      text: '*** DUPLICATA ***',
    });
    expect(layoutReceipt(SALE, 58)[0]?.text).not.toContain('DUPLICATA');
  });

  it('page de test et utilitaires de colonnes', () => {
    expect(
      previewLines(
        layoutTestPage('Caisse 1', 'Site', 58, new Date('2026-10-29T10:00:00Z')),
        58,
      ).join('\n'),
    ).toContain('Papier : 58 mm');
    expect(columns('Total', '100', 12)).toBe('Total    100');
    expect(wrap('un deux trois quatre', 9)).toEqual(['un deux', 'trois', 'quatre']);
  });
});

describe('protocole du pont matériel', () => {
  const printer = { connection: 'NETWORK' as const, address: '192.168.1.50:9100' };

  it.each([
    ['NETWORK', '192.168.1.50', null],
    ['NETWORK', '10.0.0.7:9101', null],
    ['NETWORK', '8.8.8.8:9100', 'Adresse réseau invalide'],
    ['NETWORK', '192.168.1.50:22', 'Port invalide'],
    ['NETWORK', 'imprimante.local', 'Adresse réseau invalide'],
    ['BLUETOOTH', '00:11:22:AA:BB:CC', null],
    ['BLUETOOTH', '00-11-22', 'Adresse Bluetooth invalide'],
    ['USB', '04B8:0202', null],
    ['USB', 'epson', 'Identifiant USB invalide'],
    ['SIMULATED', '', null],
  ] as const)('%s « %s »', (connection, address, expected) => {
    const result = validatePrinterAddress(connection, address);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toContain(expected);
  });

  it('refuse un flux d’impression qui tenterait d’ouvrir le tiroir', () => {
    const kick = toBase64(Uint8Array.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]));
    expect(validateHardwareCommand({ type: 'print', printer, data: kick })).toContain('tiroir');
    const ticket = toBase64(encodeReceiptLines(layoutReceipt(SALE, 80)));
    expect(validateHardwareCommand({ type: 'print', printer, data: ticket })).toBeNull();
  });

  it('valide la broche du tiroir et la cible', () => {
    expect(validateHardwareCommand({ type: 'openDrawer', printer, pin: 2 })).toBeNull();
    expect(validateHardwareCommand({ type: 'openDrawer', printer, pin: 3 as 2 })).toContain(
      'Broche',
    );
    expect(
      validateHardwareCommand({
        type: 'test',
        printer: { connection: 'NETWORK', address: '1.2.3.4' },
      }),
    ).not.toBeNull();
  });

  it('permissions matériel : configuration réservée, réimpression et tiroir manuel au superviseur', () => {
    expect(hasPermission('ADMIN', 'hardware.manage')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'hardware.manage')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'receipt.reprint')).toBe(true);
    expect(hasPermission('SUPERVISOR', 'drawer.open_manual')).toBe(true);
    expect(hasPermission('CASHIER', 'receipt.reprint')).toBe(false);
    expect(hasPermission('CASHIER', 'drawer.open_manual')).toBe(false);
  });
});
