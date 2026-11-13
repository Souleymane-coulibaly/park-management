'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { STOCK_SEARCH_GROUP_LABELS, type StockSearchGroup } from '@ocall/shared';
import { api } from '@/lib/api';

export interface StockSearchHit {
  id: string;
  label: string;
  detail: string | null;
  isArchived: boolean;
  targetId?: string;
}

export interface StockSearchView {
  exact: { found: true; product: { id: string; name: string }; variant: { sku: string } } | null;
  page: number;
  pageSize: number;
  groups: Partial<Record<StockSearchGroup, StockSearchHit[]>>;
  more: Partial<Record<StockSearchGroup, boolean>>;
  stock: Record<string, { site: string; available: number }[]>;
}

/** Fiche d'un résultat de recherche (navigation rapide). */
export function stockSearchHref(group: StockSearchGroup, hit: StockSearchHit): string {
  switch (group) {
    case 'products':
      return `/stock/articles/${hit.id}`;
    case 'categories':
    case 'brands':
      return '/stock/categories';
    case 'suppliers':
      return '/stock/fournisseurs';
    case 'customers':
      return '/stock/clients';
    case 'sales':
      return `/stock/ventes/${hit.id}`;
    case 'orders':
      return `/stock/achats/${hit.id}`;
    case 'sites':
      return `/stock/sites/${hit.id}`;
    case 'locations':
      return `/stock/sites/${hit.targetId ?? ''}`;
  }
}

/**
 * Recherche globale avec autocomplétion : dès 2 caractères, les premiers résultats de chaque type (fautes
 * tolérées) ; flèches et Entrée pour ouvrir une fiche ; Entrée sans choix → page de recherche complète.
 */
export function StockSearchBox({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ group: StockSearchGroup; hit: StockSearchHit }[]>([]);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const text = q.trim();
    if (text.length < 2) {
      setItems([]);
      return;
    }
    let live = true;
    timer.current = setTimeout(() => {
      api<StockSearchView>(`/ocall-stock/search?${new URLSearchParams({ q: text, limit: '3' })}`)
        .then((r) => {
          if (!live) return;
          setItems(
            (Object.entries(r.groups) as [StockSearchGroup, StockSearchHit[]][]).flatMap(
              ([group, hits]) => hits.map((hit) => ({ group, hit })),
            ),
          );
          setActive(-1);
        })
        .catch(() => live && setItems([]));
    }, 250);
    return () => {
      live = false;
    };
  }, [q]);

  function submit() {
    const chosen = active >= 0 ? items[active] : undefined;
    setOpen(false);
    if (chosen) router.push(stockSearchHref(chosen.group, chosen.hit));
    else if (q.trim()) router.push(`/stock/recherche?q=${encodeURIComponent(q.trim())}`);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <form
      role="search"
      className="relative"
      data-testid="stock-search-box"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Rechercher dans Ocall Stock
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-forest focus-within:ring-2 focus-within:ring-forest/30">
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={80}
          placeholder="Article, code, client, vente, commande, site…"
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
      </div>
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          {items.map(({ group, hit }, i) => (
            <li key={`${group}:${hit.id}`} role="option" aria-selected={i === active}>
              <Link
                href={stockSearchHref(group, hit)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                className={`flex items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? 'bg-ivory' : 'hover:bg-ivory'}`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{hit.label}</span>
                  {hit.detail && <span className="text-muted"> · {hit.detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {STOCK_SEARCH_GROUP_LABELS[group]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
