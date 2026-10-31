'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
} from '@ocall/shared';
import { STATUS_TONE, TicketThread } from '@/components/support/ticket-thread';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { SupportTicketView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Fil d'une demande de support côté client (les notes internes d'Ocall ne sont jamais envoyées). */
export default function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const loaded = useApi<SupportTicketView>(`/support/tickets/${id}`);
  const [ticket, setTicket] = useState<SupportTicketView | null>(null);
  // Référence stable (état de useApi) : une réponse envoyée n'est pas écrasée au rendu suivant.
  const initial = loaded.state === 'success' ? loaded.data : null;
  useEffect(() => {
    if (initial) setTicket(initial);
  }, [initial]);

  return (
    <>
      <Link
        href="/app/support"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Mes demandes
      </Link>
      {loaded.state === 'loading' && <LoadingState />}
      {loaded.state === 'error' && <ErrorState error={loaded.error} onRetry={loaded.reload} />}
      {ticket && (
        <>
          <PageHeader
            eyebrow={`${ticket.number} · ${SUPPORT_TICKET_CATEGORY_LABELS[ticket.category]}`}
            title={ticket.subject}
            description={`Urgence : ${SUPPORT_TICKET_PRIORITY_LABELS[ticket.priority]}${ticket.establishment ? ` · ${ticket.establishment.name}` : ''}`}
            action={
              <Badge tone={STATUS_TONE[ticket.status]}>
                {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
            }
          />
          <TicketThread
            ticket={ticket}
            viewer="customer"
            replyPath={`/support/tickets/${ticket.id}/messages`}
            onReplied={setTicket}
          />
        </>
      )}
    </>
  );
}
