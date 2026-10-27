'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';

export type Loadable<T> =
  { state: 'loading' } | { state: 'error'; error: ApiError } | { state: 'success'; data: T };

/** Chargement d'une ressource de l'API avec états loading / error / success et rechargement. */
export function useApi<T>(path: string | null): Loadable<T> & { reload: () => void } {
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setResult((prev) => (prev.state === 'success' ? prev : { state: 'loading' }));
    api<T>(path)
      .then((data) => !cancelled && setResult({ state: 'success', data }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          state: 'error',
          error:
            error instanceof ApiError
              ? error
              : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...result, reload };
}
