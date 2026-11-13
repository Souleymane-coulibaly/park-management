'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { STOCK_COUNT_SCOPE_LABELS, STOCK_COUNT_STATUS_LABELS } from '@ocall/shared';
import { useSiteLocations } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { type StockSiteView, asApiError } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface CountRow {
  id: string;
  label: string;
  name: string;
  scope: string;
  status: string;
  createdAt: string;
  site: { code: string; name: string };
  _count: { lines: number };
}

/** Inventaires : complets ou partiels, par site ou par emplacements. */
export default function StockCountsPage() {
  return (
    <StockPage
      title="Inventaires"
      description="Comptez, comparez, puis validez : l’écart est calculé à la validation."
    >
      {(p) => <Counts {...p} />}
    </StockPage>
  );
}

function Counts({ canWrite }: StockPageProps) {
  const list = useApi<CountRow[]>('/ocall-stock/counts');
  return (
    <>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun inventaire.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-count-list">
              <Table head={['Inventaire', 'Site', 'Type', 'Lignes', 'État']}>
                {list.data.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link
                        href={`/stock/inventaires/${c.id}`}
                        className="font-semibold hover:underline"
                      >
                        {c.label}
                      </Link>
                      <span className="block text-xs text-muted">{c.name}</span>
                    </Td>
                    <Td>{c.site.code}</Td>
                    <Td className="text-xs">{STOCK_COUNT_SCOPE_LABELS[c.scope]}</Td>
                    <Td>{c._count.lines}</Td>
                    <Td>
                      <Badge
                        tone={
                          c.status === 'VALIDATED'
                            ? 'forest'
                            : c.status === 'OPEN'
                              ? 'savanna'
                              : 'neutral'
                        }
                      >
                        {STOCK_COUNT_STATUS_LABELS[c.status]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canWrite('stock.counts.count') && <NewCount />}
    </>
  );
}

function NewCount() {
  const router = useRouter();
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'FULL' | 'PARTIAL'>('PARTIAL');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const { locations } = useSiteLocations(siteId || null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const c = await api<{ id: string }>('/ocall-stock/counts', {
        method: 'POST',
        body: { siteId, name, scope, locationIds },
      });
      router.push(`/stock/inventaires/${c.id}`);
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Nouvel inventaire"
        description="Conseil : comptez zone par zone, et validez chaque zone dès qu’elle est comptée."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-count-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Site"
              value={siteId}
              onChange={(e) => (setSiteId(e.target.value), setLocationIds([]))}
              options={[
                { value: '', label: 'Choisir…' },
                ...(sites.state === 'success'
                  ? sites.data.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
                  : []),
              ]}
            />
            <InputField
              label="Nom"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <SelectField
              label="Type"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'FULL' | 'PARTIAL')}
              options={[
                { value: 'PARTIAL', label: STOCK_COUNT_SCOPE_LABELS.PARTIAL! },
                { value: 'FULL', label: STOCK_COUNT_SCOPE_LABELS.FULL! },
              ]}
            />
          </div>
          {locations.length > 0 && (
            <fieldset className="grid gap-2 text-sm sm:grid-cols-3">
              <legend className="mb-1 font-medium">
                Emplacements (aucun coché = tout le site)
              </legend>
              {locations.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={locationIds.includes(l.id)}
                    onChange={(e) =>
                      setLocationIds((cur) =>
                        e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id),
                      )
                    }
                  />
                  {l.code} · {l.name}
                </label>
              ))}
            </fieldset>
          )}
          <Button type="submit" disabled={!siteId || name.trim().length < 2}>
            Ouvrir l’inventaire
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
