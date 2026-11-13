'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  STOCK_COUNT_SCOPE_LABELS,
  STOCK_COUNT_STATUS_LABELS,
  formatStockQuantity,
} from '@ocall/shared';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import { useSiteLocations } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockCountView,
  type StockLookup,
  asApiError,
  variantLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';

/**
 * Comptage d'un inventaire : choisir (ou scanner) l'emplacement, puis scanner chaque article (+1 par
 * lecture) ou saisir la quantité. Le stock n'est modifié qu'à la validation.
 */
export default function StockCountPage() {
  return <StockPage title="Inventaire">{(p) => <Count {...p} />}</StockPage>;
}

function Count({ canWrite }: StockPageProps) {
  const { id } = useParams<{ id: string }>();
  const count = useApi<StockCountView>(`/ocall-stock/counts/${id}`);
  const c = count.state === 'success' ? count.data : null;
  const { locations } = useSiteLocations(c?.site.id ?? null);
  const [locationId, setLocationId] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      count.reload();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (count.state === 'loading') return <LoadingState />;
  if (count.state === 'error') return <ErrorState error={count.error} onRetry={count.reload} />;
  const k = count.data;
  const open = k.status === 'OPEN';
  const inScope = locations.filter((l) => !k.locationIds.length || k.locationIds.includes(l.id));
  const counting = open && canWrite('stock.counts.count');

  async function onScan(code: string) {
    try {
      // QR code d'emplacement : change l'emplacement en cours.
      if (code.toUpperCase().startsWith('L:')) {
        const found = await api<{ found: boolean; location?: { id: string; code: string } }>(
          `/ocall-stock/locations/lookup?code=${encodeURIComponent(code)}`,
        );
        if (found.found && found.location && inScope.some((l) => l.id === found.location!.id)) {
          setLocationId(found.location.id);
          setFeedback({ tone: 'ok', message: `Emplacement ${found.location.code}` });
        } else {
          setFeedback({ tone: 'error', message: 'Emplacement hors du périmètre de l’inventaire.' });
        }
        return;
      }
      if (!locationId) {
        setFeedback({ tone: 'warn', message: 'Choisissez ou scannez d’abord l’emplacement.' });
        return;
      }
      const found = await api<StockLookup>(`/ocall-stock/lookup?code=${encodeURIComponent(code)}`);
      if (!found.found) {
        setFeedback({ tone: 'warn', message: `Code inconnu : ${code}` });
        return;
      }
      await api(`/ocall-stock/counts/${k.id}/lines`, {
        method: 'PUT',
        body: { variantId: found.variant.id, locationId, quantity: 1, mode: 'ADD' },
      });
      setFeedback({ tone: 'ok', message: `+1 ${found.product.name}` });
      count.reload();
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  const gaps = k.lines.filter((l) => l.difference !== 0).length;

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title={`${k.label} — ${k.name}`}
          description={`${k.site.code} · ${STOCK_COUNT_SCOPE_LABELS[k.scope]}`}
          action={
            <span data-testid="stock-count-status">
              <Badge
                tone={
                  k.status === 'VALIDATED' ? 'forest' : k.status === 'OPEN' ? 'savanna' : 'neutral'
                }
              >
                {STOCK_COUNT_STATUS_LABELS[k.status]}
              </Badge>
            </span>
          }
        />
        {counting && (
          <CardBody className="grid gap-4 lg:grid-cols-2">
            <SelectField
              label="Emplacement compté"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              options={[
                { value: '', label: 'Choisir…' },
                ...inScope.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
              ]}
            />
            <ScanField
              label="Scanner les articles (+1 par lecture)"
              onScan={onScan}
              feedback={feedback}
              testId="stock-count-scan"
            />
          </CardBody>
        )}
      </Card>
      {open && (
        <Alert tone="info" title="Aperçu">
          Stock et écarts recalculés à la validation.{' '}
          {k.scope === 'FULL'
            ? 'Inventaire complet : un article en stock non compté sera ramené à 0.'
            : ''}
        </Alert>
      )}
      <Card>
        <CardHeader title={`${k.lines.length} ligne(s), ${gaps} écart(s)`} />
        <div data-testid="stock-count-lines">
          <Table head={['Emplacement', 'Article', 'Stock', 'Compté', 'Écart', '']}>
            {k.lines.map((l) => (
              <tr key={`${l.locationId}:${l.variantId}`}>
                <Td>{l.location.code}</Td>
                <Td>
                  {variantLabel(l.variant)}
                  <span className="block font-mono text-xs text-muted">{l.variant.sku}</span>
                </Td>
                <Td>{formatStockQuantity(l.onHand)}</Td>
                <Td>
                  {counting ? (
                    <input
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`Compté : ${variantLabel(l.variant)} en ${l.location.code}`}
                      className="w-24 rounded-lg border border-line px-2 py-1"
                      defaultValue={l.counted ?? ''}
                      placeholder="Non compté"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === '' || Number(v) === l.counted) return;
                        void run(() =>
                          api(`/ocall-stock/counts/${k.id}/lines`, {
                            method: 'PUT',
                            body: {
                              variantId: l.variantId,
                              locationId: l.locationId,
                              quantity: Number(v),
                              mode: 'SET',
                            },
                          }),
                        );
                      }}
                    />
                  ) : l.counted === null ? (
                    'Non compté'
                  ) : (
                    formatStockQuantity(l.counted)
                  )}
                </Td>
                <Td
                  className={
                    l.difference < 0 ? 'text-terracotta' : l.difference > 0 ? 'text-forest' : ''
                  }
                >
                  {l.difference > 0 ? '+' : ''}
                  {formatStockQuantity(l.difference)}
                </Td>
                <Td className="text-right">
                  {counting && l.lineId && (
                    <button
                      type="button"
                      className="text-xs text-terracotta hover:underline"
                      onClick={() =>
                        void run(() =>
                          api(`/ocall-stock/counts/${k.id}/lines/${l.lineId}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      Retirer
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
        <CardBody className="flex flex-wrap gap-3">
          {open && canWrite('stock.counts.validate') && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => api(`/ocall-stock/counts/${k.id}/validate`, { method: 'POST' }))
                }
              >
                Valider l’inventaire
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => api(`/ocall-stock/counts/${k.id}/cancel`, { method: 'POST' }))
                }
              >
                Annuler
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              void run(() =>
                downloadFile(`/ocall-stock/counts/${k.id}/report.csv`, 'inventaire.csv'),
              )
            }
          >
            Rapport CSV
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void run(() =>
                downloadFile(`/ocall-stock/counts/${k.id}/report.pdf`, 'inventaire.pdf'),
              )
            }
          >
            Rapport PDF
          </Button>
        </CardBody>
      </Card>
    </>
  );
}
