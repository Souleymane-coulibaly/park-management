'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_LABELS,
} from '@ocall/shared';
import { STATUS_TONE, TicketThread } from '@/components/support/ticket-thread';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { SupportTicketView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface Agent {
  id: string;
  firstName: string;
  lastName: string;
}

/** Traitement d'une demande : fil complet (notes internes comprises), statut, urgence, affectation. */
export default function PlatformTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const loaded = useApi<SupportTicketView>(`/platform/support/tickets/${id}`);
  const agents = useApi<Agent[]>('/platform/support/agents');
  const [ticket, setTicket] = useState<SupportTicketView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Référence stable (état de useApi) : une réponse envoyée n'est pas écrasée au rendu suivant.
  const initial = loaded.state === 'success' ? loaded.data : null;
  useEffect(() => {
    if (initial) setTicket(initial);
  }, [initial]);

  async function update(body: Record<string, string | null>) {
    setError(null);
    try {
      setTicket(
        await api<SupportTicketView>(`/platform/support/tickets/${id}`, { method: 'PATCH', body }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  return (
    <>
      <Link
        href="/admin/support"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-forest"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Support
      </Link>
      {loaded.state === 'loading' && <LoadingState />}
      {loaded.state === 'error' && <ErrorState error={loaded.error} onRetry={loaded.reload} />}
      {ticket && (
        <>
          <PageHeader
            eyebrow={`${ticket.number} · ${SUPPORT_TICKET_CATEGORY_LABELS[ticket.category]}`}
            title={ticket.subject}
            description={`${ticket.organization?.name ?? ''}${ticket.establishment ? ` · ${ticket.establishment.name}` : ''} · ouverte le ${formatDateTime(ticket.createdAt)} par ${ticket.createdBy.firstName} ${ticket.createdBy.lastName}`}
            action={
              <Badge tone={STATUS_TONE[ticket.status]}>
                {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
            }
          />
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <TicketThread
              ticket={ticket}
              viewer="ocall"
              replyPath={`/platform/support/tickets/${ticket.id}/messages`}
              onReplied={setTicket}
            />
            <Card>
              <CardHeader title="Traitement" />
              <CardBody>
                <div className="space-y-3">
                  <SelectField
                    label="Statut"
                    value={ticket.status}
                    onChange={(e) => update({ status: e.target.value })}
                    options={SUPPORT_TICKET_STATUSES.map((s) => ({
                      value: s,
                      label: SUPPORT_TICKET_STATUS_LABELS[s],
                    }))}
                  />
                  <SelectField
                    label="Urgence"
                    value={ticket.priority}
                    onChange={(e) => update({ priority: e.target.value })}
                    options={SUPPORT_TICKET_PRIORITIES.map((p) => ({
                      value: p,
                      label: SUPPORT_TICKET_PRIORITY_LABELS[p],
                    }))}
                  />
                  <SelectField
                    label="Affectée à"
                    value={ticket.assignedTo?.id ?? ''}
                    onChange={(e) => update({ assignedToId: e.target.value || null })}
                    options={[
                      { value: '', label: 'Personne' },
                      ...(agents.state === 'success'
                        ? agents.data.map((a) => ({
                            value: a.id,
                            label: `${a.firstName} ${a.lastName}`,
                          }))
                        : []),
                    ]}
                  />
                  <ApiErrorAlert error={error} />
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
