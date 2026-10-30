'use client';

/**
 * Exécution des commandes matérielles sur l'appareil.
 *
 * - Imprimante « Simulation » : aucun matériel ; le ticket est consigné en mémoire (et dans la
 *   console) pour les tests et les démonstrations. Ce n'est PAS une validation matérielle.
 * - Imprimante réseau, Bluetooth classique ou USB : transmise au connecteur Android natif (pont
 *   WebView `OcallHardware`).
 * - Imprimante « USB — navigateur » (WebUSB) ou « Bluetooth BLE — navigateur » : pilotée directement
 *   par la PWA, sans connecteur (browser-printers.ts).
 */
import {
  type HardwareCommand,
  type HardwareResponse,
  type PrinterTarget,
  fromBase64,
  isBrowserConnection,
  validateHardwareCommand,
  validatePrintBytes,
} from '@ocall/shared';
import type { HardwareTarget } from '@/lib/types';
import { newRequestId } from '@/lib/request-id';
import { drawerPulse, sendToBrowserPrinter } from './browser-printers';
import { HardwareError } from './hardware-error';

export { HardwareError };

/** Objet injecté par le connecteur Android (androidx.webkit addWebMessageListener). */
interface InjectedBridge {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void;
}

declare global {
  interface Window {
    OcallHardware?: InjectedBridge;
    /** Journal du mode simulation, lu par les tests E2E. */
    __ocallSimulated?: { prints: string[][]; drawerOpenings: number };
  }
}

const SIMULATE_FAILURE_KEY = 'ocp.hardware.simulateFailure';
const BRIDGE_TIMEOUT_MS = 15_000;

export function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.OcallHardware;
}

/** Panne simulée (mode Simulation uniquement), pour tester la gestion d'une imprimante indisponible. */
export function simulatedFailureEnabled(): boolean {
  try {
    return localStorage.getItem(SIMULATE_FAILURE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSimulatedFailure(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SIMULATE_FAILURE_KEY, 'true');
    else localStorage.removeItem(SIMULATE_FAILURE_KEY);
  } catch {
    // Stockage indisponible : la simulation de panne reste désactivée.
  }
}

function simulated(): { prints: string[][]; drawerOpenings: number } {
  window.__ocallSimulated ??= { prints: [], drawerOpenings: 0 };
  return window.__ocallSimulated;
}

/** Réponses du connecteur en attente, par identifiant de requête. */
const pending = new Map<
  string,
  { resolve: (r: HardwareResponse) => void; timer: ReturnType<typeof setTimeout> }
>();
let listening = false;

function sendToBridge(command: HardwareCommand): Promise<HardwareResponse> {
  const bridge = window.OcallHardware;
  if (!bridge) {
    return Promise.reject(
      new HardwareError(
        'BRIDGE_UNAVAILABLE',
        'Connecteur matériel absent : utilisez l’application Ocall Park pour Android.',
      ),
    );
  }
  if (!listening) {
    bridge.addEventListener('message', (event) => {
      let response: HardwareResponse;
      try {
        response = JSON.parse(event.data) as HardwareResponse;
      } catch {
        return;
      }
      const waiting = pending.get(response.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.delete(response.id);
      waiting.resolve(response);
    });
    listening = true;
  }
  const id = newRequestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new HardwareError('TIMEOUT', 'Le matériel n’a pas répondu à temps.'));
    }, BRIDGE_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    bridge.postMessage(JSON.stringify({ id, ...command }));
  });
}

async function runPhysical(command: HardwareCommand): Promise<void> {
  const invalid = validateHardwareCommand(command);
  if (invalid) throw new HardwareError('INVALID_COMMAND', invalid);
  const response = await sendToBridge(command);
  if (!response.ok)
    throw new HardwareError(
      response.error ?? 'HARDWARE_ERROR',
      response.message ?? 'Erreur du matériel.',
    );
}

function physicalTarget(target: HardwareTarget): PrinterTarget {
  if (
    target.connection === 'NETWORK' ||
    target.connection === 'BLUETOOTH' ||
    target.connection === 'USB'
  ) {
    return { connection: target.connection, address: target.address ?? '' };
  }
  throw new HardwareError(
    'PRINTER_NOT_CONFIGURED',
    'Aucune imprimante n’est configurée pour ce poste.',
  );
}

/** Envoie un ticket (flux ESC/POS en base64) à l'imprimante du poste. */
export async function printOnDevice(
  target: HardwareTarget,
  data: string,
  preview: string[],
): Promise<void> {
  if (target.connection === 'SIMULATED') {
    if (simulatedFailureEnabled())
      throw new HardwareError(
        'PRINTER_UNREACHABLE',
        'Imprimante simulée indisponible (panne simulée).',
      );
    simulated().prints.push(preview);
    console.info('[Simulation] Ticket imprimé :\n' + preview.join('\n'));
    return;
  }
  if (isBrowserConnection(target.connection)) {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(data);
    } catch {
      throw new HardwareError('INVALID_COMMAND', 'Flux d’impression illisible.');
    }
    // Mêmes contrôles que le connecteur Android : taille bornée, aucune ouverture de tiroir cachée.
    const invalid = validatePrintBytes(bytes);
    if (invalid) throw new HardwareError('INVALID_COMMAND', invalid);
    await sendToBrowserPrinter(target.connection, target.address, bytes);
    return;
  }
  await runPhysical({ type: 'print', printer: physicalTarget(target), data });
}

/** Ouvre le tiroir-caisse relié à l'imprimante du poste. */
export async function openDrawerOnDevice(target: HardwareTarget, pin: 2 | 5): Promise<void> {
  if (target.connection === 'SIMULATED') {
    if (simulatedFailureEnabled())
      throw new HardwareError('PRINTER_UNREACHABLE', 'Tiroir simulé indisponible (panne simulée).');
    simulated().drawerOpenings += 1;
    console.info('[Simulation] Ouverture du tiroir-caisse');
    return;
  }
  if (isBrowserConnection(target.connection)) {
    // Impulsion générée sur l'appareil, uniquement sur l'ordre autorisé par le serveur.
    await sendToBrowserPrinter(target.connection, target.address, drawerPulse(pin));
    return;
  }
  await runPhysical({ type: 'openDrawer', printer: physicalTarget(target), pin });
}
