'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import {
  STOCK_AI_ILLUSTRATION_LABEL,
  STOCK_BARCODE_TYPE_LABELS,
  type StockBarcodeType,
  formatStockMoney,
  formatStockQuantity,
} from '@ocall/shared';
import { ProductForm } from '@/components/stock/product-form';
import { SitePrices } from '@/components/stock/site-prices';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockProductDetail,
  type StockSiteView,
  type StockVariantView,
  asApiError,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface HistoryView {
  changes: {
    id: string;
    action: string;
    changes: Record<string, [unknown, unknown]>;
    createdAt: string;
  }[];
  prices: {
    id: string;
    kind: 'SALE' | 'PURCHASE';
    oldPrice: number | null;
    newPrice: number | null;
    createdAt: string;
    siteId?: string | null;
    variant: { id: string; name: string | null; isDefault: boolean };
  }[];
}

const ACTIONS: Record<string, string> = {
  created: 'Article créé',
  updated: 'Article modifié',
  archived: 'Article archivé',
  restored: 'Article réactivé',
  variant_created: 'Variante ajoutée',
  variant_updated: 'Variante modifiée',
  barcode_added: 'Code ajouté',
  barcode_removed: 'Code retiré',
  site_price_set: 'Prix de boutique fixé',
  site_price_removed: 'Retour au prix commun',
};

const FIELDS: Record<string, string> = {
  sku: 'référence',
  name: 'désignation',
  description: 'description',
  categoryId: 'catégorie',
  brandId: 'marque',
  unit: 'unité',
  salePrice: 'prix de vente',
  purchasePrice: 'prix d’achat',
  vatRate: 'TVA',
  minStock: 'seuil',
  isStockable: 'stocké',
  isArchived: 'archivé',
  barcode: 'code',
  variant: 'variante',
  site: 'boutique',
};

/** Type proposé d'après la longueur ; l'API vérifie la clé de contrôle et refuse un code faux. */
const guessType = (code: string): Exclude<StockBarcodeType, 'INTERNAL'> =>
  code.length === 8 ? 'EAN8' : code.length === 12 ? 'UPCA' : 'EAN13';

export default function StockProductPage() {
  return (
    <StockPage title="Article">
      {(props) => (
        <Suspense fallback={<LoadingState />}>
          <Product {...props} />
        </Suspense>
      )}
    </StockPage>
  );
}

function Product({ context, can, canWrite }: StockPageProps) {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const product = useApi<StockProductDetail>(`/ocall-stock/products/${id}`);
  const history = useApi<HistoryView>(`/ocall-stock/products/${id}/history`);
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const siteName = (siteId: string) =>
    (sites.state === 'success' ? sites.data.find((s) => s.id === siteId)?.name : null) ??
    'une boutique';
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  const manage = canWrite('stock.catalog.manage');
  const editPrices = canWrite('stock.prices.manage');
  const money = (v: number) => formatStockMoney(v, context.currency);
  const reload = () => {
    product.reload();
    history.reload();
  };

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  if (product.state === 'loading') return <LoadingState />;
  if (product.state === 'error')
    return <ErrorState error={product.error} onRetry={product.reload} />;
  const p = product.data;

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title={p.name}
          description={[p.sku, p.category?.name, p.brand?.name].filter(Boolean).join(' · ')}
          action={
            <span className="flex flex-wrap gap-2">
              {p.isArchived && <Badge>Archivé</Badge>}
              {can('stock.labels.print') && (
                <ButtonLink
                  size="sm"
                  variant="secondary"
                  href={`/stock/etiquettes?produit=${p.id}`}
                >
                  Étiquettes
                </ButtonLink>
              )}
              {manage && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
                    {editing ? 'Fermer' : 'Modifier'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void run(() =>
                        api(`/ocall-stock/products/${p.id}`, {
                          method: 'PATCH',
                          body: { isArchived: !p.isArchived },
                        }),
                      )
                    }
                  >
                    {p.isArchived ? 'Réactiver' : 'Archiver'}
                  </Button>
                </>
              )}
            </span>
          }
        />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-4">
          <Info label="Prix de vente TTC" value={`${money(p.salePrice)} / ${p.unit}`} />
          {p.purchasePrice !== undefined && (
            <Info
              label="Prix d’achat HT"
              value={p.purchasePrice === null ? 'Inconnu' : money(p.purchasePrice)}
            />
          )}
          <Info label="TVA" value={`${p.vatRate} %`} />
          <Info label="Seuil d’alerte" value={p.minStock === null ? 'Aucun' : String(p.minStock)} />
          {p.description && <p className="sm:col-span-4 text-charcoal-soft">{p.description}</p>}
        </CardBody>
      </Card>

      {editing && (manage || editPrices) && (
        <Card>
          <CardHeader title="Modifier l’article" />
          <CardBody>
            <ProductForm
              product={p}
              canEditPrices={editPrices}
              canSeePurchase={can('stock.prices.purchase.read')}
              onDone={() => {
                setEditing(false);
                reload();
              }}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Variantes et codes-barres"
          description="Chaque variante a sa référence et ses codes."
        />
        <div data-testid="stock-variants">
          <Table head={['Variante', 'Prix TTC', 'Codes', '']}>
            {p.variants.map((v) => (
              <VariantRow
                key={v.id}
                variant={v}
                price={money(v.effectiveSalePrice)}
                manage={manage}
                prefill={v.isDefault ? params.get('code') : null}
                onChange={reload}
                onError={setError}
              />
            ))}
          </Table>
        </div>
        {manage && !p.isArchived && (
          <CardBody>
            <NewVariant productId={p.id} editPrices={editPrices} onDone={reload} />
          </CardBody>
        )}
      </Card>

      {sites.state === 'success' && (
        <SitePrices
          sites={sites.data}
          product={p}
          currency={context.currency}
          editPrices={editPrices}
          onChange={reload}
          onError={setError}
        />
      )}

      {can('stock.levels.read') && p.isStockable && <Levels product={p} />}

      <Images
        product={p}
        manage={manage}
        canIllustrate={canWrite('stock.ai.images')}
        onChange={reload}
        onError={setError}
      />

      <Card>
        <CardHeader title="Historique" />
        <CardBody>
          {history.state === 'success' ? (
            <ul className="space-y-2 text-sm" data-testid="stock-history">
              {[
                ...history.data.changes.map((c) => ({
                  id: c.id,
                  at: c.createdAt,
                  text: `${ACTIONS[c.action] ?? c.action}${describe(c.changes)}`,
                })),
                ...history.data.prices.map((h) => ({
                  id: h.id,
                  at: h.createdAt,
                  text: `${h.kind === 'SALE' ? 'Prix de vente' : 'Prix d’achat'}${h.variant.isDefault ? '' : ` (${h.variant.name})`}${h.siteId ? ` à ${siteName(h.siteId)}` : ''} : ${
                    h.oldPrice === null ? '—' : money(h.oldPrice)
                  } → ${h.newPrice === null ? '—' : money(h.newPrice)}`,
                })),
              ]
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 50)
                .map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3">
                    <span className="text-muted">{new Date(e.at).toLocaleString('fr-FR')}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <LoadingState />
          )}
        </CardBody>
      </Card>
      <p>
        <Link href="/stock/articles" className="text-sm font-medium text-forest hover:underline">
          ← Retour au catalogue
        </Link>
      </p>
    </>
  );
}

function describe(changes: Record<string, [unknown, unknown]>): string {
  const keys = Object.keys(changes ?? {}).filter(
    (k) => !['salePrice', 'purchasePrice'].includes(k),
  );
  if (keys.length === 0) return '';
  return ` : ${keys
    .map((k) => {
      const [, after] = changes[k]!;
      return k === 'barcode' || k === 'variant' || k === 'site'
        ? `${FIELDS[k]} ${String(after ?? changes[k]![0])}`
        : (FIELDS[k] ?? k);
    })
    .join(', ')}`;
}

interface ProductLevel {
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  site: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string };
}

/** Stock de l'article par site et par emplacement (sites accessibles au membre). */
function Levels({ product }: { product: StockProductDetail }) {
  const levels = useApi<ProductLevel[]>(`/ocall-stock/products/${product.id}/levels`);
  const variantName = (id: string) => product.variants.find((v) => v.id === id)?.name ?? 'Article';
  const total = levels.state === 'success' ? levels.data.reduce((n, l) => n + l.onHand, 0) : null;
  return (
    <Card>
      <CardHeader
        title="Stock par emplacement"
        description={
          total === null ? undefined : `${formatStockQuantity(total)} ${product.unit} au total`
        }
      />
      {levels.state === 'success' && levels.data.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Aucun stock enregistré.</p>
        </CardBody>
      ) : levels.state === 'success' ? (
        <div data-testid="stock-product-levels">
          <Table head={['Site / emplacement', 'Variante', 'En stock', 'Réservé', 'Disponible']}>
            {levels.data.map((l) => (
              <tr key={`${l.location.id}:${l.variantId}`}>
                <Td>
                  {l.site.code} / {l.location.code}
                </Td>
                <Td>{variantName(l.variantId)}</Td>
                <Td>{formatStockQuantity(l.onHand)}</Td>
                <Td>{formatStockQuantity(l.reserved)}</Td>
                <Td className="font-semibold">{formatStockQuantity(l.available)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      ) : (
        <LoadingState />
      )}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function VariantRow({
  variant,
  price,
  manage,
  prefill,
  onChange,
  onError,
}: {
  variant: StockVariantView;
  price: string;
  manage: boolean;
  prefill: string | null;
  onChange: () => void;
  onError: (e: ApiError | null) => void;
}) {
  const [code, setCode] = useState(prefill ?? '');

  async function run(work: () => Promise<unknown>) {
    onError(null);
    try {
      await work();
      setCode('');
      onChange();
    } catch (e) {
      onError(asApiError(e));
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\s+/g, '');
    if (!clean) return;
    void run(() =>
      api(`/ocall-stock/variants/${variant.id}/barcodes`, {
        method: 'POST',
        body: { type: guessType(clean), code: clean },
      }),
    );
  }

  return (
    <tr>
      <Td>
        <span className="block font-semibold">{variant.name ?? 'Article (sans déclinaison)'}</span>
        <span className="block font-mono text-xs text-muted">{variant.sku}</span>
        {variant.isArchived && <Badge>Archivée</Badge>}
      </Td>
      <Td>{price}</Td>
      <Td>
        <ul className="space-y-1">
          {variant.barcodes.map((b) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{b.code}</span>
              <span className="text-xs text-muted">{STOCK_BARCODE_TYPE_LABELS[b.type]}</span>
              {manage && (
                <button
                  type="button"
                  className="text-xs text-terracotta hover:underline"
                  onClick={() =>
                    void run(() => api(`/ocall-stock/barcodes/${b.id}`, { method: 'DELETE' }))
                  }
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
          {variant.barcodes.length === 0 && <li className="text-xs text-muted">Aucun code</li>}
        </ul>
      </Td>
      <Td className="text-right">
        {manage && (
          <div className="flex flex-col items-end gap-2">
            <form onSubmit={add} className="flex items-end gap-2">
              <InputField
                label="Code du fabricant"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="EAN-13, EAN-8 ou UPC-A"
              />
              <Button type="submit" size="sm" variant="secondary">
                Ajouter
              </Button>
            </form>
            {!variant.barcodes.some((b) => b.type === 'INTERNAL') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run(() =>
                    api(`/ocall-stock/variants/${variant.id}/internal-code`, { method: 'POST' }),
                  )
                }
              >
                Générer un code interne
              </Button>
            )}
          </div>
        )}
      </Td>
    </tr>
  );
}

function NewVariant({
  productId,
  editPrices,
  onDone,
}: {
  productId: string;
  editPrices: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/ocall-stock/products/${productId}/variants`, {
        method: 'POST',
        body: {
          name,
          ...(sku.trim() ? { sku: sku.trim() } : {}),
          ...(editPrices && salePrice.trim() ? { salePrice: Number(salePrice) } : {}),
        },
      });
      setName('');
      setSku('');
      setSalePrice('');
      onDone();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="stock-variant-form">
      <ApiErrorAlert error={error} />
      <div className="flex flex-wrap items-end gap-3">
        <InputField
          label="Nouvelle variante (taille, couleur…)"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <InputField
          label="Référence (générée si vide)"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
        />
        {editPrices && (
          <InputField
            label="Prix TTC propre (facultatif)"
            type="number"
            min={0}
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
          />
        )}
        <Button type="submit" variant="secondary">
          Ajouter la variante
        </Button>
      </div>
    </form>
  );
}

function Images({
  product,
  manage,
  canIllustrate,
  onChange,
  onError,
}: {
  product: StockProductDetail;
  manage: boolean;
  /** S8 : illustration générée par IA, pour un article sans photo. */
  canIllustrate: boolean;
  onChange: () => void;
  onError: (e: ApiError | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [showcase, setShowcase] = useState(false);

  async function illustrate() {
    onError(null);
    setBusy(true);
    try {
      const r = await api<{ proposal: { id: string } }>(
        `/ocall-stock/ai/products/${product.id}/illustration`,
        { method: 'POST' },
      );
      setDraft(r.proposal.id);
      setShowcase(false);
    } catch (e) {
      onError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: 'apply' | 'reject') {
    if (!draft) return;
    onError(null);
    try {
      await api(`/ocall-stock/ai/proposals/${draft}/${action}`, {
        method: 'POST',
        body: action === 'apply' ? { showcase } : undefined,
      });
      setDraft(null);
      onChange();
    } catch (e) {
      onError(asApiError(e));
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    onError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiUpload(`/ocall-stock/products/${product.id}/images`, form);
      onChange();
    } catch (e) {
      onError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Photos" description="Quatre au plus ; la première sert de vignette." />
      <CardBody className="flex flex-wrap gap-4">
        {product.images.map((img) => (
          <figure key={img.id} className="w-32 space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/v1/ocall-stock/products/${product.id}/images/${img.id}`}
              alt={`Photo ${img.position + 1} de ${product.name}`}
              className="h-32 w-32 rounded-xl object-cover"
            />
            {img.aiGenerated && (
              <figcaption className="text-xs text-muted" data-testid="stock-ai-illustration-label">
                {STOCK_AI_ILLUSTRATION_LABEL}
                {img.showcaseApproved ? ' · sur la vitrine' : ' · hors vitrine'}
              </figcaption>
            )}
            {manage && (
              <button
                type="button"
                className="text-xs text-terracotta hover:underline"
                onClick={async () => {
                  onError(null);
                  try {
                    await api(`/ocall-stock/products/${product.id}/images/${img.id}`, {
                      method: 'DELETE',
                    });
                    onChange();
                  } catch (e) {
                    onError(asApiError(e));
                  }
                }}
              >
                Retirer
              </button>
            )}
          </figure>
        ))}
        {product.images.length === 0 && !draft && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Aucune photo.</p>
            {canIllustrate && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => void illustrate()}
                data-testid="stock-ai-illustrate"
              >
                Générer une illustration (IA)
              </Button>
            )}
          </div>
        )}
        {draft && (
          <figure className="w-full max-w-xs space-y-2" data-testid="stock-ai-illustration">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu privé servi par l'API */}
            <img
              src={`/api/v1/ocall-stock/ai/proposals/${draft}/image`}
              alt={`${STOCK_AI_ILLUSTRATION_LABEL} : ${product.name}`}
              className="h-48 w-48 rounded-xl border border-line object-cover"
            />
            <figcaption className="text-xs font-semibold text-terracotta-dark">
              {STOCK_AI_ILLUSTRATION_LABEL} — ce n’est pas une photo du produit réel.
            </figcaption>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showcase}
                onChange={(e) => setShowcase(e.target.checked)}
              />
              Montrer cette illustration sur le site vitrine
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void decide('apply')}>
                Ajouter à l’article
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void decide('reject')}>
                Refuser
              </Button>
            </div>
          </figure>
        )}
        {manage && product.images.length < 4 && (
          <label className="flex h-32 w-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-line text-center text-sm text-charcoal-soft hover:bg-ivory-dark/40">
            {busy ? 'Envoi…' : 'Ajouter une photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
        )}
      </CardBody>
    </Card>
  );
}
