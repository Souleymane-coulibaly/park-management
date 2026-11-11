'use client';

import { type FormEvent, useState } from 'react';
import { StockPage } from '@/components/stock/stock-page';
import {
  type StockBrandView,
  type StockCategoryView,
  asApiError,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Catégories (deux niveaux : catégorie, sous-catégorie) et marques. Rien n'est supprimé : archivage. */
export default function StockCategoriesPage() {
  return (
    <StockPage
      title="Catégories et marques"
      description="Deux niveaux de catégories : catégorie et sous-catégorie."
    >
      {({ canWrite }) => <Content manage={canWrite('stock.catalog.manage')} />}
    </StockPage>
  );
}

function Content({ manage }: { manage: boolean }) {
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const categories = useApi<StockCategoryView[]>(`/ocall-stock/categories?archived=${archived}`);
  const brands = useApi<StockBrandView[]>(`/ocall-stock/brands?archived=${archived}`);

  async function run(work: () => Promise<unknown>, after: () => void) {
    setError(null);
    try {
      await work();
      after();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        Afficher les éléments archivés
      </label>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Catégories" />
          <CardBody className="space-y-4">
            {categories.state === 'loading' && <LoadingState />}
            {categories.state === 'error' && (
              <ErrorState error={categories.error} onRetry={categories.reload} />
            )}
            {categories.state === 'success' && (
              <ul className="space-y-2" data-testid="stock-category-tree">
                {categories.data
                  .filter((c) => !c.parentId)
                  .map((top) => (
                    <li key={top.id}>
                      <Row
                        name={top.name}
                        archived={top.isArchived}
                        manage={manage}
                        onToggle={() =>
                          void run(
                            () =>
                              api(`/ocall-stock/categories/${top.id}`, {
                                method: 'PATCH',
                                body: { isArchived: !top.isArchived },
                              }),
                            categories.reload,
                          )
                        }
                      />
                      <ul className="ml-5 mt-1 space-y-1 border-l border-line pl-3">
                        {categories.data
                          .filter((c) => c.parentId === top.id)
                          .map((sub) => (
                            <li key={sub.id}>
                              <Row
                                name={sub.name}
                                archived={sub.isArchived}
                                manage={manage}
                                onToggle={() =>
                                  void run(
                                    () =>
                                      api(`/ocall-stock/categories/${sub.id}`, {
                                        method: 'PATCH',
                                        body: { isArchived: !sub.isArchived },
                                      }),
                                    categories.reload,
                                  )
                                }
                              />
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                {categories.data.length === 0 && (
                  <li className="text-sm text-muted">Aucune catégorie.</li>
                )}
              </ul>
            )}
            {manage && categories.state === 'success' && (
              <NewCategory
                parents={categories.data.filter((c) => !c.parentId && !c.isArchived)}
                onCreate={(body) =>
                  run(
                    () => api('/ocall-stock/categories', { method: 'POST', body }),
                    categories.reload,
                  )
                }
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Marques" />
          <CardBody className="space-y-4">
            {brands.state === 'loading' && <LoadingState />}
            {brands.state === 'error' && (
              <ErrorState error={brands.error} onRetry={brands.reload} />
            )}
            {brands.state === 'success' && (
              <ul className="space-y-1" data-testid="stock-brand-list">
                {brands.data.map((b) => (
                  <li key={b.id}>
                    <Row
                      name={b.name}
                      archived={b.isArchived}
                      manage={manage}
                      onToggle={() =>
                        void run(
                          () =>
                            api(`/ocall-stock/brands/${b.id}`, {
                              method: 'PATCH',
                              body: { isArchived: !b.isArchived },
                            }),
                          brands.reload,
                        )
                      }
                    />
                  </li>
                ))}
                {brands.data.length === 0 && <li className="text-sm text-muted">Aucune marque.</li>}
              </ul>
            )}
            {manage && (
              <NameForm
                label="Nouvelle marque"
                submit="Ajouter la marque"
                onSubmit={(name) =>
                  run(
                    () => api('/ocall-stock/brands', { method: 'POST', body: { name } }),
                    brands.reload,
                  )
                }
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({
  name,
  archived,
  manage,
  onToggle,
}: {
  name: string;
  archived: boolean;
  manage: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="flex items-center justify-between gap-3 text-sm">
      <span className={archived ? 'text-muted line-through' : 'font-medium'}>{name}</span>
      <span className="flex items-center gap-2">
        {archived && <Badge>Archivé</Badge>}
        {manage && (
          <button type="button" className="text-xs text-forest hover:underline" onClick={onToggle}>
            {archived ? 'Réactiver' : 'Archiver'}
          </button>
        )}
      </span>
    </span>
  );
}

function NewCategory({
  parents,
  onCreate,
}: {
  parents: StockCategoryView[];
  onCreate: (body: { name: string; parentId: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate({ name, parentId: parentId || null });
    setName('');
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3"
      data-testid="stock-category-form"
    >
      <InputField
        label="Nouvelle catégorie"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField
        label="Dans"
        value={parentId}
        onChange={(e) => setParentId(e.target.value)}
        options={[
          { value: '', label: 'Premier niveau' },
          ...parents.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <Button type="submit" variant="secondary">
        Ajouter
      </Button>
    </form>
  );
}

function NameForm({
  label,
  submit: submitLabel,
  onSubmit,
}: {
  label: string;
  submit: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(name);
    setName('');
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <InputField label={label} required value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="secondary">
        {submitLabel}
      </Button>
    </form>
  );
}
