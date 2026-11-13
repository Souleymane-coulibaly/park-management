'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { STOCK_TRANSFER_STATUS_LABELS } from '@ocall/shared';
import { VariantPicker } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockSiteView,
  type StockVariantRef,
  asApiError,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface TransferRow {
  id: string;
  label: string;
  status: string;
  createdAt: string;
  fromSite: { code: string; name: string };
  toSite: { code: string; name: string };
  _count: { lines: number };
}

/** Transferts entre sites : demandés, préparés, expédiés (en transit), reçus. */
export default function StockTransfersPage() {
  return (
    <StockPage
      title="Transferts"
      description="Marchandises entre vos sites, suivies jusqu’à la réception."
    >
      {(p) => <Transfers {...p} />}
    </StockPage>
  );
}

function Transfers({ canWrite }: StockPageProps) {
  const [open, setOpen] = useState(true);
  const list = useApi<TransferRow[]>(`/ocall-stock/transfers?open=${open}`);
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
        En cours seulement
      </label>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun transfert.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-transfer-list">
              <Table head={['Transfert', 'De', 'Vers', 'Lignes', 'État']}>
                {list.data.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link
                        href={`/stock/transferts/${t.id}`}
                        className="font-semibold hover:underline"
                      >
                        {t.label}
                      </Link>
                      <span className="block text-xs text-muted">
                        {new Date(t.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </Td>
                    <Td>{t.fromSite.code}</Td>
                    <Td>{t.toSite.code}</Td>
                    <Td>{t._count.lines}</Td>
                    <Td>
                      <Badge
                        tone={
                          t.status === 'RECEIVED'
                            ? 'forest'
                            : t.status === 'CANCELLED'
                              ? 'neutral'
                              : 'savanna'
                        }
                      >
                        {STOCK_TRANSFER_STATUS_LABELS[t.status]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canWrite('stock.transfers.manage') && <NewTransfer />}
    </>
  );
}

function NewTransfer() {
  const router = useRouter();
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const [fromSiteId, setFrom] = useState('');
  const [toSiteId, setTo] = useState('');
  const [lines, setLines] = useState<{ variant: StockVariantRef; quantity: string }[]>([]);
  const [picking, setPicking] = useState<StockVariantRef | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Sites du périmètre du demandeur (un administrateur les voit tous).
  const options =
    sites.state === 'success'
      ? sites.data.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
      : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const t = await api<{ id: string }>('/ocall-stock/transfers', {
        method: 'POST',
        body: {
          fromSiteId,
          toSiteId,
          lines: lines.map((l) => ({ variantId: l.variant.id, quantity: Number(l.quantity) })),
        },
      });
      router.push(`/stock/transferts/${t.id}`);
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Nouveau transfert" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-transfer-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Site de départ"
              value={fromSiteId}
              onChange={(e) => setFrom(e.target.value)}
              options={[{ value: '', label: 'Choisir…' }, ...options]}
            />
            <SelectField
              label="Site d’arrivée"
              value={toSiteId}
              onChange={(e) => setTo(e.target.value)}
              options={[{ value: '', label: 'Choisir…' }, ...options]}
            />
          </div>
          <VariantPicker
            value={picking}
            label="Article à transférer"
            onChange={(v) => {
              if (v && !lines.some((l) => l.variant.id === v.id))
                setLines((cur) => [...cur, { variant: v, quantity: '1' }]);
              setPicking(null);
            }}
          />
          {lines.length > 0 && (
            <Table head={['Article', 'Quantité', '']}>
              {lines.map((l) => (
                <tr key={l.variant.id}>
                  <Td>{variantLabel(l.variant)}</Td>
                  <Td>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Quantité de ${variantLabel(l.variant)}`}
                      className="w-28 rounded-lg border border-line px-2 py-1"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((cur) =>
                          cur.map((x) =>
                            x.variant.id === l.variant.id ? { ...x, quantity: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      className="text-xs text-terracotta hover:underline"
                      onClick={() =>
                        setLines((cur) => cur.filter((x) => x.variant.id !== l.variant.id))
                      }
                    >
                      Retirer
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <Button type="submit" disabled={!fromSiteId || !toSiteId || lines.length === 0}>
            Demander le transfert
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
