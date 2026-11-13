'use client';

import { useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface StockDomain {
  id: string;
  hostname: string;
  status: 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'ERROR' | 'SUSPENDED';
  lastError: string | null;
}

/**
 * Super Admin : domaines personnalisés des vitrines Ocall Stock (S7), même procédure que les sites
 * Park — activation après vérification TXT et HTTPS, mise hors service avec motif.
 */
export function StockDomains() {
  const data = useApi<StockDomain[]>('/platform/stock-site-domains');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: 'activate' | 'suspend') {
    const reason = action === 'suspend' ? window.prompt('Motif de la mise hors service :') : null;
    if (action === 'suspend' && !reason) return;
    setBusy(id);
    setError(null);
    try {
      await api(`/platform/stock-site-domains/${id}/${action}`, {
        method: 'POST',
        ...(reason ? { body: { reason } } : {}),
      });
      data.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
    } finally {
      setBusy(null);
    }
  }

  if (data.state !== 'success' || data.data.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Vitrines Ocall Stock"
        description="Domaines personnalisés des vitrines Stock."
      />
      <CardBody className="space-y-3">
        <ApiErrorAlert error={error} />
        <ul className="divide-y divide-line/70 text-sm" data-testid="admin-stock-domains">
          {data.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold">{d.hostname}</span> · {d.status}
                {d.lastError && (
                  <span className="block text-xs text-terracotta-dark">{d.lastError}</span>
                )}
              </span>
              <span className="flex gap-2">
                {(d.status === 'VERIFIED' || d.status === 'ERROR') && (
                  <Button
                    size="sm"
                    icon={<ShieldCheck className="h-4 w-4" />}
                    loading={busy === d.id}
                    onClick={() => act(d.id, 'activate')}
                  >
                    Activer
                  </Button>
                )}
                {d.status === 'ACTIVE' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Ban className="h-4 w-4" />}
                    loading={busy === d.id}
                    onClick={() => act(d.id, 'suspend')}
                  >
                    Mettre hors service
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
