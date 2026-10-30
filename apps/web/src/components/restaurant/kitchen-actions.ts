'use client';

import { api } from '@/lib/api';
import { type HardwareOutcome, runPrintJob } from '@/lib/hardware/jobs';
import type { PosTerminal, Sale, TransitionResult } from '@/lib/types';

export interface SendResult {
  order: Sale;
  /** false : la commande était déjà en cuisine (requête rejouée), rien n'a changé. */
  changed: boolean;
  /** Ticket cuisine : null si aucune imprimante cuisine n'est configurée. */
  print: HardwareOutcome | null;
}

/**
 * Action explicite « Envoyer en cuisine », puis impression du ticket cuisine sur l'imprimante cuisine
 * de l'établissement (si configurée). Le ticket n'est imprimé qu'après un envoi réellement effectué ;
 * un échec d'impression est signalé mais ne change ni la commande ni son paiement.
 */
export async function sendToKitchen(orderId: string, establishmentId: string): Promise<SendResult> {
  const result = await api<TransitionResult<Sale>>(`/orders/${orderId}/send-to-kitchen`, {
    method: 'POST',
  });
  if (!result.changed) return { ...result, print: null };
  const terminals = await api<PosTerminal[]>(
    `/pos-terminals?establishmentId=${establishmentId}`,
  ).catch(() => [] as PosTerminal[]);
  const printer = terminals.find(
    (t) => t.kitchenPrinter && t.isActive && t.printerConnection !== 'NONE',
  );
  const print = printer
    ? await runPrintJob({ terminalId: printer.id, kind: 'KITCHEN', saleId: orderId })
    : null;
  return { ...result, print };
}
