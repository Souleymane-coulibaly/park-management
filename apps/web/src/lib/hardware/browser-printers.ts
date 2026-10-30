'use client';

/**
 * Impression directe depuis le navigateur (PWA sous Chrome Android ou ordinateur), sans connecteur
 * natif :
 * - WebUSB : imprimante thermique USB (câble OTG sur tablette) ;
 * - Web Bluetooth : imprimante Bluetooth Low Energy (BLE).
 *
 * Limites du navigateur (documentées) : pas de Bluetooth « classique » (SPP) ni d'envoi brut vers une
 * imprimante réseau (port 9100) ; pour ces modèles, le connecteur Android reste nécessaire.
 *
 * L'imprimante est choisie une fois sur l'appareil (geste de l'utilisateur, exigé par le navigateur) ;
 * WebUSB la retrouve ensuite seul. Le flux ESC/POS vient du serveur et a été contrôlé avant l'envoi
 * (taille, aucune commande de tiroir) ; l'ouverture du tiroir n'est générée ici que sur ordre
 * autorisé par le serveur (évènement de tiroir).
 */
import { chunkBytes } from '@ocall/shared';
import { HardwareError } from './hardware-error';

// ─── Types minimaux des API WebUSB et Web Bluetooth (non fournis par TypeScript) ───

interface UsbEndpoint {
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  endpointNumber: number;
}
interface UsbInterface {
  interfaceNumber: number;
  alternate: { interfaceClass: number; endpoints: UsbEndpoint[] };
}
interface UsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string }>;
}
interface Usb {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: {
    filters: { vendorId?: number; productId?: number }[];
  }): Promise<UsbDevice>;
}
interface BleCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(data: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
}
interface BleService {
  getCharacteristics(): Promise<BleCharacteristic[]>;
}
interface BleServer {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<BleService>;
  disconnect(): void;
}
interface BleDevice {
  id: string;
  name?: string;
  gatt?: { connect(): Promise<BleServer> };
}
interface Bluetooth {
  requestDevice(options: {
    filters?: { namePrefix: string }[];
    acceptAllDevices?: boolean;
    optionalServices: string[];
  }): Promise<BleDevice>;
  getDevices?(): Promise<BleDevice[]>;
}

const usb = (): Usb | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as unknown as { usb?: Usb }).usb;
const bluetooth = (): Bluetooth | undefined =>
  typeof navigator === 'undefined'
    ? undefined
    : (navigator as unknown as { bluetooth?: Bluetooth }).bluetooth;

/** Classe USB « imprimante ». Beaucoup d'imprimantes thermiques utilisent aussi une classe propriétaire. */
const USB_PRINTER_CLASS = 0x07;
const USB_CHUNK_BYTES = 16 * 1024;
/** Services GATT courants des imprimantes thermiques BLE (le premier service inscriptible est utilisé). */
export const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];
/** Paquets BLE prudents (MTU courante) et petite pause pour ne pas saturer l'imprimante. */
const BLE_CHUNK_BYTES = 180;
const BLE_CHUNK_DELAY_MS = 15;
const BROWSER_TIMEOUT_MS = 20_000;

export type BrowserPrinterKind = 'WEBUSB' | 'WEBBLUETOOTH';

/** Le navigateur de l'appareil sait-il piloter ce type d'imprimante ? */
export function browserPrintingSupported(kind: BrowserPrinterKind): boolean {
  return kind === 'WEBUSB' ? !!usb() : !!bluetooth();
}

function parseUsbId(address: string | null): { vendorId: number; productId: number } | null {
  const match = /^([0-9A-F]{4}):([0-9A-F]{4})$/i.exec((address ?? '').trim());
  return match ? { vendorId: parseInt(match[1]!, 16), productId: parseInt(match[2]!, 16) } : null;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new HardwareError('TIMEOUT', 'L’imprimante n’a pas répondu à temps.')),
      BROWSER_TIMEOUT_MS,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function unsupported(kind: BrowserPrinterKind): HardwareError {
  return new HardwareError(
    'BROWSER_UNSUPPORTED',
    kind === 'WEBUSB'
      ? 'Ce navigateur ne gère pas l’USB direct (WebUSB) : utilisez Chrome sur Android ou ordinateur.'
      : 'Ce navigateur ne gère pas le Bluetooth direct (Web Bluetooth) : utilisez Chrome sur Android.',
  );
}

// ─── WebUSB ───

async function findUsbPrinter(address: string | null): Promise<UsbDevice | undefined> {
  const api = usb();
  if (!api) throw unsupported('WEBUSB');
  const wanted = parseUsbId(address);
  const devices = await api.getDevices();
  return devices.find(
    (d) => !wanted || (d.vendorId === wanted.vendorId && d.productId === wanted.productId),
  );
}

/** Interface d'impression : classe imprimante en priorité, sinon toute interface à sortie « bulk ». */
function printerInterface(device: UsbDevice): { iface: number; endpoint: number } {
  const interfaces = device.configuration?.interfaces ?? [];
  const sorted = [...interfaces].sort(
    (a, b) =>
      Number(b.alternate.interfaceClass === USB_PRINTER_CLASS) -
      Number(a.alternate.interfaceClass === USB_PRINTER_CLASS),
  );
  for (const i of sorted) {
    const out = i.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
    if (out) return { iface: i.interfaceNumber, endpoint: out.endpointNumber };
  }
  throw new HardwareError(
    'PRINTER_INCOMPATIBLE',
    'Cet appareil USB n’accepte pas de flux d’impression.',
  );
}

async function sendUsb(address: string | null, bytes: Uint8Array): Promise<void> {
  const device = await findUsbPrinter(address);
  if (!device) {
    throw new HardwareError(
      'PRINTER_NOT_PAIRED',
      'Imprimante USB non associée à cet appareil : utilisez « Associer l’imprimante ».',
    );
  }
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const { iface, endpoint } = printerInterface(device);
  try {
    await device.claimInterface(iface);
  } catch {
    throw new HardwareError(
      'PRINTER_BUSY',
      'L’imprimante USB est utilisée par une autre page ou application.',
    );
  }
  try {
    for (const chunk of chunkBytes(bytes, USB_CHUNK_BYTES)) {
      const result = await device.transferOut(endpoint, chunk);
      if (result.status !== 'ok')
        throw new HardwareError('PRINTER_UNREACHABLE', 'Transfert USB interrompu.');
    }
  } finally {
    await device.releaseInterface(iface).catch(() => undefined);
    await device.close().catch(() => undefined);
  }
}

// ─── Web Bluetooth ───

/** Imprimante BLE choisie pendant cette visite (le navigateur ne la retrouve pas toujours seul). */
let bleDevice: BleDevice | null = null;

async function findBlePrinter(name: string | null): Promise<BleDevice | undefined> {
  const api = bluetooth();
  if (!api) throw unsupported('WEBBLUETOOTH');
  if (bleDevice) return bleDevice;
  const known = (await api.getDevices?.().catch(() => [])) ?? [];
  const found = known.find((d) => !name || d.name?.startsWith(name));
  if (found) bleDevice = found;
  return found;
}

async function writableCharacteristic(server: BleServer): Promise<BleCharacteristic> {
  for (const uuid of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(uuid);
      const characteristic = (await service.getCharacteristics()).find(
        (c) => c.properties.writeWithoutResponse || c.properties.write,
      );
      if (characteristic) return characteristic;
    } catch {
      // Service absent sur ce modèle : on essaie le suivant.
    }
  }
  throw new HardwareError(
    'PRINTER_INCOMPATIBLE',
    'Imprimante Bluetooth non reconnue (aucun service d’impression BLE).',
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBle(name: string | null, bytes: Uint8Array): Promise<void> {
  const device = await findBlePrinter(name);
  if (!device?.gatt) {
    throw new HardwareError(
      'PRINTER_NOT_PAIRED',
      'Imprimante Bluetooth non associée sur cet appareil : utilisez « Associer l’imprimante ».',
    );
  }
  const server = await device.gatt.connect();
  try {
    const characteristic = await writableCharacteristic(server);
    for (const chunk of chunkBytes(bytes, BLE_CHUNK_BYTES)) {
      if (
        characteristic.properties.writeWithoutResponse &&
        characteristic.writeValueWithoutResponse
      ) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      await pause(BLE_CHUNK_DELAY_MS);
    }
  } finally {
    if (server.connected) server.disconnect();
  }
}

// ─── Points d'entrée ───

/**
 * Association de l'imprimante sur cet appareil : ouvre le sélecteur du navigateur. À appeler depuis
 * un clic (exigence du navigateur). Renvoie le nom de l'imprimante choisie.
 */
export async function pairBrowserPrinter(
  kind: BrowserPrinterKind,
  address: string | null,
): Promise<string> {
  try {
    if (kind === 'WEBUSB') {
      const api = usb();
      if (!api) throw unsupported(kind);
      const wanted = parseUsbId(address);
      const device = await api.requestDevice({ filters: wanted ? [wanted] : [] });
      return (
        device.productName ?? `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`
      );
    }
    const api = bluetooth();
    if (!api) throw unsupported(kind);
    const name = address?.trim() || null;
    bleDevice = await api.requestDevice({
      ...(name ? { filters: [{ namePrefix: name }] } : { acceptAllDevices: true }),
      optionalServices: BLE_PRINTER_SERVICES,
    });
    return bleDevice.name ?? 'Imprimante Bluetooth';
  } catch (error) {
    if (error instanceof HardwareError) throw error;
    // Sélecteur fermé sans choix, ou permission refusée.
    throw new HardwareError('PAIRING_CANCELLED', 'Aucune imprimante n’a été associée.');
  }
}

/** Envoie des octets (déjà contrôlés) à l'imprimante du navigateur. */
export async function sendToBrowserPrinter(
  kind: BrowserPrinterKind,
  address: string | null,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await withTimeout(kind === 'WEBUSB' ? sendUsb(address, bytes) : sendBle(address, bytes));
  } catch (error) {
    if (error instanceof HardwareError) throw error;
    throw new HardwareError(
      'PRINTER_UNREACHABLE',
      'Imprimante injoignable : vérifiez qu’elle est allumée, reliée et associée à cet appareil.',
    );
  }
}

/**
 * Impulsion d'ouverture du tiroir (ESC p), générée sur l'appareil UNIQUEMENT après l'autorisation du
 * serveur (évènement de tiroir) : jamais incluse dans un flux d'impression.
 */
export function drawerPulse(pin: 2 | 5): Uint8Array {
  return Uint8Array.from([0x1b, 0x70, pin === 5 ? 1 : 0, 0x19, 0xfa]);
}
