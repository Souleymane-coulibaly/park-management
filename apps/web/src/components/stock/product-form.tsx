'use client';

import { type FormEvent, useState } from 'react';
import { STOCK_DEFAULT_VAT_RATE, STOCK_SALE_UNITS, STOCK_VAT_RATES } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import {
  type StockBrandView,
  type StockCategoryView,
  type StockProductDetail,
  asApiError,
  categoryLabel,
} from './stock-types';

const VAT_OPTIONS = STOCK_VAT_RATES.map((r) => ({
  value: String(r),
  label: r === 0 ? 'Exonéré (0 %)' : `${r} %`,
}));

/**
 * Formulaire d'un article : création (prix compris) ou modification. Les prix ne sont envoyés que s'ils
 * changent, et seulement si l'utilisateur peut les modifier ; le prix d'achat n'apparaît qu'avec le droit
 * de le voir. Les règles réelles sont celles de l'API.
 */
export function ProductForm({
  product,
  canEditPrices,
  canSeePurchase,
  defaultVatRate = STOCK_DEFAULT_VAT_RATE,
  onDone,
  testId,
  initial,
}: {
  product?: StockProductDetail;
  /** Valeurs proposées à la création (fiche préremplie depuis une photo par l'IA, S8), modifiables. */
  initial?: { name?: string; description?: string; categoryId?: string; brandId?: string };
  canEditPrices: boolean;
  canSeePurchase: boolean;
  defaultVatRate?: number;
  onDone: (product: StockProductDetail) => void | Promise<void>;
  testId?: string;
}) {
  const categories = useApi<StockCategoryView[]>('/ocall-stock/categories');
  const brands = useApi<StockBrandView[]>('/ocall-stock/brands');
  const [values, setValues] = useState(() => ({
    name: product?.name ?? initial?.name ?? '',
    sku: product?.sku ?? '',
    description: product?.description ?? initial?.description ?? '',
    categoryId: product?.categoryId ?? initial?.categoryId ?? '',
    brandId: product?.brandId ?? initial?.brandId ?? '',
    unit: product?.unit ?? 'unité',
    salePrice: product ? String(product.salePrice) : '',
    purchasePrice: product?.purchasePrice != null ? String(product.purchasePrice) : '',
    vatRate: String(product?.vatRate ?? defaultVatRate),
    minStock: product?.minStock != null ? String(product.minStock) : '',
    isStockable: product?.isStockable ?? true,
  }));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof values) => (v: string | boolean) =>
    setValues((s) => ({ ...s, [key]: v }));
  const creating = !product;
  // Sans le droit de gérer les prix, un article se crée au prix de vente 0 (un responsable le fixera).
  const pricesEditable = canEditPrices;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const body: Record<string, unknown> = {
      name: values.name,
      description: values.description.trim() || null,
      categoryId: values.categoryId || null,
      brandId: values.brandId || null,
      unit: values.unit,
      vatRate: Number(values.vatRate),
      minStock: num(values.minStock),
      isStockable: values.isStockable,
    };
    if (creating) {
      if (values.sku.trim()) body.sku = values.sku.trim();
    } else if (values.sku.trim() !== product.sku) {
      body.sku = values.sku.trim();
    }
    if (creating && !pricesEditable) body.salePrice = 0;
    if (pricesEditable) {
      const sale = num(values.salePrice);
      if (creating || sale !== product.salePrice) body.salePrice = sale;
      if (canSeePurchase) {
        const purchase = num(values.purchasePrice);
        if (creating ? purchase !== null : purchase !== (product.purchasePrice ?? null)) {
          body.purchasePrice = purchase;
        }
      }
    }
    try {
      const saved = await api<StockProductDetail>(
        creating ? '/ocall-stock/products' : `/ocall-stock/products/${product.id}`,
        { method: creating ? 'POST' : 'PATCH', body },
      );
      onDone(saved);
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setLoading(false);
    }
  }

  const categoryOptions = [
    { value: '', label: 'Aucune' },
    ...(categories.state === 'success'
      ? categories.data.map((c) => ({ value: c.id, label: categoryLabel(c, categories.data) }))
      : []),
  ];
  const brandOptions = [
    { value: '', label: 'Aucune' },
    ...(brands.state === 'success' ? brands.data.map((b) => ({ value: b.id, label: b.name })) : []),
  ];

  return (
    <form onSubmit={submit} className="space-y-4" data-testid={testId}>
      <ApiErrorAlert error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label="Désignation"
          required
          value={values.name}
          onChange={(e) => set('name')(e.target.value)}
        />
        <InputField
          label={creating ? 'Référence (générée si vide)' : 'Référence'}
          value={values.sku}
          onChange={(e) => set('sku')(e.target.value)}
        />
        <SelectField
          label="Catégorie"
          options={categoryOptions}
          value={values.categoryId}
          onChange={(e) => set('categoryId')(e.target.value)}
        />
        <SelectField
          label="Marque"
          options={brandOptions}
          value={values.brandId}
          onChange={(e) => set('brandId')(e.target.value)}
        />
        <InputField
          label="Unité de vente"
          list="stock-units"
          value={values.unit}
          onChange={(e) => set('unit')(e.target.value)}
        />
        <SelectField
          label="TVA"
          options={VAT_OPTIONS}
          value={values.vatRate}
          onChange={(e) => set('vatRate')(e.target.value)}
        />
        <InputField
          label="Prix de vente TTC"
          type="number"
          min={0}
          required
          disabled={!pricesEditable}
          hint={
            pricesEditable
              ? undefined
              : creating
                ? 'Prix fixé par un responsable : l’article est créé à 0 en attendant.'
                : 'Modification réservée aux personnes autorisées.'
          }
          value={creating && !pricesEditable ? '0' : values.salePrice}
          onChange={(e) => set('salePrice')(e.target.value)}
        />
        {canSeePurchase && (
          <InputField
            label="Prix d’achat HT (facultatif)"
            type="number"
            min={0}
            disabled={!pricesEditable}
            value={values.purchasePrice}
            onChange={(e) => set('purchasePrice')(e.target.value)}
          />
        )}
        <InputField
          label="Seuil d’alerte (facultatif)"
          type="number"
          min={0}
          step="any"
          value={values.minStock}
          onChange={(e) => set('minStock')(e.target.value)}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={values.isStockable}
            onChange={(e) => set('isStockable')(e.target.checked)}
          />
          Article stocké (décocher pour un service)
        </label>
      </div>
      <InputField
        label="Description (facultatif)"
        value={values.description}
        onChange={(e) => set('description')(e.target.value)}
      />
      <datalist id="stock-units">
        {STOCK_SALE_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <Button type="submit" disabled={loading}>
        {creating ? 'Créer l’article' : 'Enregistrer'}
      </Button>
    </form>
  );
}
