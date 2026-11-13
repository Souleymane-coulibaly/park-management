'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  STOCK_PAYMENT_METHODS,
  STOCK_PAYMENT_METHOD_LABELS,
  type StockPaymentMethod,
  formatStockMoney,
} from '@ocall/shared';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { asApiError } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SessionView {
  id: string;
  label: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  differenceReason: string | null;
  register: { id: string; code: string; name: string };
  summary: {
    salesCount: number;
    returnsCount: number;
    salesTotal: number;
    discountTotal: number;
    received: Record<StockPaymentMethod, number>;
    refunded: Record<StockPaymentMethod, number>;
    expectedCash: number;
  };
  sales: { id: string; label: string; total: number; createdAt: string; cashierName: string }[];
}

/** Rapport d'une session de caisse et clôture (espèces comptées, écart motivé). */
export default function StockCashSessionPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <StockPage title="Session de caisse" description="Encaissements, remboursements et clôture.">
      {(p) => <Session id={id} page={p} />}
    </StockPage>
  );
}

function Session({ id, page }: { id: string; page: StockPageProps }) {
  const session = useApi<SessionView>(`/ocall-stock/cash-sessions/${id}`);
  const money = (n: number) => formatStockMoney(n, page.context.currency);
  if (session.state === 'loading') return <LoadingState />;
  if (session.state === 'error')
    return <ErrorState error={session.error} onRetry={session.reload} />;
  const s = session.data;
  return (
    <>
      <Card>
        <CardHeader
          title={`${s.label} · ${s.register.name}`}
          description={`Ouverte le ${new Date(s.openedAt).toLocaleString('fr-FR')}${s.openedBy ? ` par ${s.openedBy}` : ''}${s.closedAt ? ` · clôturée le ${new Date(s.closedAt).toLocaleString('fr-FR')}${s.closedBy ? ` par ${s.closedBy}` : ''}` : ''}`}
        />
        <CardBody className="space-y-4" data-testid="stock-session-report">
          <div>
            {s.status === 'OPEN' ? <Badge tone="forest">Ouverte</Badge> : <Badge>Clôturée</Badge>}
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <Stat label="Ventes" value={String(s.summary.salesCount)} />
            <Stat label="Chiffre d’affaires TTC" value={money(s.summary.salesTotal)} />
            <Stat label="Remises" value={money(s.summary.discountTotal)} />
            <Stat label="Retours" value={String(s.summary.returnsCount)} />
          </dl>
          <Table head={['Moyen', 'Encaissé', 'Remboursé']}>
            {STOCK_PAYMENT_METHODS.map((m) => (
              <tr key={m}>
                <Td>{STOCK_PAYMENT_METHOD_LABELS[m]}</Td>
                <Td>{money(s.summary.received[m])}</Td>
                <Td>{s.summary.refunded[m] ? `-${money(s.summary.refunded[m])}` : '—'}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-sm">
            Fond de caisse {money(s.openingFloat)} · espèces attendues dans le tiroir :{' '}
            <span className="font-semibold" data-testid="stock-expected-cash">
              {money(s.status === 'CLOSED' ? (s.expectedCash ?? 0) : s.summary.expectedCash)}
            </span>
          </p>
          {s.status === 'CLOSED' && (
            <p className="text-sm" data-testid="stock-session-difference">
              Espèces comptées {money(s.countedCash ?? 0)} · écart{' '}
              <span className="font-semibold">
                {(s.difference ?? 0) > 0 ? '+' : ''}
                {money(s.difference ?? 0)}
              </span>
              {s.differenceReason ? ` · ${s.differenceReason}` : ''}
            </p>
          )}
        </CardBody>
      </Card>
      {s.status === 'OPEN' && page.canWrite('stock.cash.session') && (
        <Close session={s} currency={page.context.currency} onClosed={session.reload} />
      )}
      {s.sales.length > 0 && (
        <Card>
          <CardHeader title="Ventes de la session" />
          <Table head={['Vente', 'Caissier', 'Total']}>
            {s.sales.map((v) => (
              <tr key={v.id}>
                <Td>
                  <Link href={`/stock/ventes/${v.id}`} className="font-semibold hover:underline">
                    {v.label}
                  </Link>
                  <span className="block text-xs text-muted">
                    {new Date(v.createdAt).toLocaleTimeString('fr-FR')}
                  </span>
                </Td>
                <Td>{v.cashierName}</Td>
                <Td>{money(v.total)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ivory-dark/50 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  );
}

function Close({
  session,
  currency,
  onClosed,
}: {
  session: SessionView;
  currency: string;
  onClosed: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const difference = counted === '' ? null : Number(counted) - session.summary.expectedCash;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/ocall-stock/cash-sessions/${session.id}/close`, {
        method: 'POST',
        body: { countedCash: Number(counted), differenceReason: reason || null },
      });
      onClosed();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Clôturer la caisse"
        description="Comptez les espèces du tiroir. Un écart est enregistré avec son motif et figure au rapport."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-close-session">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Espèces comptées"
              type="number"
              min={0}
              required
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
            {difference !== null && difference !== 0 && (
              <InputField
                label="Motif de l’écart"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </div>
          {difference !== null && (
            <p className="text-sm">
              Écart :{' '}
              <span className="font-semibold">
                {difference > 0 ? '+' : ''}
                {formatStockMoney(difference, currency)}
              </span>
            </p>
          )}
          <Button
            type="submit"
            disabled={counted === '' || (difference !== 0 && reason.trim().length < 3)}
          >
            Clôturer
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
