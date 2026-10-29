'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Printer, RotateCw, Vault, XCircle } from 'lucide-react';
import { useCan } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { type HardwareOutcome, runDrawerOpening, runPrintJob } from '@/lib/hardware/jobs';
import { newRequestId } from '@/lib/request-id';
import type { PaymentResult, PosTerminal } from '@/lib/types';
import { ReprintDialog } from './reprint-dialog';

type Step = HardwareOutcome | { status: 'RUNNING' } | null;

function StepRow({
  icon,
  label,
  step,
  testId,
}: {
  icon: ReactNode;
  label: string;
  step: Step;
  testId: string;
}) {
  if (!step) return null;
  return (
    <li className="flex items-start gap-3 text-sm" data-testid={testId} data-status={step.status}>
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="flex-1">
        <span className="font-medium">{label}</span>
        {'message' in step && step.message && (
          <span className="block text-muted">{step.message}</span>
        )}
      </span>
      {step.status === 'RUNNING' && (
        <Loader2 className="h-5 w-5 animate-spin text-forest" aria-label="En cours" />
      )}
      {step.status === 'SUCCEEDED' && (
        <CheckCircle2 className="h-5 w-5 text-forest" aria-label="Réussi" />
      )}
      {step.status === 'SKIPPED' && (
        <CheckCircle2 className="h-5 w-5 text-muted" aria-label="Déjà fait" />
      )}
      {step.status === 'FAILED' && (
        <XCircle className="h-5 w-5 text-terracotta-dark" aria-label="Échec" />
      )}
    </li>
  );
}

/**
 * Après un paiement confirmé : ouverture du tiroir (espèces uniquement), puis impression du ticket.
 * Un échec matériel s'affiche et peut être retenté, mais la vente reste encaissée quoi qu'il arrive.
 */
export function AfterPaymentHardware({
  result,
  terminal,
}: {
  result: PaymentResult;
  terminal: PosTerminal | null;
}) {
  const canReprint = useCan('receipt.reprint');
  const [drawer, setDrawer] = useState<Step>(null);
  const [print, setPrint] = useState<Step>(null);
  const [reprinting, setReprinting] = useState(false);
  // Clé d'impression du ticket original : stable, pour qu'un rendu répété ne relance pas l'impression.
  const [receiptKey] = useState(newRequestId);
  const started = useRef(false);

  const hasPrinter = !!terminal && terminal.printerConnection !== 'NONE';

  async function printReceipt(clientRequestId: string) {
    if (!terminal) return;
    setPrint({ status: 'RUNNING' });
    setPrint(
      await runPrintJob({
        terminalId: terminal.id,
        kind: 'RECEIPT',
        saleId: result.sale.id,
        clientRequestId,
      }),
    );
  }

  useEffect(() => {
    if (started.current || !terminal || !hasPrinter) return;
    started.current = true;
    // Tiroir et ticket sont demandés au serveur en parallèle ; sur la tablette, le connecteur Android
    // exécute les commandes l'une après l'autre (file unique), l'imprimante ne reçoit donc qu'un flux à la fois.
    const drawer = async () => {
      // Tiroir : uniquement après un paiement en espèces confirmé, jamais pour Wave.
      if (
        !terminal.drawerEnabled ||
        result.payment.method !== 'CASH' ||
        result.payment.status !== 'SUCCEEDED'
      )
        return;
      setDrawer({ status: 'RUNNING' });
      setDrawer(
        await runDrawerOpening({
          terminalId: terminal.id,
          reason: 'CASH_PAYMENT',
          paymentId: result.payment.id,
        }),
      );
    };
    const receipt = async () => {
      if (terminal.autoPrintReceipt) await printReceipt(receiptKey);
    };
    void Promise.all([drawer(), receipt()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exécution unique après paiement
  }, [terminal?.id]);

  if (!terminal) {
    return (
      <p className="text-sm text-muted">
        Aucun poste de caisse sélectionné sur cet appareil : pas d’impression ni de tiroir.
      </p>
    );
  }
  if (!hasPrinter) return null;

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <ul className="space-y-2">
        <StepRow
          icon={<Vault className="h-5 w-5" />}
          label="Tiroir-caisse"
          step={drawer}
          testId="drawer-step"
        />
        <StepRow
          icon={<Printer className="h-5 w-5" />}
          label={`Ticket (${terminal.name})`}
          step={print}
          testId="print-step"
        />
      </ul>
      <div className="flex flex-wrap gap-2">
        {(print === null || print.status === 'FAILED') && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void printReceipt(newRequestId())}
            icon={print ? <RotateCw className="h-4 w-4" /> : <Printer className="h-4 w-4" />}
          >
            {print ? 'Réessayer l’impression' : 'Imprimer le ticket'}
          </Button>
        )}
        {canReprint && print?.status === 'SUCCEEDED' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReprinting(true)}
            icon={<Printer className="h-4 w-4" />}
          >
            Réimprimer (duplicata)
          </Button>
        )}
      </div>
      {reprinting && (
        <ReprintDialog
          saleId={result.sale.id}
          terminal={terminal}
          onClose={() => setReprinting(false)}
        />
      )}
    </div>
  );
}
