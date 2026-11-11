'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { StockPage } from '@/components/stock/stock-page';
import type { StockLookup } from '@/components/stock/stock-types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface SearchView {
  exact: Extract<StockLookup, { found: true }> | null;
  products: { id: string; sku: string; name: string; isArchived: boolean }[];
  categories: { id: string; name: string; isArchived: boolean }[];
  brands: { id: string; name: string; isArchived: boolean }[];
  suppliers: { id: string; name: string; isArchived: boolean }[];
}

/** Recherche globale : articles (nom, référence, code), catégories, marques, fournisseurs. */
export default function StockSearchPage() {
  return (
    <StockPage
      title="Recherche"
      description="Sans accents ni majuscules, tolérante aux fautes de frappe."
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
  const term = q.trim();
  const result = useApi<SearchView>(
    term ? `/ocall-stock/search?q=${encodeURIComponent(term)}` : null,
  );

  return (
    <>
      <Card>
        <CardBody>
          <InputField
            label="Rechercher"
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              router.replace(`/stock/recherche?q=${encodeURIComponent(e.target.value)}`);
            }}
          />
        </CardBody>
      </Card>
      {term && result.state === 'loading' && <LoadingState />}
      {term && result.state === 'error' && (
        <ErrorState error={result.error} onRetry={result.reload} />
      )}
      {term && result.state === 'success' && (
        <div className="grid gap-6 lg:grid-cols-2" data-testid="stock-search-results">
          {result.data.exact && (
            <Card>
              <CardHeader title="Code reconnu" />
              <CardBody>
                <Link
                  href={`/stock/articles/${result.data.exact.product.id}`}
                  className="font-semibold text-forest hover:underline"
                >
                  {result.data.exact.product.name}
                </Link>{' '}
                <span className="text-sm text-muted">{result.data.exact.variant.sku}</span>
              </CardBody>
            </Card>
          )}
          <Group
            title="Articles"
            items={result.data.products.map((p) => ({
              id: p.id,
              label: `${p.name} · ${p.sku}`,
              href: `/stock/articles/${p.id}`,
              archived: p.isArchived,
            }))}
          />
          <Group
            title="Catégories"
            items={result.data.categories.map((c) => ({
              id: c.id,
              label: c.name,
              href: '/stock/categories',
              archived: c.isArchived,
            }))}
          />
          <Group
            title="Marques"
            items={result.data.brands.map((b) => ({
              id: b.id,
              label: b.name,
              href: '/stock/categories',
              archived: b.isArchived,
            }))}
          />
          <Group
            title="Fournisseurs"
            items={result.data.suppliers.map((s) => ({
              id: s.id,
              label: s.name,
              href: '/stock/fournisseurs',
              archived: s.isArchived,
            }))}
          />
        </div>
      )}
    </>
  );
}

function Group({
  title,
  items,
}: {
  title: string;
  items: { id: string; label: string; href: string; archived: boolean }[];
}) {
  return (
    <Card>
      <CardHeader title={`${title} (${items.length})`} />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Aucun résultat.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i.id}>
                <Link
                  href={i.href}
                  className={`hover:underline ${i.archived ? 'text-muted' : 'text-forest'}`}
                >
                  {i.label}
                  {i.archived ? ' (archivé)' : ''}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
