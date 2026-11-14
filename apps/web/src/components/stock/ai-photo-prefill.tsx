'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { STOCK_AI_BARCODE_LABEL } from '@ocall/shared';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, apiUpload } from '@/lib/api';
import { type StockBrandView, asApiError } from './stock-types';

interface PhotoResult {
  proposal: { id: string } | null;
  readable: boolean;
  name: string;
  brand: string;
  size: string;
  category: { id: string; name: string } | null;
  barcode: string | null;
  barcodeRejected: boolean;
  existingProduct: { id: string; name: string } | null;
}

export interface PhotoPrefill {
  proposalId: string;
  initial: { name?: string; description?: string; categoryId?: string; brandId?: string };
  barcode: string | null;
}

/**
 * « Préremplir depuis une photo (IA) » (S8) : l'IA lit l'emballage et propose nom, contenance, marque et
 * catégorie ; un code-barres n'est proposé que si sa clé est juste, marqué « lu sur la photo, à
 * vérifier ». Rien n'est enregistré : le commerçant vérifie la fiche et la crée lui-même.
 */
export function AiPhotoPrefill({
  brands,
  onPrefill,
}: {
  brands: StockBrandView[];
  onPrefill: (prefill: PhotoPrefill) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<PhotoResult | null>(null);

  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await apiUpload<PhotoResult>('/ocall-stock/ai/product-photo', form);
      setResult(r);
      if (r.readable && r.proposal) {
        const brand = brands.find((b) => b.name.toLowerCase() === r.brand.toLowerCase());
        onPrefill({
          proposalId: r.proposal.id,
          initial: {
            name: [r.name, r.size].filter(Boolean).join(' '),
            categoryId: r.category?.id,
            brandId: brand?.id,
            description: r.brand && !brand ? `Marque : ${r.brand}` : undefined,
          },
          barcode: r.barcode,
        });
      }
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-xl border border-dashed border-line p-3"
      data-testid="stock-ai-photo"
    >
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-forest">
        <Sparkles className="h-4 w-4" aria-hidden />
        {busy ? 'Lecture de la photo…' : 'Préremplir depuis une photo (IA)'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      <ApiErrorAlert error={error} />
      {result && !result.readable && (
        <Alert tone="info" title="Photo illisible">
          L’IA n’a pas reconnu d’article : saisissez la fiche, ou essayez une photo plus nette.
        </Alert>
      )}
      {result?.readable && (
        <Alert tone="info" title="Fiche préremplie par l’IA : vérifiez avant d’enregistrer">
          {result.barcode && (
            <p>
              Code-barres {result.barcode} — {STOCK_AI_BARCODE_LABEL.toLowerCase()} ; il sera ajouté
              à l’article après sa création.
            </p>
          )}
          {result.barcodeRejected && (
            <p>Un code lu sur la photo avait une clé de contrôle fausse : il a été écarté.</p>
          )}
          {result.existingProduct && (
            <p>
              Ce code-barres appartient déjà à{' '}
              <Link
                href={`/stock/articles/${result.existingProduct.id}`}
                className="font-semibold underline"
              >
                {result.existingProduct.name}
              </Link>
              .
            </p>
          )}
        </Alert>
      )}
    </div>
  );
}
