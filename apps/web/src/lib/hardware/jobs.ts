'use client';

/**
 * Orchestration impression / tiroir : le serveur autorise et fournit la commande, l'appareil
 * l'exécute, puis le résultat est rapporté au serveur (historique des tentatives).
 * Un échec matériel est renvoyé à l'interface mais n'affecte jamais la vente encaissée.
 */
import { ApiError, api } from '@/lib/api';
import { newRequestId } from '@/lib/request-id';
import type { DrawerEventResponse, PrintJobResponse } from '@/lib/types';
import { HardwareError, openDrawerOnDevice, printOnDevice } from './device';

export interface HardwareOutcome {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  message?: string;
  /** Aperçu du ticket (impressions uniquement). */
  preview?: string[];
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof HardwareError) return { code: error.code, message: error.message };
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: 'HARDWARE_ERROR', message: 'Erreur inattendue du matériel.' };
}

async function report(
  path: string,
  error: { code: string; message: string } | null,
): Promise<void> {
  // Le résultat est rapporté au mieux : une coupure réseau laisse la tentative « en attente » dans
  // l'historique, sans effet sur la vente.
  await api(path, {
    method: 'POST',
    body: error
      ? { status: 'FAILED', errorCode: error.code, errorMessage: error.message.slice(0, 300) }
      : { status: 'SUCCEEDED' },
  }).catch(() => undefined);
}

export async function runPrintJob(body: {
  terminalId: string;
  kind: 'RECEIPT' | 'REPRINT' | 'TEST';
  saleId?: string;
  /** Billetterie : réimpression d'un seul billet de la vente. */
  ticketId?: string;
  reason?: string;
  clientRequestId?: string;
}): Promise<HardwareOutcome> {
  let response: PrintJobResponse;
  try {
    response = await api<PrintJobResponse>('/print-jobs', {
      method: 'POST',
      body: { clientRequestId: newRequestId(), ...body },
    });
  } catch (error) {
    return { status: 'FAILED', message: describe(error).message };
  }
  if (!response.data) {
    return {
      status: response.job.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
      preview: response.preview,
    };
  }
  try {
    await printOnDevice(response.printer, response.data, response.preview);
    await report(`/print-jobs/${response.job.id}/result`, null);
    return { status: 'SUCCEEDED', preview: response.preview };
  } catch (error) {
    const failure = describe(error);
    await report(`/print-jobs/${response.job.id}/result`, failure);
    return { status: 'FAILED', message: failure.message, preview: response.preview };
  }
}

export async function runDrawerOpening(body: {
  terminalId: string;
  reason: 'CASH_PAYMENT' | 'MANUAL';
  paymentId?: string;
  justification?: string;
}): Promise<HardwareOutcome> {
  let response: DrawerEventResponse;
  try {
    response = await api<DrawerEventResponse>('/drawer-events', {
      method: 'POST',
      body: { clientRequestId: newRequestId(), ...body },
    });
  } catch (error) {
    return { status: 'FAILED', message: describe(error).message };
  }
  // Le paiement a déjà ouvert le tiroir : aucune nouvelle ouverture.
  if (!response.command)
    return { status: 'SKIPPED', message: 'Tiroir déjà ouvert pour ce paiement.' };
  try {
    await openDrawerOnDevice(response.printer, response.command.pin);
    await report(`/drawer-events/${response.event.id}/result`, null);
    return { status: 'SUCCEEDED' };
  } catch (error) {
    const failure = describe(error);
    await report(`/drawer-events/${response.event.id}/result`, failure);
    return { status: 'FAILED', message: failure.message };
  }
}
