'use client';

import { useState } from 'react';
import { CreditCard, FileText } from 'lucide-react';
import { INVOICE_STATUS_LABELS, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

export interface ClientInvoice {
  id: string;
  number: string;
  status: 'ISSUED' | 'PAID' | 'CANCELLED';
  currency: string;
  total: number;
  remaining: number;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  product: string;
  payableOnline: boolean;
  lastOnlinePayment: { reference: string; status: string } | null;
}

const CHANNELS = [
  { value: 'ALL', label: 'Carte ou mobile money' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'CREDIT_CARD', label: 'Carte bancaire' },
];

/**
 * Factures Ocall de l'organisation et paiement en ligne (Sprint 12A). Le paiement se fait sur la
 * page sécurisée du prestataire ; la confirmation vient uniquement de la vérification serveur.
 */
export function ClientInvoices() {
  const canPay = useCan('subscription.pay');
  const invoices = useApi<ClientInvoice[]>('/billing/invoices');
  const [channels, setChannels] = useState('ALL');
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function pay(invoiceId: string) {
    setPaying(invoiceId);
    setError(null);
    try {
      const { paymentUrl } = await api<{ reference: string; paymentUrl: string }>(
        '/billing/online-payments',
        { method: 'POST', body: { invoiceId, channels } },
      );
      window.location.assign(paymentUrl);
    } catch (e) {
      setError(e as ApiError);
      setPaying(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Factures Ocall"
        description="Réglez en ligne (carte ou mobile money) ou auprès d’Ocall (virement, espèces contre reçu)."
        action={
          canPay ? (
            <div className="w-56">
              <SelectField
                label="Moyen en ligne"
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                options={CHANNELS}
              />
            </div>
          ) : undefined
        }
      />
      <div className="px-5 pb-2">
        <ApiErrorAlert error={error} />
      </div>
      {invoices.state === 'loading' && <LoadingState />}
      {invoices.state === 'error' && (
        <ErrorState error={invoices.error} onRetry={invoices.reload} />
      )}
      {invoices.state === 'success' &&
        (invoices.data.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="Aucune facture"
            description="Vos factures Ocall apparaîtront ici."
          />
        ) : (
          <Table head={['Facture', 'Montant', 'Reste dû', 'Échéance', 'Statut', '']}>
            {invoices.data.map((i) => (
              <tr key={i.id} data-testid="client-invoice">
                <Td className="font-medium">
                  {i.number}
                  <span className="block text-xs text-muted">
                    {i.product} · émise le {formatDate(i.issuedAt)}
                  </span>
                </Td>
                <Td className="tabular-nums">{formatXof(i.total)}</Td>
                <Td className="tabular-nums">
                  {i.status === 'ISSUED' ? formatXof(i.remaining) : '—'}
                </Td>
                <Td>{formatDate(i.dueAt)}</Td>
                <Td>
                  <Badge
                    tone={
                      i.status === 'PAID' ? 'forest' : i.status === 'ISSUED' ? 'savanna' : 'neutral'
                    }
                  >
                    {INVOICE_STATUS_LABELS[i.status]}
                  </Badge>
                </Td>
                <Td>
                  {canPay && i.payableOnline && (
                    <Button
                      size="sm"
                      icon={<CreditCard className="h-4 w-4" />}
                      loading={paying === i.id}
                      onClick={() => pay(i.id)}
                    >
                      Payer en ligne
                    </Button>
                  )}
                  {i.status === 'ISSUED' && !i.payableOnline && i.remaining === 0 && (
                    <span className="text-xs text-muted">Règlement en cours de vérification</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ))}
    </Card>
  );
}
