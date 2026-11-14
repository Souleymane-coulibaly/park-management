'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  STOCK_LABEL_DEFAULT_FIELDS,
  STOCK_LABEL_FIELDS,
  STOCK_LABEL_FIELD_LABELS,
  STOCK_LABEL_FORMATS,
  STOCK_LABEL_MAX_COPIES,
  type StockLabelField,
  type StockLabelFormat,
  formatStockMoney,
} from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import {
  type StockProductDetail,
  type StockProductPage,
  type StockSiteView,
  asApiError,
} from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';

interface Selected {
  variantId: string;
  label: string;
  /** Prix commun et prix propres aux boutiques (S10). */
  price: number;
  sitePrices: { siteId: string; salePrice: number }[];
  copies: number;
}

/**
 * Étiquettes autocollantes : choix des articles et du nombre de copies, format, éléments imprimés. Le PDF
 * est à la taille exacte de l'étiquette ; il s'imprime par le dialogue d'impression (imprimante
 * d'étiquettes ou planche).
 */
export default function StockLabelsPage() {
  return (
    <StockPage
      title="Étiquettes"
      description="Imprimez prix, codes-barres et QR codes à coller sur vos articles."
    >
      {({ context, can }) =>
        can('stock.labels.print') ? (
          <Suspense fallback={<LoadingState />}>
            <Labels currency={context.currency} />
          </Suspense>
        ) : (
          <Alert tone="info" title="Impression réservée">
            Demandez à un administrateur le droit d’imprimer les étiquettes.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Labels({ currency }: { currency: string }) {
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Selected[]>([]);
  const [format, setFormat] = useState<StockLabelFormat>('50x30');
  const [fields, setFields] = useState<StockLabelField[]>([...STOCK_LABEL_DEFAULT_FIELDS]);
  const [error, setError] = useState<ApiError | null>(null);
  const [printing, setPrinting] = useState(false);
  // Boutique dont le prix est imprimé (S10) ; '' = prix commun.
  const [siteId, setSiteId] = useState('');
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const shops = sites.state === 'success' ? sites.data.filter((s) => !s.isArchived) : [];
  const priceOf = (s: Selected) =>
    formatStockMoney(
      (siteId ? s.sitePrices.find((p) => p.siteId === siteId)?.salePrice : undefined) ?? s.price,
      currency,
    );
  const results = useApi<StockProductPage>(
    q.trim()
      ? `/ocall-stock/products?${new URLSearchParams({ q: q.trim(), pageSize: '10' })}`
      : null,
  );
  const preselected = params.get('produit');

  async function addProduct(productId: string) {
    setError(null);
    try {
      const p = await api<StockProductDetail>(`/ocall-stock/products/${productId}`);
      setSelected((current) => [
        ...current,
        ...p.variants
          .filter((v) => !v.isArchived && !current.some((s) => s.variantId === v.id))
          .map((v) => ({
            variantId: v.id,
            label: v.name ? `${p.name} — ${v.name}` : p.name,
            price: v.effectiveSalePrice,
            sitePrices: v.sitePrices ?? [],
            copies: 1,
          })),
      ]);
    } catch (e) {
      setError(asApiError(e));
    }
  }

  useEffect(() => {
    if (preselected) void addProduct(preselected);
    // Préselection lue une seule fois, à l'ouverture de la page.
  }, [preselected]);

  async function print() {
    setError(null);
    setPrinting(true);
    try {
      await downloadFile('/ocall-stock/labels.pdf', 'etiquettes.pdf', {
        format,
        fields,
        items: selected.map((s) => ({ variantId: s.variantId, copies: s.copies })),
        ...(siteId ? { siteId } : {}),
      });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setPrinting(false);
    }
  }

  const total = selected.reduce((n, s) => n + s.copies, 0);

  return (
    <>
      <ApiErrorAlert error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Articles" />
          <CardBody className="space-y-3">
            <InputField
              label="Rechercher un article"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {results.state === 'success' && (
              <ul className="divide-y divide-line/60" data-testid="stock-label-results">
                {results.data.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{p.name}</span>{' '}
                      <span className="text-xs text-muted">{p.sku}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => void addProduct(p.id)}>
                      Ajouter
                    </Button>
                  </li>
                ))}
                {results.data.items.length === 0 && (
                  <li className="py-2 text-sm text-muted">Aucun article.</li>
                )}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Mise en page" />
          <CardBody className="space-y-4">
            <SelectField
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as StockLabelFormat)}
              options={STOCK_LABEL_FORMATS.map((f) => ({
                value: f,
                label: f.replace('x', ' × ') + ' mm',
              }))}
            />
            {shops.length > 1 && (
              <SelectField
                label="Prix imprimé"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                data-testid="stock-label-site"
                options={[
                  { value: '', label: 'Prix commun' },
                  ...shops.map((s) => ({ value: s.id, label: `Prix de ${s.name}` })),
                ]}
              />
            )}
            <fieldset className="grid grid-cols-2 gap-2 text-sm">
              <legend className="mb-1 font-medium">Éléments imprimés</legend>
              {STOCK_LABEL_FIELDS.map((f) => (
                <label key={f} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fields.includes(f)}
                    onChange={(e) =>
                      setFields((cur) =>
                        e.target.checked ? [...cur, f] : cur.filter((x) => x !== f),
                      )
                    }
                  />
                  {STOCK_LABEL_FIELD_LABELS[f]}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted">
              Code-barres : celui du fabricant, sinon le code interne, sinon la référence (Code
              128). Le QR code contient le même code. Un lecteur 1D ne lit pas les QR codes.
            </p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title={`À imprimer : ${total} étiquette${total > 1 ? 's' : ''}`}
          action={
            <Button
              disabled={selected.length === 0 || fields.length === 0 || printing}
              onClick={() => void print()}
            >
              {printing ? 'Préparation…' : 'Télécharger le PDF'}
            </Button>
          }
        />
        {selected.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">Ajoutez des articles à imprimer.</p>
          </CardBody>
        ) : (
          <div data-testid="stock-label-selection">
            <Table head={['Article', 'Prix', 'Copies', '']}>
              {selected.map((s) => (
                <tr key={s.variantId}>
                  <Td>{s.label}</Td>
                  <Td>{priceOf(s)}</Td>
                  <Td>
                    <input
                      type="number"
                      min={1}
                      max={STOCK_LABEL_MAX_COPIES}
                      value={s.copies}
                      aria-label={`Copies de ${s.label}`}
                      className="w-20 rounded-lg border border-line px-2 py-1"
                      onChange={(e) =>
                        setSelected((cur) =>
                          cur.map((x) =>
                            x.variantId === s.variantId
                              ? {
                                  ...x,
                                  copies: Math.min(
                                    STOCK_LABEL_MAX_COPIES,
                                    Math.max(1, Number(e.target.value) || 1),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      className="text-xs text-terracotta hover:underline"
                      onClick={() =>
                        setSelected((cur) => cur.filter((x) => x.variantId !== s.variantId))
                      }
                    >
                      Retirer
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
