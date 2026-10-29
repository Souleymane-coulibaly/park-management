'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { type HardwareOutcome, runPrintJob } from '@/lib/hardware/jobs';
import type { PosTerminal } from '@/lib/types';

/** Réimpression contrôlée : motif obligatoire, ticket marqué DUPLICATA, action auditée. */
export function ReprintDialog({
  saleId,
  terminal,
  onClose,
}: {
  saleId: string;
  terminal: PosTerminal;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<HardwareOutcome | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setOutcome(await runPrintJob({ terminalId: terminal.id, kind: 'REPRINT', saleId, reason }));
    setLoading(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Réimprimer le ticket"
      description="Le ticket portera la mention DUPLICATA."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <InputField
          label="Motif de la réimpression"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
        />
        {outcome?.status === 'SUCCEEDED' && <Alert tone="success">Duplicata imprimé.</Alert>}
        {outcome?.status === 'FAILED' && (
          <Alert tone="error" title="Réimpression impossible">
            {outcome.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={reason.trim().length < 3 || outcome?.status === 'SUCCEEDED'}
          >
            Réimprimer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
