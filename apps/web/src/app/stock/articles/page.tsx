'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { STOCK_BARCODE_TYPE_LABELS, formatStockMoney } from '@ocall/shared';
import { AiPhotoPrefill, type PhotoPrefill } from '@/components/stock/ai-photo-prefill';
import { ProductForm } from '@/components/stock/product-form';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import { StockPage } from '@/components/stock/stock-page';
import {
  type StockBrandView,
  type StockCategoryView,
  type StockLookup,
  type StockProductPage,
  asApiError,
  categoryLabel,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const PAGE_SIZE = 25;

/** Catalogue : liste paginée, recherche tolérante, filtres, scan, création. */
export default function StockProductsPage() {
  return (
    <StockPage title="Articles" description="Catalogue, références, codes-barres et prix.">
      {({ context, can, canWrite }) => (
        <Suspense fallback={<LoadingState />}>
          <Products
            currency={context.currency}
            canCreate={canWrite('stock.catalog.manage')}
            canSeePurchase={can('stock.prices.purchase.read')}
            canAiImages={canWrite('stock.ai.images')}
          />
        </Suspense>
      )}
    </StockPage>
  );
}

function Products({
  currency,
  canCreate,
  canSeePurchase,
  canAiImages,
}: {
  currency: string;
  canCreate: boolean;
  canSeePurchase: boolean;
  /** S8 : préremplir la fiche depuis une photo (IA). */
  canAiImages: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(params.get('nouveau') === '1');
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<PhotoPrefill | null>(null);
  const brands = useApi<StockBrandView[]>(canAiImages && creating ? '/ocall-stock/brands' : null);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const categories = useApi<StockCategoryView[]>('/ocall-stock/categories');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    archived: String(archived),
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(categoryId ? { categoryId } : {}),
  });
  const products = useApi<StockProductPage>(`/ocall-stock/products?${query}`);

  async function onScan(code: string) {
    try {
      const found = await api<StockLookup>(`/ocall-stock/lookup?code=${encodeURIComponent(code)}`);
      if (found.found) {
        setFeedback({ tone: 'ok', message: `${found.product.name} — ${found.variant.sku}` });
        router.push(`/stock/articles/${found.product.id}`);
        return;
      }
      setFeedback({
        tone: 'warn',
        message: `Code inconnu : ${code}${found.detectedType ? ` (${STOCK_BARCODE_TYPE_LABELS[found.detectedType]} valide)` : ''}.`,
      });
      if (canCreate) {
        setUnknownCode(code);
        setCreating(true);
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  const pages =
    products.state === 'success' ? Math.max(1, Math.ceil(products.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <Card>
        <CardBody className="grid gap-4 lg:grid-cols-[2fr_3fr]">
          <ScanField onScan={onScan} feedback={feedback} testId="stock-products-scan" />
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-48 flex-1">
              <InputField
                label="Rechercher (nom, référence, code)"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="min-w-40">
              <SelectField
                label="Catégorie"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'Toutes' },
                  ...(categories.state === 'success'
                    ? categories.data.map((c) => ({
                        value: c.id,
                        label: categoryLabel(c, categories.data),
                      }))
                    : []),
                ]}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setPage(1);
                }}
              />
              Archivés compris
            </label>
          </div>
        </CardBody>
      </Card>

      {canCreate && creating && (
        <Card>
          <CardHeader
            title="Nouvel article"
            description={
              unknownCode
                ? `Le code ${unknownCode} sera ajouté à l’article après sa création.`
                : undefined
            }
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (setCreating(false), setUnknownCode(null), setPrefill(null))}
              >
                Fermer
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {canAiImages && (
              <AiPhotoPrefill
                brands={brands.state === 'success' ? brands.data : []}
                onPrefill={setPrefill}
              />
            )}
            <ProductForm
              key={prefill?.proposalId ?? unknownCode ?? 'new'}
              canEditPrices
              canSeePurchase={canSeePurchase}
              initial={prefill?.initial}
              testId="stock-product-form"
              onDone={async (p) => {
                // Proposition IA appliquée : la fiche créée est rattachée à la photo lue (traçabilité).
                if (prefill) {
                  await api(`/ocall-stock/ai/proposals/${prefill.proposalId}/apply`, {
                    method: 'POST',
                    body: { productId: p.id },
                  }).catch(() => undefined);
                }
                const code = prefill?.barcode ?? unknownCode;
                router.push(
                  code
                    ? `/stock/articles/${p.id}?code=${encodeURIComponent(code)}`
                    : `/stock/articles/${p.id}`,
                );
              }}
            />
          </CardBody>
        </Card>
      )}

      {products.state === 'loading' && <LoadingState />}
      {products.state === 'error' && (
        <ErrorState error={products.error} onRetry={products.reload} />
      )}
      {products.state === 'success' && (
        <Card>
          <CardHeader
            title={`${products.data.total} article${products.data.total > 1 ? 's' : ''}`}
            action={
              canCreate && !creating ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  Nouvel article
                </Button>
              ) : undefined
            }
          />
          {products.data.items.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">
                {q.trim()
                  ? 'Aucun article ne correspond.'
                  : 'Catalogue vide : créez votre premier article.'}
              </p>
            </CardBody>
          ) : (
            <div data-testid="stock-product-list">
              <Table head={['Article', 'Code', 'Prix TTC', '']}>
                {products.data.items.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="flex items-center gap-3">
                        {p.imageId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/v1/ocall-stock/products/${p.id}/images/${p.imageId}`}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <span
                            className="h-10 w-10 shrink-0 rounded-lg bg-ivory-dark/60"
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0">
                          <Link
                            href={`/stock/articles/${p.id}`}
                            className="block font-semibold hover:underline"
                          >
                            {p.name}
                          </Link>
                          <span className="block text-xs text-muted">
                            {[
                              p.sku,
                              p.category?.name,
                              p.brand?.name,
                              p.variantCount ? `${p.variantCount} variante(s)` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{p.barcode?.code ?? '—'}</Td>
                    <Td>
                      {formatStockMoney(p.salePrice, currency)} / {p.unit}
                    </Td>
                    <Td className="text-right">
                      {p.isArchived && <Badge>Archivé</Badge>}
                      {!p.isStockable && <Badge tone="savanna">Non stocké</Badge>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {pages > 1 && (
            <CardBody className="flex items-center justify-between gap-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </Button>
              <span className="text-sm text-muted">
                Page {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </Button>
            </CardBody>
          )}
        </Card>
      )}
    </>
  );
}
