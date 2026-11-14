'use client';

import { type FormEvent, useState } from 'react';
import { formatStockMoney } from '@ocall/shared';
import {
  type StockProductDetail,
  type StockSiteView,
  type StockVariantView,
  asApiError,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';

/**
 * Prix par boutique (S10) : le prix commun s'applique partout, sauf dans une boutique où un prix propre est
 * fixé. Caisse, étiquettes et vitrine de cette boutique suivent son prix ; Facture garde le prix commun.
 */
export function SitePrices({
  sites,
  product,
  currency,
  editPrices,
  onChange,
  onError,
}: {
  sites: StockSiteView[];
  product: StockProductDetail;
  currency: string;
  editPrices: boolean;
  onChange: () => void;
  onError: (e: ApiError | null) => void;
}) {
  const active = sites.filter((s) => !s.isArchived);
  // Une seule boutique : le prix commun suffit.
  if (active.length < 2) return null;
  const hasVariants = product.variants.some((v) => !v.isDefault && !v.isArchived);
  const variants = product.variants.filter((v) =>
    hasVariants ? !v.isDefault && !v.isArchived : v.isDefault,
  );
  const rows = active.flatMap((site) => variants.map((variant) => ({ site, variant })));
  return (
    <Card>
      <CardHeader
        title="Prix par boutique"
        description="Sans prix propre, une boutique applique le prix commun. Facture garde le prix commun."
      />
      <div data-testid="stock-site-prices">
        <Table head={['Boutique', hasVariants ? 'Variante' : '', 'Prix appliqué', '']}>
          {rows.map(({ site, variant }) => (
            <SitePriceRow
              key={`${site.id}-${variant.id}`}
              site={site}
              variant={variant}
              currency={currency}
              editPrices={editPrices && !product.isArchived}
              onChange={onChange}
              onError={onError}
            />
          ))}
        </Table>
      </div>
      {!editPrices && (
        <CardBody>
          <p className="text-sm text-muted">Seul un responsable des prix peut les modifier.</p>
        </CardBody>
      )}
    </Card>
  );
}

function SitePriceRow({
  site,
  variant,
  currency,
  editPrices,
  onChange,
  onError,
}: {
  site: StockSiteView;
  variant: StockVariantView;
  currency: string;
  editPrices: boolean;
  onChange: () => void;
  onError: (e: ApiError | null) => void;
}) {
  const own = variant.sitePrices?.find((p) => p.siteId === site.id) ?? null;
  const [value, setValue] = useState(own ? String(own.salePrice) : '');
  const [busy, setBusy] = useState(false);
  const path = `/ocall-stock/variants/${variant.id}/site-prices/${site.id}`;

  async function run(work: () => Promise<unknown>) {
    onError(null);
    setBusy(true);
    try {
      await work();
      onChange();
    } catch (e) {
      onError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const price = Number(value);
    if (value.trim() === '' || !Number.isInteger(price) || price < 0) return;
    void run(() => api(path, { method: 'PUT', body: { salePrice: price } }));
  }

  return (
    <tr data-testid="stock-site-price-row" data-site={site.code} data-variant={variant.sku}>
      <Td>
        <span className="block font-semibold">{site.name}</span>
        <span className="block font-mono text-xs text-muted">{site.code}</span>
      </Td>
      <Td>{variant.isDefault ? '' : variant.name}</Td>
      <Td>
        <span className="block font-semibold" data-testid="stock-site-price-value">
          {formatStockMoney(own?.salePrice ?? variant.effectiveSalePrice, currency)}
        </span>
        {own ? (
          <Badge>Prix de la boutique</Badge>
        ) : (
          <span className="text-xs text-muted">Prix commun</span>
        )}
      </Td>
      <Td className="text-right">
        {editPrices && (
          <div className="flex flex-col items-end gap-2">
            <form onSubmit={save} className="flex items-end gap-2">
              <InputField
                label={`Prix TTC à ${site.name}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="numeric"
                type="number"
                min={0}
                step={1}
                placeholder={String(variant.effectiveSalePrice)}
              />
              <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                Fixer
              </Button>
            </form>
            {own && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setValue('');
                  void run(() => api(path, { method: 'DELETE' }));
                }}
              >
                Revenir au prix commun
              </Button>
            )}
          </div>
        )}
      </Td>
    </tr>
  );
}
