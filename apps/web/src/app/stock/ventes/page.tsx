'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  STOCK_PAYMENT_METHOD_LABELS,
  type StockPaymentMethod,
  formatStockMoney,
} from '@ocall/shared';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

interface SaleRow {
  id: string;
  label: string;
  total: number;
  discountTotal: number;
  createdAt: string;
  cashierName: string;
  register: { code: string; name: string };
  customer: { id: string; name: string } | null;
  methods: StockPaymentMethod[];
  returnsCount: number;
}

/** Historique des ventes : ticket, réimpression, retours depuis la fiche d'une vente. */
export default function StockSalesPage() {
  return (
    <StockPage title="Ventes" description="Historique des ventes en caisse, tickets et retours.">
      {(p) =>
        p.can('stock.sales.read') ? (
          <Sales {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            L’historique des ventes est réservé aux caissiers et aux responsables.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Sales({ context }: StockPageProps) {
  const [q, setQ] = useState('');
  const list = useApi<SaleRow[]>(
    `/ocall-stock/sales${q.trim() ? `?${new URLSearchParams({ q: q.trim() })}` : ''}`,
  );
  return (
    <>
      <div className="max-w-xs">
        <InputField
          label="Numéro de vente"
          placeholder="VTE-000012"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucune vente.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-sale-list">
              <Table head={['Vente', 'Caisse', 'Client', 'Paiement', 'Total']}>
                {list.data.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link
                        href={`/stock/ventes/${s.id}`}
                        className="font-semibold hover:underline"
                      >
                        {s.label}
                      </Link>
                      <span className="block text-xs text-muted">
                        {new Date(s.createdAt).toLocaleString('fr-FR')} · {s.cashierName}
                      </span>
                    </Td>
                    <Td>{s.register.name}</Td>
                    <Td>{s.customer?.name ?? '—'}</Td>
                    <Td>{s.methods.map((m) => STOCK_PAYMENT_METHOD_LABELS[m]).join(' + ')}</Td>
                    <Td>
                      {formatStockMoney(s.total, context.currency)}
                      {s.returnsCount > 0 && (
                        <span className="ml-2">
                          <Badge tone="savanna">Retour</Badge>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
