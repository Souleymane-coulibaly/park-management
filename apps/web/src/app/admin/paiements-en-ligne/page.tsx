'use client';

import { useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

type OnlineStatus =
  'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVIEW_REQUIRED' | 'REFUNDED';

interface OnlinePaymentRow {
  id: string;
  reference: string;
  provider: 'SIMULATED' | 'CINETPAY';
  amount: number;
  currency: string;
  channels: string;
  status: OnlineStatus;
  paymentMethod: string | null;
  failureCode: string | null;
  createdAt: string;
  confirmedAt: string | null;
  invoice: { number: string; status: string };
  organization: { name: string };
}

const LABELS: Record<OnlineStatus, string> = {
  CREATED: 'Créé',
  PENDING: 'En attente du prestataire',
  SUCCEEDED: 'Réussi (vérifié)',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
  REVIEW_REQUIRED: 'À examiner',
  REFUNDED: 'Remboursé',
};
const TONE: Record<OnlineStatus, 'savanna' | 'forest' | 'terracotta' | 'neutral'> = {
  CREATED: 'neutral',
  PENDING: 'savanna',
  SUCCEEDED: 'forest',
  FAILED: 'neutral',
  CANCELLED: 'neutral',
  REVIEW_REQUIRED: 'terracotta',
  REFUNDED: 'terracotta',
};

/**
 * Paiements en ligne des factures (Sprint 12A). Seule une vérification serveur auprès du
 * prestataire confirme un paiement ; un paiement incohérent passe « à examiner » sans encaissement.
 */
export default function OnlinePaymentsPage() {
  const canRecheck = useCanPlatform('platform.billing.validate');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const rows = useApi<OnlinePaymentRow[]>(
    `/platform/online-payments${status ? `?status=${status}` : ''}`,
  );

  async function recheck(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/platform/online-payments/${id}/recheck`, { method: 'POST' });
      rows.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Paiements en ligne"
        description="Tentatives de paiement des factures par carte ou mobile money. Un paiement réussi crée un règlement confirmé ; l’activation suit le mode de l’abonnement."
      />
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title="Transactions"
          action={
            <div className="w-56">
              <SelectField
                label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: 'Tous' },
                  ...Object.entries(LABELS).map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>
          }
        />
        {rows.state === 'loading' && <LoadingState />}
        {rows.state === 'error' && <ErrorState error={rows.error} onRetry={rows.reload} />}
        {rows.state === 'success' &&
          (rows.data.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-7 w-7" />}
              title="Aucun paiement en ligne"
              description="Les paiements lancés par les clients apparaîtront ici."
            />
          ) : (
            <Table head={['Organisation', 'Facture', 'Montant', 'Statut', 'Créé', '']}>
              {rows.data.map((o) => (
                <tr key={o.id}>
                  <Td className="font-medium">
                    {o.organization.name}
                    <span className="block text-xs text-muted">
                      {o.reference} · {o.provider === 'SIMULATED' ? 'simulé' : 'CinetPay'}
                    </span>
                  </Td>
                  <Td>{o.invoice.number}</Td>
                  <Td className="tabular-nums">{formatXof(o.amount)}</Td>
                  <Td>
                    <Badge tone={TONE[o.status]}>{LABELS[o.status]}</Badge>
                    {(o.paymentMethod || o.failureCode) && (
                      <span className="block text-xs text-muted">
                        {o.paymentMethod ?? o.failureCode}
                      </span>
                    )}
                  </Td>
                  <Td>{formatDateTime(o.createdAt)}</Td>
                  <Td>
                    {canRecheck && (o.status === 'PENDING' || o.status === 'CREATED') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RefreshCw className="h-4 w-4" />}
                        loading={busy === o.id}
                        onClick={() => recheck(o.id)}
                      >
                        Revérifier
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
