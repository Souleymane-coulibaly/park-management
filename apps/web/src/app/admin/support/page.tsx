'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import {
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_LABELS,
} from '@ocall/shared';
import { STATUS_TONE } from '@/components/support/ticket-thread';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { SupportTicketView, SuiteProduct } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** File des demandes de support des clients, par statut, produit et affectation. */
export default function PlatformSupportPage() {
  const [status, setStatus] = useState('');
  const [product, setProduct] = useState('');
  const [mine, setMine] = useState(false);
  const query = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(product ? { product } : {}),
    ...(mine ? { mine: 'true' } : {}),
  }).toString();
  const tickets = useApi<SupportTicketView[]>(
    `/platform/support/tickets${query ? `?${query}` : ''}`,
  );
  const products = useApi<SuiteProduct[]>('/platform/products');

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Support"
        description="Demandes des clients. Les réponses s’affichent dans leur espace ; les notes internes restent invisibles pour eux."
      />
      <Card>
        <CardHeader
          title="Demandes"
          action={
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <SelectField
                  label="Statut"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  options={[
                    { value: '', label: 'Tous' },
                    ...SUPPORT_TICKET_STATUSES.map((s) => ({
                      value: s,
                      label: SUPPORT_TICKET_STATUS_LABELS[s],
                    })),
                  ]}
                />
              </div>
              <div className="w-48">
                <SelectField
                  label="Produit"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  options={[
                    { value: '', label: 'Tous' },
                    ...(products.state === 'success'
                      ? products.data.map((p) => ({ value: p.code, label: p.name }))
                      : []),
                  ]}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={mine}
                  onChange={(e) => setMine(e.target.checked)}
                />
                Mes demandes
              </label>
            </div>
          }
        />
        {tickets.state === 'loading' && <LoadingState />}
        {tickets.state === 'error' && <ErrorState error={tickets.error} onRetry={tickets.reload} />}
        {tickets.state === 'success' &&
          (tickets.data.length === 0 ? (
            <EmptyState
              icon={<LifeBuoy className="h-7 w-7" />}
              title="Aucune demande"
              description="Les demandes des clients apparaîtront ici."
            />
          ) : (
            <Table
              head={[
                'Demande',
                'Organisation',
                'Urgence',
                'Statut',
                'Affectée à',
                'Dernier message',
              ]}
            >
              {tickets.data.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link
                      href={`/admin/support/${t.id}`}
                      className="font-semibold text-forest hover:underline"
                    >
                      {t.subject}
                    </Link>
                    <span className="block font-mono text-xs text-muted">{t.number}</span>
                  </Td>
                  <Td>
                    {t.organization?.name}
                    <span className="block text-xs text-muted">{t.product?.name ?? '—'}</span>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        t.priority === 'URGENT' || t.priority === 'HIGH' ? 'terracotta' : 'neutral'
                      }
                    >
                      {SUPPORT_TICKET_PRIORITY_LABELS[t.priority]}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[t.status]}>
                      {SUPPORT_TICKET_STATUS_LABELS[t.status]}
                    </Badge>
                  </Td>
                  <Td>
                    {t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : '—'}
                  </Td>
                  <Td>{formatDateTime(t.lastMessageAt)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
