'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatStockQuantity } from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import {
  type Paged,
  type StockLevelRow,
  type StockSiteView,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

const PAGE_SIZE = 50;

/** Stocks par site : en stock, réservé (transferts préparés), disponible, en transit, seuil d'alerte. */
export default function StockLevelsPage() {
  return (
    <StockPage
      title="Stocks"
      description="Quantités par site : disponibles, réservées et en transit."
    >
      {({ can }) =>
        can('stock.levels.read') ? (
          <Levels />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Demandez l’accès aux stocks à un administrateur.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Levels() {
  const [siteId, setSiteId] = useState('');
  const [q, setQ] = useState('');
  const [belowMin, setBelowMin] = useState(false);
  const [page, setPage] = useState(1);
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    belowMin: String(belowMin),
    ...(siteId ? { siteId } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  });
  const levels = useApi<Paged<StockLevelRow>>(`/ocall-stock/levels?${query}`);
  const pages =
    levels.state === 'success' ? Math.max(1, Math.ceil(levels.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <SelectField
            label="Site"
            value={siteId}
            onChange={(e) => (setSiteId(e.target.value), setPage(1))}
            options={[
              { value: '', label: 'Tous les sites' },
              ...(sites.state === 'success'
                ? sites.data.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))
                : []),
            ]}
          />
          <div className="min-w-48 flex-1">
            <InputField
              label="Rechercher (nom, référence, code)"
              value={q}
              onChange={(e) => (setQ(e.target.value), setPage(1))}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={belowMin}
              onChange={(e) => (setBelowMin(e.target.checked), setPage(1))}
            />
            Sous le seuil d’alerte
          </label>
        </CardBody>
      </Card>
      {levels.state === 'loading' && <LoadingState />}
      {levels.state === 'error' && <ErrorState error={levels.error} onRetry={levels.reload} />}
      {levels.state === 'success' && (
        <Card>
          {levels.data.items.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun stock à afficher.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-level-list">
              <Table
                head={['Article', 'Site', 'En stock', 'Réservé', 'Disponible', 'En transit', '']}
              >
                {levels.data.items.map((l) => (
                  <tr key={`${l.site.id}:${l.variant.id}`}>
                    <Td>
                      <Link
                        href={`/stock/articles/${l.variant.product.id}`}
                        className="font-semibold hover:underline"
                      >
                        {variantLabel(l.variant)}
                      </Link>
                      <span className="block font-mono text-xs text-muted">{l.variant.sku}</span>
                    </Td>
                    <Td>{l.site.code}</Td>
                    <Td>{formatStockQuantity(l.onHand)}</Td>
                    <Td>{formatStockQuantity(l.reserved)}</Td>
                    <Td className="font-semibold">{formatStockQuantity(l.available)}</Td>
                    <Td>{l.inTransit ? formatStockQuantity(l.inTransit) : '—'}</Td>
                    <Td className="text-right">
                      {l.belowMin && (
                        <Badge tone="terracotta">
                          Sous le seuil ({formatStockQuantity(l.minStock ?? 0)})
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {pages > 1 && (
            <CardBody className="flex items-center justify-between gap-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </Button>
              <span className="text-sm text-muted">
                Page {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </CardBody>
          )}
        </Card>
      )}
    </>
  );
}
