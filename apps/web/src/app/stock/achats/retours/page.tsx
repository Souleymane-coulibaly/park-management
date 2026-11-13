'use client';

import { type FormEvent, useState } from 'react';
import { formatStockQuantity } from '@ocall/shared';
import { LocationPicker, VariantPicker } from '@/components/stock/pickers';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockSiteView,
  type StockSupplierView,
  type StockVariantRef,
  asApiError,
  newIdempotencyKey,
  variantLabel,
} from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface ReturnRow {
  id: string;
  label: string;
  supplier: { id: string; name: string };
  reason: string;
  createdAt: string;
  lines: { variant: StockVariantRef; quantity: number }[];
}

/** Retours fournisseurs : marchandise renvoyée (défectueuse, erreur de livraison), sorties tracées. */
export default function StockSupplierReturnsPage() {
  return (
    <StockPage
      title="Retours fournisseurs"
      description="Marchandise renvoyée au fournisseur : sortie de stock tracée, avec motif."
    >
      {(p) =>
        p.can('stock.purchases.read') || p.can('stock.returns.manage') ? (
          <Returns {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            Les retours fournisseurs sont réservés aux responsables.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Returns({ canWrite }: StockPageProps) {
  const list = useApi<ReturnRow[]>('/ocall-stock/supplier-returns');
  return (
    <>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun retour.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-return-list">
              <Table head={['Retour', 'Fournisseur', 'Articles', 'Motif']}>
                {list.data.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-semibold">{r.label}</span>
                      <span className="block text-xs text-muted">
                        {new Date(r.createdAt).toLocaleDateString('fr-FR')}
                      </span>
                    </Td>
                    <Td>{r.supplier.name}</Td>
                    <Td>
                      {r.lines
                        .map(
                          (l) => `${variantLabel(l.variant)} × ${formatStockQuantity(l.quantity)}`,
                        )
                        .join(', ')}
                    </Td>
                    <Td>{r.reason}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canWrite('stock.returns.manage') && <NewReturn onDone={list.reload} />}
    </>
  );
}

function NewReturn({ onDone }: { onDone: () => void }) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const suppliers = useApi<StockSupplierView[]>('/ocall-stock/suppliers');
  const [supplierId, setSupplier] = useState('');
  const [siteId, setSite] = useState('');
  const [locationId, setLocation] = useState('');
  const [variant, setVariant] = useState<StockVariantRef | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!variant) return;
    setError(null);
    setDone(null);
    try {
      const r = await api<{ label: string }>('/ocall-stock/supplier-returns', {
        method: 'POST',
        body: {
          supplierId,
          siteId,
          reason,
          idempotencyKey: key,
          lines: [{ variantId: variant.id, locationId, quantity: Number(quantity) }],
        },
      });
      setDone(`Retour ${r.label} enregistré.`);
      setVariant(null);
      setQuantity('1');
      setReason('');
      setKey(newIdempotencyKey());
      onDone();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Nouveau retour" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-return-form">
          <ApiErrorAlert error={error} />
          {done && <Alert tone="success" title={done} />}
          <SelectField
            label="Fournisseur"
            value={supplierId}
            onChange={(e) => setSupplier(e.target.value)}
            options={[
              { value: '', label: 'Choisir…' },
              ...(suppliers.state === 'success'
                ? suppliers.data.map((s) => ({ value: s.id, label: s.name }))
                : []),
            ]}
          />
          {sites.state === 'success' && (
            <LocationPicker
              sites={sites.data}
              siteId={siteId}
              onSite={setSite}
              locationId={locationId}
              onLocation={setLocation}
              label="Emplacement de départ"
            />
          )}
          <VariantPicker value={variant} onChange={setVariant} label="Article retourné" />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Quantité"
              type="number"
              min={0}
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <InputField
              label="Motif"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={!supplierId || !siteId || !locationId || !variant || reason.trim().length < 3}
          >
            Enregistrer le retour
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
