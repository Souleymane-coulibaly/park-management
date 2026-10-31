'use client';

import { type FormEvent, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import {
  PARK_APP_PRODUCT_CODES,
  SAAS_PRODUCT_STATUSES,
  SAAS_PRODUCT_STATUS_LABELS,
  type SaasProductStatus,
  formatXof,
  isProductCode,
} from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import type { SuiteProduct } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS_TONE: Record<SaasProductStatus, 'forest' | 'savanna' | 'neutral'> = {
  AVAILABLE: 'forest',
  UPCOMING: 'savanna',
  RETIRED: 'neutral',
};

const statusOptions = SAAS_PRODUCT_STATUSES.map((s) => ({
  value: s,
  label: SAAS_PRODUCT_STATUS_LABELS[s],
}));

/**
 * Catalogue des produits Ocall Suite. Un produit n'est commercialisable qu'avec au moins une offre
 * active ; un produit « à venir » (ex. Ocall School) est visible mais ne peut pas être souscrit.
 */
export default function ProductsPage() {
  const products = useApi<SuiteProduct[]>('/platform/products');
  const canManage = useCanPlatform('platform.products.manage');
  const canManagePlans = useCanPlatform('platform.plans.manage');
  const [creating, setCreating] = useState(false);
  const [planFor, setPlanFor] = useState<SuiteProduct | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function changeStatus(p: SuiteProduct, status: SaasProductStatus) {
    setError(null);
    setNotice(null);
    try {
      await api(`/platform/products/${p.id}`, { method: 'PATCH', body: { status } });
      setNotice(`${p.name} : ${SAAS_PRODUCT_STATUS_LABELS[status]}.`);
      products.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Produits"
        description="Catalogue des applications Ocall. Les offres Ocall Park se modifient dans « Abonnements et offres » ; les autres produits reçoivent ici leurs offres."
        action={
          canManage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Nouveau produit
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        <ApiErrorAlert error={error} />
      </div>
      {products.state === 'loading' && <LoadingState />}
      {products.state === 'error' && (
        <ErrorState error={products.error} onRetry={products.reload} />
      )}
      {products.state === 'success' &&
        (products.data.length === 0 ? (
          <EmptyState
            icon={<Package className="h-7 w-7" />}
            title="Aucun produit"
            description="Le catalogue est initialisé par la migration."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {products.data.map((p) => (
              <Card key={p.id}>
                <CardHeader
                  title={p.name}
                  description={p.code}
                  action={
                    <Badge tone={STATUS_TONE[p.status]}>
                      {SAAS_PRODUCT_STATUS_LABELS[p.status]}
                    </Badge>
                  }
                />
                <CardBody>
                  {p.description && <p className="text-sm text-muted">{p.description}</p>}
                  {p.features.length > 0 && (
                    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm">
                      {p.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
                  <h3 className="mt-4 text-sm font-semibold">Offres</h3>
                  {p.plans.length === 0 ? (
                    <p className="text-sm text-muted">
                      Aucune offre : produit non commercialisable.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {p.plans.map((pl) => (
                        <li key={pl.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            {pl.name}
                            {!pl.isActive && <span className="text-muted"> (inactive)</span>}
                          </span>
                          <span className="tabular-nums text-muted">
                            {formatXof(pl.setupFee)} + {formatXof(pl.monthlyPrice)}/mois
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canManagePlans && !PARK_APP_PRODUCT_CODES.includes(p.code) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setPlanFor(p)}
                    >
                      Ajouter une offre
                    </Button>
                  )}
                  <p className="mt-3 text-sm text-muted">{p.subscriptions} abonnement(s)</p>
                  {canManage && (
                    <div className="mt-4 max-w-xs">
                      <SelectField
                        label="Statut"
                        value={p.status}
                        onChange={(e) => changeStatus(p, e.target.value as SaasProductStatus)}
                        options={statusOptions}
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        ))}
      <CreatePlanDialog
        product={planFor}
        onClose={() => setPlanFor(null)}
        onCreated={(name) => {
          setPlanFor(null);
          setNotice(`Offre ${name} créée.`);
          products.reload();
        }}
      />
      <CreateProductDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(name) => {
          setCreating(false);
          setNotice(`Produit ${name} créé.`);
          products.reload();
        }}
      />
    </>
  );
}

function CreateProductDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', description: '', features: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/platform/products', {
        method: 'POST',
        body: {
          code: form.code.trim(),
          name: form.name.trim(),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          // Un nouveau produit démarre « à venir » : il devient commercialisable avec une offre active.
          status: 'UPCOMING',
          features: form.features
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean),
        },
      });
      onCreated(form.name.trim());
      setForm({ code: '', name: '', description: '', features: '' });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouveau produit"
      description="Créé « à venir » : il ne pourra être souscrit qu'après création d'une offre active."
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Code"
          hint="Majuscules, chiffres et soulignés, ex. OCALL_SCHOOL."
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          error={form.code && !isProductCode(form.code) ? 'Code invalide.' : undefined}
        />
        <InputField
          label="Nom"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <InputField
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <label className="block text-sm font-medium">
          Fonctionnalités (une par ligne)
          <textarea
            className="mt-1 block min-h-24 w-full rounded-xl border border-line px-3 py-2"
            value={form.features}
            onChange={(e) => setForm({ ...form, features: e.target.value })}
          />
        </label>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={!isProductCode(form.code) || !form.name.trim()}
          >
            Créer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreatePlanDialog({
  product,
  onClose,
  onCreated,
}: {
  product: SuiteProduct | null;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [form, setForm] = useState({ name: '', monthlyPrice: '', setupFee: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/platform/products/${product.id}/plans`, {
        method: 'POST',
        body: {
          name: form.name.trim(),
          monthlyPrice: Number(form.monthlyPrice),
          setupFee: Number(form.setupFee || 0),
        },
      });
      onCreated(form.name.trim());
      setForm({ name: '', monthlyPrice: '', setupFee: '' });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title="Ajouter une offre"
      description={`${product?.name ?? ''} : tarif proposé aux nouvelles souscriptions, figé pour chaque client à son activation.`}
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Nom de l’offre"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Mensualité (FCFA)"
            type="number"
            min={0}
            required
            value={form.monthlyPrice}
            onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
          />
          <InputField
            label="Mise en service (FCFA)"
            type="number"
            min={0}
            value={form.setupFee}
            onChange={(e) => setForm({ ...form, setupFee: e.target.value })}
          />
        </div>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={form.name.trim().length < 2 || form.monthlyPrice === ''}
          >
            Créer l’offre
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
