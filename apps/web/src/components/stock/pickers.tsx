'use client';

import { useState } from 'react';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import {
  type StockLocationView,
  type StockLookup,
  type StockProductDetail,
  type StockProductPage,
  type StockSiteView,
  type StockVariantRef,
  asApiError,
  variantLabel,
} from './stock-types';

/**
 * Choix d'un article (variante) : scan (lecteur ou caméra) ou recherche. Un article à déclinaisons
 * demande de choisir la variante.
 */
export function VariantPicker({
  value,
  onChange,
  label = 'Article',
  testId,
}: {
  value: StockVariantRef | null;
  onChange: (v: StockVariantRef | null) => void;
  label?: string;
  testId?: string;
}) {
  const [q, setQ] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [choices, setChoices] = useState<StockVariantRef[] | null>(null);
  const results = useApi<StockProductPage>(
    q.trim()
      ? `/ocall-stock/products?${new URLSearchParams({ q: q.trim(), pageSize: '8' })}`
      : null,
  );

  async function pickProduct(productId: string) {
    const p = await api<StockProductDetail>(`/ocall-stock/products/${productId}`);
    const variants = p.variants
      .filter((v) => !v.isArchived)
      .map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        product: { id: p.id, name: p.name, unit: p.unit },
      }));
    if (variants.length === 1) {
      onChange(variants[0]!);
      setChoices(null);
    } else {
      setChoices(variants);
    }
    setQ('');
  }

  async function onScan(code: string) {
    try {
      const found = await api<StockLookup>(`/ocall-stock/lookup?code=${encodeURIComponent(code)}`);
      if (!found.found) {
        setFeedback({ tone: 'warn', message: `Code inconnu : ${code}` });
        return;
      }
      onChange({
        id: found.variant.id,
        name: found.variant.name,
        sku: found.variant.sku,
        product: { id: found.product.id, name: found.product.name },
      });
      setFeedback({ tone: 'ok', message: found.product.name });
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  if (value) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-3 py-2"
        data-testid={testId}
      >
        <span>
          <span className="block text-xs text-muted">{label}</span>
          <span className="font-semibold">{variantLabel(value)}</span>{' '}
          <span className="font-mono text-xs text-muted">{value.sku}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Changer
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-line p-3" data-testid={testId}>
      <ScanField
        label={`${label} : scanner`}
        onScan={onScan}
        feedback={feedback}
        autoFocus={false}
      />
      <InputField
        label={`${label} : rechercher`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.state === 'success' && q.trim() && (
        <ul className="divide-y divide-line/60 text-sm">
          {results.data.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-1.5">
              <span>
                {p.name} <span className="text-xs text-muted">{p.sku}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => void pickProduct(p.id)}>
                Choisir
              </Button>
            </li>
          ))}
          {results.data.items.length === 0 && <li className="py-1.5 text-muted">Aucun article.</li>}
        </ul>
      )}
      {choices && (
        <SelectField
          label="Variante"
          value=""
          onChange={(e) => {
            const v = choices.find((c) => c.id === e.target.value);
            if (v) {
              onChange(v);
              setChoices(null);
            }
          }}
          options={[
            { value: '', label: 'Choisir…' },
            ...choices.map((c) => ({ value: c.id, label: `${c.name ?? 'Article'} · ${c.sku}` })),
          ]}
        />
      )}
    </div>
  );
}

/** Emplacements actifs d'un site, libellés « A-01-03 · Emplacement A-01-03 ». */
export function useSiteLocations(siteId: string | null) {
  const site = useApi<StockSiteView>(siteId ? `/ocall-stock/sites/${siteId}` : null);
  const locations: StockLocationView[] =
    site.state === 'success' ? (site.data.locations ?? []).filter((l) => !l.isArchived) : [];
  return { site, locations };
}

/** Choix d'un emplacement : liste du site choisi, ou scan du QR code de l'emplacement. */
export function LocationPicker({
  sites,
  siteId,
  onSite,
  locationId,
  onLocation,
  lockSite = false,
  label = 'Emplacement',
  testId,
}: {
  sites: StockSiteView[];
  siteId: string;
  onSite: (id: string) => void;
  locationId: string;
  onLocation: (id: string) => void;
  lockSite?: boolean;
  label?: string;
  testId?: string;
}) {
  const { locations } = useSiteLocations(siteId || null);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);

  async function onScan(code: string) {
    try {
      const found = await api<{
        found: boolean;
        location?: { id: string; code: string; site: { id: string } };
      }>(`/ocall-stock/locations/lookup?code=${encodeURIComponent(code)}`);
      if (!found.found || !found.location) {
        setFeedback({ tone: 'warn', message: 'QR code d’emplacement inconnu.' });
        return;
      }
      if (lockSite && found.location.site.id !== siteId) {
        setFeedback({ tone: 'error', message: 'Cet emplacement est dans un autre site.' });
        return;
      }
      onSite(found.location.site.id);
      onLocation(found.location.id);
      setFeedback({ tone: 'ok', message: `Emplacement ${found.location.code}` });
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={testId}>
      <SelectField
        label="Site"
        value={siteId}
        disabled={lockSite}
        onChange={(e) => {
          onSite(e.target.value);
          onLocation('');
        }}
        options={[
          { value: '', label: 'Choisir…' },
          ...sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
        ]}
      />
      <SelectField
        label={label}
        value={locationId}
        onChange={(e) => onLocation(e.target.value)}
        options={[
          { value: '', label: 'Choisir…' },
          ...locations.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
        ]}
      />
      <div className="sm:col-span-2">
        <ScanField
          label={`${label} : scanner son QR code`}
          onScan={onScan}
          feedback={feedback}
          autoFocus={false}
        />
      </div>
    </div>
  );
}
