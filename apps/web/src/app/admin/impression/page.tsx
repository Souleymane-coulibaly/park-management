'use client';

import { useState } from 'react';
import {
  PRINT_ORDER_STATUSES,
  PRINT_ORDER_STATUS_LABELS,
  type PrintOrderStatus,
  formatXof,
} from '@ocall/shared';
import { OrdersTable } from '@/components/print/print-orders';
import type { PrintOrderSummaryView } from '@/components/print/print-types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

interface OverviewRow {
  status: PrintOrderStatus;
  paymentStatus: 'UNPAID' | 'PAID';
  orders: number;
  cards: number;
  totalAmount: number;
  paidAmount: number;
}

/** Supervision centrale (propriétaire, administrateurs) : commandes, cartes, encaissé et restant dû. */
function Overview() {
  const overview = useApi<OverviewRow[]>('/platform/print/overview');
  if (overview.state !== 'success') return null;
  const rows = overview.data;
  const live = rows.filter((r) => r.status !== 'CANCELLED' && r.status !== 'REJECTED');
  const due = live
    .filter((r) => r.paymentStatus === 'UNPAID')
    .reduce((s, r) => s + r.totalAmount, 0);
  const paid = rows.reduce((s, r) => s + r.paidAmount, 0);
  const cards = live.reduce((s, r) => s + r.cards, 0);
  return (
    <Card>
      <CardHeader title="Supervision" description="Toutes organisations confondues." />
      <CardBody className="space-y-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Cartes commandées (hors annulées)</dt>
            <dd className="text-lg font-semibold tabular-nums">{cards}</dd>
          </div>
          <div>
            <dt className="text-muted">Encaissé (espèces)</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatXof(paid)}</dd>
          </div>
          <div>
            <dt className="text-muted">Reste à encaisser</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatXof(due)}</dd>
          </div>
        </dl>
        <Table head={['État', 'Règlement', 'Commandes', 'Cartes', 'Montant']}>
          {rows.map((r) => (
            <tr key={`${r.status}-${r.paymentStatus}`}>
              <Td>{PRINT_ORDER_STATUS_LABELS[r.status]}</Td>
              <Td>{r.paymentStatus === 'PAID' ? 'Réglée' : 'À régler'}</Td>
              <Td>{r.orders}</Td>
              <Td>{r.cards}</Td>
              <Td>{formatXof(r.totalAmount)}</Td>
            </tr>
          ))}
        </Table>
      </CardBody>
    </Card>
  );
}

export default function AdminPrintPage() {
  const [status, setStatus] = useState<'' | PrintOrderStatus>('');
  const orders = useApi<PrintOrderSummaryView[]>(
    `/platform/print/orders${status ? `?status=${status}` : ''}`,
  );
  const me = useApi<{ platformPermissions: string[] }>('/auth/me');
  const supervise =
    me.state === 'success' && me.data.platformPermissions.includes('platform.print.supervise');
  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Atelier d’impression"
        description="Commandes de cartes de toutes les organisations : production à Bamako, livraison, encaissement en espèces."
      />
      <div className="space-y-6">
        {supervise && <Overview />}
        <div className="w-full sm:w-64">
          <SelectField
            label="État"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | PrintOrderStatus)}
            options={[
              { value: '', label: 'File de travail (en cours)' },
              ...PRINT_ORDER_STATUSES.map((s) => ({
                value: s,
                label: PRINT_ORDER_STATUS_LABELS[s],
              })),
            ]}
          />
        </div>
        {orders.state === 'loading' && <LoadingState />}
        {orders.state === 'error' && <ErrorState error={orders.error} onRetry={orders.reload} />}
        {orders.state === 'success' && (
          <Card>
            <OrdersTable
              orders={orders.data}
              showOrganization
              hrefFor={(o) => `/admin/impression/${o.id}`}
            />
          </Card>
        )}
      </div>
    </>
  );
}
