'use client';

import { type FormEvent, useState } from 'react';
import { BookOpen, Pencil, Plus, Power, Tags, Trash2 } from 'lucide-react';
import { coversActivity, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import type { CatalogCategory, CatalogProduct, Establishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

function priceRange(product: CatalogProduct): string {
  const prices = product.variants
    .filter((v) => v.isActive)
    .flatMap((v) => v.prices.filter((p) => p.isAvailable).map((p) => p.price));
  if (prices.length === 0) return 'Aucun tarif';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatXof(min) : `${formatXof(min)} – ${formatXof(max)}`;
}

export default function CataloguePage() {
  const canRead = useCan('catalog.read');
  const canManage = useCan('catalog.manage');
  const categories = useApi<CatalogCategory[]>(canRead ? '/catalog/categories' : null);
  const products = useApi<CatalogProduct[]>(canRead ? '/catalog/products' : null);
  const establishments = useApi<Establishment[]>(canManage ? '/establishments' : null);
  const [categoryDialog, setCategoryDialog] = useState<CatalogCategory | 'new' | null>(null);
  const [productDialog, setProductDialog] = useState<CatalogProduct | 'new' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  if (!canRead) return <AccessDenied />;
  const restaurantSites =
    establishments.state === 'success'
      ? establishments.data.filter(
          (e) => e.isActive && coversActivity(e.businessType, 'RESTAURANT'),
        )
      : [];
  const categoryList = categories.state === 'success' ? categories.data : [];

  async function toggleProduct(p: CatalogProduct) {
    setError(null);
    try {
      await api(`/catalog/products/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } });
      products.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Produits, variantes et tarifs par établissement. Les prix sont en FCFA, TTC."
        action={
          canManage && (
            <Button
              onClick={() => setProductDialog('new')}
              disabled={categoryList.length === 0}
              icon={<Plus className="h-4 w-4" />}
            >
              Nouveau produit
            </Button>
          )
        }
      />
      <div className="mb-4">
        <ApiErrorAlert error={error} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader
            title="Catégories"
            action={
              canManage && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setCategoryDialog('new')}
                  icon={<Plus className="h-4 w-4" />}
                >
                  Ajouter
                </Button>
              )
            }
          />
          {categories.state === 'loading' && <LoadingState />}
          {categories.state === 'error' && (
            <ErrorState error={categories.error} onRetry={categories.reload} />
          )}
          {categories.state === 'success' && categoryList.length === 0 && (
            <CardBody className="text-sm text-muted">
              Créez une première catégorie (ex. Boissons, Plats).
            </CardBody>
          )}
          <ul className="divide-y divide-line/70">
            {categoryList.map((c) => (
              <li
                key={c.id}
                className={`flex items-center justify-between gap-2 px-5 py-3 ${c.isActive ? '' : 'opacity-60'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-xs text-muted">
                    {c._count.products} produit(s){c.isActive ? '' : ' · masquée en caisse'}
                  </span>
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCategoryDialog(c)}
                    icon={<Pencil className="h-4 w-4" />}
                    aria-label={`Modifier ${c.name}`}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          {products.state === 'loading' && <LoadingState />}
          {products.state === 'error' && (
            <ErrorState error={products.error} onRetry={products.reload} />
          )}
          {products.state === 'success' && products.data.length === 0 && (
            <EmptyState
              icon={<BookOpen className="h-7 w-7" />}
              title="Catalogue vide"
              description={
                canManage
                  ? 'Créez une catégorie, puis ajoutez vos produits avec leurs tarifs.'
                  : 'Aucun produit pour le moment.'
              }
            />
          )}
          {products.state === 'success' && products.data.length > 0 && (
            <ul className="divide-y divide-line/70">
              {products.data.map((p) => (
                <li
                  key={p.id}
                  className={`flex flex-wrap items-center gap-3 px-5 py-4 ${p.isActive ? '' : 'opacity-60'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {p.name} {!p.isActive && <Badge>Désactivé</Badge>}
                    </p>
                    <p className="text-sm text-muted">
                      {p.category.name} ·{' '}
                      {p.variants
                        .filter((v) => v.isActive)
                        .map((v) => v.name)
                        .join(', ')}
                    </p>
                  </div>
                  <span className="font-semibold">{priceRange(p)}</span>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setProductDialog(p)}
                        icon={<Pencil className="h-4 w-4" />}
                        aria-label={`Modifier ${p.name}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleProduct(p)}
                        icon={<Power className="h-4 w-4" />}
                        aria-label={`${p.isActive ? 'Désactiver' : 'Réactiver'} ${p.name}`}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {categoryDialog && (
        <CategoryDialog
          category={categoryDialog === 'new' ? null : categoryDialog}
          onClose={() => setCategoryDialog(null)}
          onSaved={() => {
            setCategoryDialog(null);
            categories.reload();
            products.reload();
          }}
        />
      )}
      {productDialog && (
        <ProductDialog
          product={productDialog === 'new' ? null : productDialog}
          categories={categoryList.filter(
            (c) => c.isActive || (productDialog !== 'new' && c.id === productDialog.category.id),
          )}
          establishments={restaurantSites}
          onClose={() => setProductDialog(null)}
          onSaved={() => {
            setProductDialog(null);
            products.reload();
            categories.reload();
          }}
        />
      )}
    </>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: CatalogCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (category)
        await api(`/catalog/categories/${category.id}`, {
          method: 'PATCH',
          body: { name, isActive },
        });
      else await api('/catalog/categories', { method: 'POST', body: { name } });
      onSaved();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField label="Nom" value={name} onChange={(e) => setName(e.target.value)} required />
        {category && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Visible en caisse
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading} icon={<Tags className="h-4 w-4" />}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface VariantForm {
  id?: string;
  name: string;
  /** Prix saisi par établissement ; vide = non vendu dans cet établissement. */
  prices: Record<string, string>;
}

function ProductDialog({
  product,
  categories,
  establishments,
  onClose,
  onSaved,
}: {
  product: CatalogProduct | null;
  categories: CatalogCategory[];
  establishments: Establishment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.category.id ?? categories[0]?.id ?? '');
  const [variants, setVariants] = useState<VariantForm[]>(
    product
      ? product.variants
          .filter((v) => v.isActive)
          .map((v) => ({
            id: v.id,
            name: v.name,
            prices: Object.fromEntries(
              v.prices
                .filter((p) => p.isAvailable)
                .map((p) => [p.establishmentId, String(p.price)]),
            ),
          }))
      : [{ name: 'Standard', prices: {} }],
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const updateVariant = (index: number, patch: Partial<VariantForm>) =>
    setVariants((list) => list.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      name,
      categoryId,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        name: v.name,
        prices: Object.entries(v.prices)
          .filter(([, price]) => price !== '')
          .map(([establishmentId, price]) => ({ establishmentId, price: Number(price) })),
      })),
    };
    try {
      if (product) await api(`/catalog/products/${product.id}`, { method: 'PATCH', body });
      else await api('/catalog/products', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={product ? 'Modifier le produit' : 'Nouveau produit'}
      description="Un prix vide signifie que la variante n’est pas vendue dans cet établissement."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom du produit"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <SelectField
          label="Catégorie"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          required
        />
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Variantes et tarifs (FCFA)</legend>
          {variants.map((v, index) => (
            <div
              key={v.id ?? `new-${index}`}
              className="space-y-3 rounded-xl border border-line p-3"
            >
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <InputField
                    label={`Variante ${index + 1}`}
                    value={v.name}
                    onChange={(e) => updateVariant(index, { name: e.target.value })}
                    required
                  />
                </div>
                {variants.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setVariants((list) => list.filter((_, i) => i !== index))}
                    icon={<Trash2 className="h-4 w-4" />}
                    aria-label={`Retirer la variante ${v.name}`}
                  />
                )}
              </div>
              {establishments.length === 0 ? (
                <p className="text-sm text-muted">
                  Aucun établissement restaurant actif pour définir un tarif.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {establishments.map((e) => (
                    <InputField
                      key={e.id}
                      label={`Prix — ${e.name}`}
                      inputMode="numeric"
                      value={v.prices[e.id] ?? ''}
                      onChange={(ev) =>
                        updateVariant(index, {
                          prices: { ...v.prices, [e.id]: ev.target.value.replace(/\D/g, '') },
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setVariants((list) => [...list, { name: '', prices: {} }])}
            icon={<Plus className="h-4 w-4" />}
          >
            Ajouter une variante
          </Button>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
