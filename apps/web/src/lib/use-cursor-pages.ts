'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Liste paginée par curseur (`{ items, nextCursor }`, curseur passé en `cursor=`) : première page, pages
 * suivantes ajoutées à la suite (`more`), rechargement complet (`reload`).
 */
export function useCursorPages<T>(path: string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const sep = path.includes('?') ? '&' : '?';

  useEffect(() => {
    let cancelled = false;
    api<CursorPage<T>>(path)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await api<CursorPage<T>>(`${path}${sep}cursor=${cursor}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  }, [cursor, path, sep]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { items, state, error, busy, hasMore: cursor !== null, more, reload };
}
