'use client';

import { useState } from 'react';
import { HandCoins, Percent } from 'lucide-react';
import {
  COMMISSION_KIND_LABELS,
  COMMISSION_STATUS_LABELS,
  type CommissionKind,
  type CommissionStatus,
  PAYOUT_REQUEST_STATUS_LABELS,
  formatRateBps,
  formatXof,
} from '@ocall/shared';
import { BalanceCard, type PartnerBalance } from '@/components/partner/balance-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { Table, Td } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface CommissionRow {
  id: string;
  kind: CommissionKind;
  baseAmount: number;
  rateBps: number;
  amount: number;
  status: CommissionStatus;
  payableFrom: string | null;
  createdAt: string;
  reversalReason: string | null;
  organization: { name: string };
  product: { name: string };
  payout: { number: string } | null;
}
interface PayoutRequestRow {
  id: string;
  amount: number;
  status: keyof typeof PAYOUT_REQUEST_STATUS_LABELS;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  payout: { number: string; paidAt: string } | null;
}
interface PayoutRow {
  number: string;
  total: number;
  method: string;
  reference: string | null;
  paidAt: string;
}

const TONE: Record<CommissionStatus, 'savanna' | 'forest' | 'terracotta' | 'neutral'> = {
  ACCRUED: 'savanna',
  VALIDATED: 'neutral',
  REVERSED: 'terracotta',
  PAID: 'forest',
};

/**
 * Commissions et versements. Une commission n'existe que sur un encaissement confirmé ; elle est
 * validée puis versée manuellement par Ocall (aucun versement automatique).
 */
export default function PartnerCommissionsPage() {
  const commissions = useApi<CommissionRow[]>('/partner/commissions');
  const payouts = useApi<PayoutRow[]>('/partner/payouts');
  const balance = useApi<PartnerBalance>('/partner/balance');
  const requests = useApi<PayoutRequestRow[]>('/partner/payout-requests');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const pending =
    requests.state === 'success' ? requests.data.find((r) => r.status === 'PENDING') : undefined;

  const reloadAll = () => {
    balance.reload();
    requests.reload();
  };
  async function request() {
    setBusy(true);
    setError(null);
    try {
      await api('/partner/payout-requests', { method: 'POST', body: {} });
      reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/partner/payout-requests/${id}/cancel`, { method: 'POST' });
      reloadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Primes et règlements"
        description="Primes calculées uniquement sur les sommes réellement encaissées par Ocall, selon votre contrat ; règlement manuel à la fin du mois suivant l’encaissement."
      />
      {balance.state === 'loading' && <LoadingState />}
      {balance.state === 'error' && <ErrorState error={balance.error} onRetry={balance.reload} />}
      {balance.state === 'success' && (
        <BalanceCard
          balance={balance.data}
          action={
            pending ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void cancel(pending.id)}
              >
                Annuler ma demande ({formatXof(pending.amount)})
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || balance.data.payable <= 0}
                onClick={() => void request()}
              >
                <HandCoins className="h-4 w-4" aria-hidden /> Demander le règlement
              </Button>
            )
          }
        />
      )}
      <ApiErrorAlert error={error} />
      {requests.state === 'success' && requests.data.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Mes demandes de règlement" />
          <Table head={['Demandée le', 'Montant', 'Statut', 'Règlement']}>
            {requests.data.map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.createdAt)}</Td>
                <Td className="tabular-nums font-semibold">{formatXof(r.amount)}</Td>
                <Td>
                  {PAYOUT_REQUEST_STATUS_LABELS[r.status]}
                  {r.status === 'REJECTED' && r.decisionNote && (
                    <span className="block text-xs text-muted">{r.decisionNote}</span>
                  )}
                </Td>
                <Td>{r.payout ? `${r.payout.number} · ${formatDate(r.payout.paidAt)}` : '—'}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <Card className="mb-6">
        <CardHeader title="Détail des primes" />
        {commissions.state === 'loading' && <LoadingState />}
        {commissions.state === 'error' && (
          <ErrorState error={commissions.error} onRetry={commissions.reload} />
        )}
        {commissions.state === 'success' &&
          (commissions.data.length === 0 ? (
            <EmptyState
              icon={<Percent className="h-7 w-7" />}
              title="Aucune commission"
              description="Elles apparaissent dès qu’un client apporté règle Ocall."
            />
          ) : (
            <Table
              head={[
                'Client',
                'Nature',
                'Base encaissée',
                'Taux',
                'Prime',
                'Règlement prévu',
                'Statut',
              ]}
            >
              {commissions.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">
                    {c.organization.name}
                    <span className="block text-xs text-muted">
                      {c.product.name} · {formatDate(c.createdAt)}
                    </span>
                  </Td>
                  <Td>{COMMISSION_KIND_LABELS[c.kind]}</Td>
                  <Td className="tabular-nums">
                    {c.kind === 'ADJUSTMENT' ? '—' : formatXof(c.baseAmount)}
                  </Td>
                  <Td>{c.kind === 'ADJUSTMENT' ? '—' : formatRateBps(c.rateBps)}</Td>
                  <Td className="tabular-nums font-semibold">{formatXof(c.amount)}</Td>
                  <Td>{c.status === 'REVERSED' ? '—' : formatDate(c.payableFrom)}</Td>
                  <Td>
                    <Badge tone={TONE[c.status]}>{COMMISSION_STATUS_LABELS[c.status]}</Badge>
                    {c.payout && (
                      <span className="block text-xs text-muted">{c.payout.number}</span>
                    )}
                    {c.reversalReason && (
                      <span className="block text-xs text-muted">{c.reversalReason}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <Card>
        <CardHeader title="Règlements reçus" />
        {payouts.state === 'loading' && <LoadingState />}
        {payouts.state === 'error' && <ErrorState error={payouts.error} onRetry={payouts.reload} />}
        {payouts.state === 'success' &&
          (payouts.data.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted">Aucun versement pour le moment.</p>
          ) : (
            <Table head={['Versement', 'Date', 'Moyen', 'Montant']}>
              {payouts.data.map((v) => (
                <tr key={v.number}>
                  <Td className="font-medium">{v.number}</Td>
                  <Td>{formatDate(v.paidAt)}</Td>
                  <Td>
                    {v.method}
                    {v.reference ? ` · ${v.reference}` : ''}
                  </Td>
                  <Td className="tabular-nums font-semibold">{formatXof(v.total)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}
