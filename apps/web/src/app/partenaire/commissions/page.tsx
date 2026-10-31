'use client';

import { Percent } from 'lucide-react';
import {
  COMMISSION_KIND_LABELS,
  COMMISSION_STATUS_LABELS,
  type CommissionKind,
  type CommissionStatus,
  formatRateBps,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
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
  createdAt: string;
  reversalReason: string | null;
  organization: { name: string };
  product: { name: string };
  payout: { number: string } | null;
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
  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Commissions"
        description="Calculées uniquement sur les sommes réellement encaissées par Ocall, selon votre contrat. Versées manuellement après validation."
      />
      <Card className="mb-6">
        <CardHeader title="Commissions" />
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
            <Table head={['Client', 'Nature', 'Base encaissée', 'Taux', 'Commission', 'Statut']}>
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
        <CardHeader title="Versements" />
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
