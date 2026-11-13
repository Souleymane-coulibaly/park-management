'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  STOCK_SEARCH_GROUPS,
  STOCK_SEARCH_GROUP_LABELS,
  type StockSearchGroup,
  formatStockQuantity,
} from '@ocall/shared';
import {
  type StockSearchHit,
  type StockSearchView,
  stockSearchHref,
} from '@/components/stock/search-box';
import { StockPage } from '@/components/stock/stock-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/**
 * Recherche globale (S1, complétée en S6) : articles (nom, référence, code, disponible par site),
 * catégories, marques, fournisseurs, clients, ventes, commandes, sites et emplacements. Filtre par type
 * (paginé), fautes de frappe tolérées, lien vers chaque fiche.
 */
export default function StockSearchPage() {
  return (
    <StockPage
      title="Recherche"
      description="Sans accents ni majuscules, tolérante aux fautes de frappe."
      searchBox={false}
    >
      {() => (
        <Suspense fallback={<LoadingState />}>
          <Search />
        </Suspense>
      )}
    </StockPage>
  );
}

function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<StockSearchGroup | ''>(
    (params.get('type') as StockSearchGroup | null) ?? '',
  );
  const [page, setPage] = useState(0);
  const term = q.trim();
  const query = new URLSearchParams({
    q: term,
    ...(type ? { type, page: String(page) } : {}),
  });
  const result = useApi<StockSearchView>(term ? `/ocall-stock/search?${query}` : null);

  function choose(next: StockSearchGroup | '') {
    setType(next);
    setPage(0);
    router.replace(
      `/stock/recherche?${new URLSearchParams({ q: term, ...(next ? { type: next } : {}) })}`,
    );
  }

  return (
    <>
      <Card>
        <CardBody className="space-y-3">
          <InputField
            label="Rechercher"
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
              router.replace(
                `/stock/recherche?${new URLSearchParams({ q: e.target.value, ...(type ? { type } : {}) })}`,
              );
            }}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par type">
            {(['', ...STOCK_SEARCH_GROUPS] as const).map((g) => (
              <button
                key={g || 'all'}
                type="button"
                aria-pressed={type === g}
                onClick={() => choose(g)}
                className={`rounded-full border px-3 py-1 text-sm ${type === g ? 'border-forest bg-forest text-white' : 'border-line hover:bg-ivory'}`}
              >
                {g ? STOCK_SEARCH_GROUP_LABELS[g] : 'Tout'}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>
      {term && result.state === 'loading' && <LoadingState />}
      {term && result.state === 'error' && (
        <ErrorState error={result.error} onRetry={result.reload} />
      )}
      {term && result.state === 'success' && (
        <div data-testid="stock-search-results" className="space-y-6">
          {result.data.exact && (
            <Card>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/stock/articles/${result.data.exact.product.id}`}
                  className="font-semibold text-forest underline"
                >
                  {result.data.exact.product.name}
                </Link>
                <span className="text-sm text-muted">{result.data.exact.variant.sku}</span>
              </CardBody>
            </Card>
          )}
          <div className={type ? '' : 'grid gap-6 lg:grid-cols-2'}>
            {(Object.entries(result.data.groups) as [StockSearchGroup, StockSearchHit[]][])
              .filter(([, hits]) => type || hits.length > 0)
              .map(([group, hits]) => (
                <Group
                  key={group}
                  group={group}
                  hits={hits}
                  stock={result.data.stock}
                  more={Boolean(result.data.more[group])}
                  paged={Boolean(type)}
                  page={page}
                  onMore={() => (type ? setPage(page + 1) : choose(group))}
                  onPrevious={() => setPage(Math.max(0, page - 1))}
                />
              ))}
          </div>
          {!type &&
            Object.values(result.data.groups).every((hits) => hits.length === 0) &&
            !result.data.exact && <p className="text-sm text-muted">Aucun résultat.</p>}
        </div>
      )}
    </>
  );
}

function Group({
  group,
  hits,
  stock,
  more,
  paged,
  page,
  onMore,
  onPrevious,
}: {
  group: StockSearchGroup;
  hits: StockSearchHit[];
  stock: StockSearchView['stock'];
  more: boolean;
  paged: boolean;
  page: number;
  onMore: () => void;
  onPrevious: () => void;
}) {
  return (
    <Card>
      <CardHeader title={STOCK_SEARCH_GROUP_LABELS[group]} />
      <CardBody className="space-y-3">
        {hits.length === 0 ? (
          <p className="text-sm text-muted">Aucun résultat.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid={`stock-search-${group}`}>
            {hits.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link
                    href={stockSearchHref(group, h)}
                    className="font-medium text-forest underline"
                  >
                    {h.label}
                  </Link>
                  {h.detail && <span className="text-sm text-muted"> · {h.detail}</span>}
                  {group === 'products' && stock[h.id] && (
                    <span className="block text-xs text-muted">
                      {stock[h.id]!.map(
                        (s) => `${s.site} : ${formatStockQuantity(s.available)} disponible(s)`,
                      ).join(' · ')}
                    </span>
                  )}
                </span>
                {h.isArchived && <Badge>Archivé</Badge>}
              </li>
            ))}
          </ul>
        )}
        {(more || (paged && page > 0)) && (
          <div className="flex gap-2">
            {paged && page > 0 && (
              <Button size="sm" variant="secondary" onClick={onPrevious}>
                Précédents
              </Button>
            )}
            {more && (
              <Button size="sm" variant="secondary" onClick={onMore}>
                {paged ? 'Suivants' : 'Voir tout'}
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
