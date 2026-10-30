'use client';

import { type FormEvent, useState } from 'react';
import { Ban, Printer } from 'lucide-react';
import { TICKET_STATUS_LABELS, type TicketStatus, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { toApiError } from '@/components/pos/cash-session';
import { ReprintDialog } from '@/components/pos/reprint-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { IssuedTicket, PosTerminal } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { TicketQr } from './ticket-qr';

const STATUS_TONES: Record<TicketStatus, 'forest' | 'neutral' | 'savanna' | 'terracotta'> = {
  VALID: 'forest',
  USED: 'neutral',
  EXPIRED: 'savanna',
  CANCELLED: 'terracotta',
};

/** Validité lisible : un jour, ou une période. */
function validity(t: IssuedTicket): string {
  const from = formatDate(t.validFrom);
  const until = formatDate(t.validUntil);
  return from === until ? `Valable le ${from}` : `Valable du ${from} au ${until}`;
}

/**
 * Billets d'une vente payée, avec leur QR code. Le QR n'est affiché que pour un billet encore valide.
 * Réimpression d'un billet (responsable, motif obligatoire) et annulation (permission dédiée).
 */
export function SaleTickets({
  saleId,
  terminal,
}: {
  saleId: string;
  terminal: PosTerminal | null;
}) {
  const tickets = useApi<IssuedTicket[]>(`/tickets?saleId=${saleId}`);
  const canReprint = useCan('receipt.reprint');
  const canCancel = useCan('ticket.cancel');
  const [reprint, setReprint] = useState<IssuedTicket | null>(null);
  const [cancel, setCancel] = useState<IssuedTicket | null>(null);
  const hasPrinter = !!terminal && terminal.printerConnection !== 'NONE';

  if (tickets.state === 'loading') return <LoadingState label="Chargement des billets…" />;
  if (tickets.state === 'error')
    return <ErrorState error={tickets.error} onRetry={tickets.reload} />;
  if (tickets.data.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aucun billet : ils sont émis à la confirmation du paiement.
      </p>
    );
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Billets émis">
        {tickets.data.map((t, i) => (
          <li
            key={t.id}
            className="flex gap-3 rounded-2xl border border-line bg-surface p-3"
            data-testid="issued-ticket"
          >
            {t.status === 'VALID' ? (
              <TicketQr value={t.qr} size={112} label={`QR code du billet de ${t.visitorName}`} />
            ) : (
              <div className="grid h-[112px] w-[112px] shrink-0 place-items-center rounded-lg bg-ivory-dark/60 text-center text-xs text-muted">
                QR inactif
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-lg font-bold">{t.visitorName}</p>
              <p className="text-sm text-muted">
                {t.ticketCategory.name} · {formatXof(t.pricePaid)}
              </p>
              <p className="text-xs text-muted">{validity(t)}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONES[t.status]}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                <span className="text-xs text-muted">
                  Billet {i + 1}/{tickets.data.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {canReprint && hasPrinter && t.status === 'VALID' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setReprint(t)}
                    icon={<Printer className="h-4 w-4" />}
                  >
                    Réimprimer
                  </Button>
                )}
                {canCancel && t.status === 'VALID' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCancel(t)}
                    icon={<Ban className="h-4 w-4" />}
                  >
                    Annuler
                  </Button>
                )}
              </div>
              {t.status === 'CANCELLED' && t.cancelReason && (
                <p className="text-xs text-terracotta-dark">Motif : {t.cancelReason}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {reprint && terminal && (
        <ReprintDialog
          saleId={saleId}
          ticketId={reprint.id}
          label={`le billet de ${reprint.visitorName}`}
          terminal={terminal}
          onClose={() => setReprint(null)}
        />
      )}
      {cancel && (
        <CancelTicketDialog
          ticket={cancel}
          onClose={() => setCancel(null)}
          onCancelled={() => {
            setCancel(null);
            tickets.reload();
          }}
        />
      )}
    </>
  );
}

function CancelTicketDialog({
  ticket,
  onClose,
  onCancelled,
}: {
  ticket: IssuedTicket;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/tickets/${ticket.id}/cancel`, { method: 'POST', body: { reason } });
      onCancelled();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Annuler le billet de ${ticket.visitorName}`}
      description="Le QR code sera refusé au contrôle d’accès. L’annulation est enregistrée dans le journal d’audit."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <InputField
          label="Motif"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={3}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Retour
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={loading}
            disabled={reason.trim().length < 3}
          >
            Annuler le billet
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
