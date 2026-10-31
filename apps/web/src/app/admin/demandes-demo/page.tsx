'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { DEMO_REQUEST_STATUS_LABELS, type DemoRequestStatus } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface DemoRequestRow {
  id: string;
  number: string;
  name: string;
  company: string;
  country: string;
  phone: string;
  email: string;
  message: string;
  status: DemoRequestStatus;
  notes: string | null;
  createdAt: string;
  product: { code: string; name: string } | null;
}

const TONE: Record<DemoRequestStatus, 'savanna' | 'forest' | 'terracotta' | 'neutral'> = {
  NEW: 'savanna',
  CONTACTED: 'neutral',
  DEMO_SCHEDULED: 'neutral',
  WON: 'forest',
  LOST: 'terracotta',
  SPAM: 'terracotta',
};

const statusOptions = Object.entries(DEMO_REQUEST_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * Demandes de démonstration du site public (Sprint 12A). Une demande ne crée jamais d'abonnement ;
 * elle est conservée 24 mois puis anonymisée. Aucun e-mail n'est envoyé : suivi ici uniquement.
 */
export default function DemoRequestsPage() {
  const [status, setStatus] = useState('NEW');
  const [error, setError] = useState<ApiError | null>(null);
  const rows = useApi<DemoRequestRow[]>(
    `/platform/demo-requests${status ? `?status=${status}` : ''}`,
  );

  async function update(id: string, next: DemoRequestStatus) {
    setError(null);
    try {
      await api(`/platform/demo-requests/${id}`, { method: 'PATCH', body: { status: next } });
      rows.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Demandes de démonstration"
        description="Demandes reçues depuis le site Ocall Suite. Contactez le prospect, puis mettez à jour le statut. Données conservées 24 mois, puis anonymisées."
      />
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title="Demandes"
          action={
            <div className="w-56">
              <SelectField
                label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[{ value: '', label: 'Toutes' }, ...statusOptions]}
              />
            </div>
          }
        />
        {rows.state === 'loading' && <LoadingState />}
        {rows.state === 'error' && <ErrorState error={rows.error} onRetry={rows.reload} />}
        {rows.state === 'success' &&
          (rows.data.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="Aucune demande"
              description="Les demandes du formulaire public apparaîtront ici."
            />
          ) : (
            <Table head={['Demande', 'Contact', 'Produit', 'Message', 'Statut']}>
              {rows.data.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">
                    {d.company}
                    <span className="block text-xs text-muted">
                      {d.number} · {formatDateTime(d.createdAt)} · {d.country}
                    </span>
                  </Td>
                  <Td>
                    {d.name}
                    <span className="block text-xs text-muted">
                      <a className="underline" href={`tel:${d.phone.replace(/\s/g, '')}`}>
                        {d.phone}
                      </a>{' '}
                      ·{' '}
                      <a className="underline" href={`mailto:${d.email}`}>
                        {d.email}
                      </a>
                    </span>
                  </Td>
                  <Td>{d.product?.name ?? '—'}</Td>
                  <Td className="max-w-xs whitespace-pre-line text-sm">{d.message}</Td>
                  <Td>
                    <div className="space-y-2">
                      <Badge tone={TONE[d.status]}>{DEMO_REQUEST_STATUS_LABELS[d.status]}</Badge>
                      <SelectField
                        label="Changer"
                        value={d.status}
                        onChange={(e) => update(d.id, e.target.value as DemoRequestStatus)}
                        options={statusOptions}
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
