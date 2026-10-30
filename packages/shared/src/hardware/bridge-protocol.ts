/**
 * Protocole entre l'application web et le connecteur matériel Android (pont WebView).
 *
 * Le pont n'accepte que quatre commandes typées. Il ne reçoit jamais d'octets de commande de
 * tiroir : `openDrawer` est généré par le connecteur lui-même. Les mêmes règles de validation
 * sont appliquées côté web (avant envoi) et côté Android (à la réception) — voir
 * apps/android/app/src/main/java/com/ocallpark/pos/CommandValidator.kt.
 */
import { containsDrawerKick, fromBase64 } from './escpos';

export const PRINTER_CONNECTIONS = [
  'NONE',
  'SIMULATED',
  'NETWORK',
  'BLUETOOTH',
  'USB',
  'WEBUSB',
  'WEBBLUETOOTH',
] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];
/** Connexions physiques, gérées par le connecteur Android. */
export type PhysicalConnection = 'NETWORK' | 'BLUETOOTH' | 'USB';
/** Connexions pilotées directement par le navigateur (PWA), sans connecteur natif. */
export type BrowserConnection = 'WEBUSB' | 'WEBBLUETOOTH';

export function isBrowserConnection(c: PrinterConnection): c is BrowserConnection {
  return c === 'WEBUSB' || c === 'WEBBLUETOOTH';
}

export const PRINTER_CONNECTION_LABELS: Record<PrinterConnection, string> = {
  NONE: 'Aucune imprimante',
  SIMULATED: 'Simulation (aucun matériel)',
  NETWORK: 'Réseau (Ethernet / Wi-Fi, port 9100, connecteur Android)',
  BLUETOOTH: 'Bluetooth classique (connecteur Android)',
  USB: 'USB (connecteur Android)',
  WEBUSB: 'USB — navigateur (PWA, WebUSB)',
  WEBBLUETOOTH: 'Bluetooth BLE — navigateur (PWA)',
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
  // Navigateur : l'imprimante est choisie sur l'appareil ; l'identifiant sert seulement de filtre.
  if (connection === 'WEBUSB') {
    return !value || /^[0-9A-F]{4}:[0-9A-F]{4}$/i.test(value)
      ? null
      : 'Identifiant USB invalide : vendorId:productId en hexadécimal (ex. 04B8:0202), ou vide.';
  }
  if (connection === 'WEBBLUETOOTH') {
    return value.length <= 40 ? null : 'Nom Bluetooth trop long (40 caractères au plus).';
  }
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
    return validatePrintBytes(bytes);
  }
  return null;
}

/**
 * Contrôle d'un flux d'impression avant envoi à l'imprimante, par le connecteur Android comme par le
 * navigateur : taille bornée et aucune commande d'ouverture du tiroir cachée dans le flux.
 */
export function validatePrintBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > MAX_PRINT_BYTES)
    return 'Taille du flux d’impression invalide.';
  if (containsDrawerKick(bytes)) return 'Un flux d’impression ne peut pas ouvrir le tiroir.';
  return null;
}

/** Découpe un flux en paquets (Bluetooth BLE : quelques centaines d'octets par écriture). */
export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('Taille de paquet invalide.');
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}
