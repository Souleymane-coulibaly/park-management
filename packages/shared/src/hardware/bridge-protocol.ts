/**
 * Protocole entre l'application web et le connecteur matériel Android (pont WebView).
 *
 * Le pont n'accepte que quatre commandes typées. Il ne reçoit jamais d'octets de commande de
 * tiroir : `openDrawer` est généré par le connecteur lui-même. Les mêmes règles de validation
 * sont appliquées côté web (avant envoi) et côté Android (à la réception) — voir
 * apps/android/app/src/main/java/com/ocallpark/pos/CommandValidator.kt.
 */
import { containsDrawerKick, fromBase64 } from './escpos';

export const PRINTER_CONNECTIONS = ['NONE', 'SIMULATED', 'NETWORK', 'BLUETOOTH', 'USB'] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];
/** Connexions physiques, gérées par le connecteur Android. */
export type PhysicalConnection = 'NETWORK' | 'BLUETOOTH' | 'USB';

export const PRINTER_CONNECTION_LABELS: Record<PrinterConnection, string> = {
  NONE: 'Aucune imprimante',
  SIMULATED: 'Simulation (aucun matériel)',
  NETWORK: 'Réseau (Ethernet / Wi-Fi, port 9100)',
  BLUETOOTH: 'Bluetooth',
  USB: 'USB',
};

export interface PrinterTarget {
  connection: PhysicalConnection;
  address: string;
}

export type HardwareCommand =
  | { type: 'info' }
  | { type: 'print'; printer: PrinterTarget; data: string }
  | { type: 'openDrawer'; printer: PrinterTarget; pin: 2 | 5 }
  | { type: 'test'; printer: PrinterTarget };

export interface HardwareResponse {
  id: string;
  ok: boolean;
  /** Code d'erreur normalisé : PRINTER_UNREACHABLE, PERMISSION_DENIED, INVALID_COMMAND, TIMEOUT… */
  error?: string;
  message?: string;
  data?: unknown;
}

/** Taille maximale d'un flux d'impression (64 Kio) : un ticket en fait moins de 4. */
export const MAX_PRINT_BYTES = 64 * 1024;
export const NETWORK_PORT_MIN = 9100;
export const NETWORK_PORT_MAX = 9109;

/**
 * Une imprimante réseau doit être sur le réseau local (IPv4 privée) et sur un port d'impression
 * brute (9100–9109) : le pont ne peut pas servir à joindre une machine arbitraire.
 */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255))
    return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function validatePrinterAddress(
  connection: PrinterConnection,
  address: string | null | undefined,
): string | null {
  if (connection === 'NONE' || connection === 'SIMULATED') return null;
  const value = (address ?? '').trim();
  if (!value) return 'Adresse de l’imprimante obligatoire.';
  switch (connection) {
    case 'NETWORK': {
      const [host, port, extra] = value.split(':');
      if (extra !== undefined || !host || !isPrivateIpv4(host)) {
        return 'Adresse réseau invalide : IPv4 du réseau local attendue (ex. 192.168.1.50:9100).';
      }
      if (
        port !== undefined &&
        (!/^\d+$/.test(port) || Number(port) < NETWORK_PORT_MIN || Number(port) > NETWORK_PORT_MAX)
      ) {
        return `Port invalide : ${NETWORK_PORT_MIN} à ${NETWORK_PORT_MAX} attendu.`;
      }
      return null;
    }
    case 'BLUETOOTH':
      return /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i.test(value)
        ? null
        : 'Adresse Bluetooth invalide (ex. 00:11:22:33:44:55).';
    case 'USB':
      return /^[0-9A-F]{4}:[0-9A-F]{4}$/i.test(value)
        ? null
        : 'Identifiant USB invalide : vendorId:productId en hexadécimal (ex. 04B8:0202).';
  }
}

/** Valide une commande avant envoi au pont ; renvoie un message d'erreur ou null. */
export function validateHardwareCommand(command: HardwareCommand): string | null {
  if (command.type === 'info') return null;
  const { printer } = command;
  if (!printer || !['NETWORK', 'BLUETOOTH', 'USB'].includes(printer.connection))
    return 'Connexion inconnue.';
  const addressError = validatePrinterAddress(printer.connection, printer.address);
  if (addressError) return addressError;
  if (command.type === 'openDrawer' && command.pin !== 2 && command.pin !== 5)
    return 'Broche de tiroir invalide (2 ou 5).';
  if (command.type === 'print') {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(command.data);
    } catch {
      return 'Flux d’impression illisible.';
    }
    if (bytes.length === 0 || bytes.length > MAX_PRINT_BYTES)
      return 'Taille du flux d’impression invalide.';
    if (containsDrawerKick(bytes)) return 'Un flux d’impression ne peut pas ouvrir le tiroir.';
  }
  return null;
}
