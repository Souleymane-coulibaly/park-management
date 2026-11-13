'use client';

import { useState } from 'react';
import {
  FACTURE_DEFAULT_VAT_RATE,
  FACTURE_VAT_RATES,
  formatVatRate,
  formatXof,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { SimpleForm, type SimpleField } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export interface FactureItemView {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  reference: string | null;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number;
  vatRate: number;
  isArchived: boolean;
  /** S5 : article miroir d'Ocall Stock (lecture seule tant que le lien existe). */
  stockVariantId?: string | null;
}

const VAT_OPTIONS = FACTURE_VAT_RATES.map((r) => ({ value: String(r), label: formatVatRate(r) }));

const FIELDS = (i?: FactureItemView): SimpleField[] => [
  {
    name: 'kind',
    label: 'Type',
    type: 'select',
    defaultValue: i?.kind ?? 'SERVICE',
    options: [
      { value: 'SERVICE', label: 'Prestation' },
      { value: 'PRODUCT', label: 'Article ou pièce' },
    ],
  },
  { name: 'reference', label: 'Référence (facultatif)', defaultValue: i?.reference ?? '' },
  { name: 'name', label: 'Désignation', required: true, defaultValue: i?.name },
  { name: 'unit', label: 'Unité', defaultValue: i?.unit ?? 'unité' },
  {
    name: 'unitPrice',
    label: 'Prix unitaire HT (FCFA)',
    type: 'number',
    required: true,
    defaultValue: i ? String(i.unitPrice) : '',
  },
  {
    name: 'vatRate',
    label: 'TVA',
    type: 'select',
    defaultValue: String(i?.vatRate ?? FACTURE_DEFAULT_VAT_RATE),
    options: VAT_OPTIONS,
  },
  { name: 'description', label: 'Description (facultatif)', defaultValue: i?.description ?? '' },
];

/** Catalogue : articles et prestations, prix hors taxe en FCFA, TVA par liste de 0 à 20 %. */
export default function FactureCatalogPage() {
  return (
    <FacturePage
      title="Catalogue"
      description="Articles, pièces et prestations proposés sur vos devis et factures."
    >
      {({ canWrite }) => <Catalog canManage={canWrite('facture.catalog.manage')} />}
    </FacturePage>
  );
}

function Catalog({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<FactureItemView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const items = useApi<FactureItemView[]>(
    `/facture/items?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), archived: String(archived) })}`,
  );

  async function unlink(item: FactureItemView) {
    setError(null);
    try {
      await api(`/facture/stock/items/${item.id}/unlink`, { method: 'POST' });
      items.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    }
  }

  async function toggleArchive(item: FactureItemView) {
    setError(null);
    try {
      await api(`/facture/items/${item.id}`, {
        method: 'PATCH',
        body: { isArchived: !item.isArchived },
      });
      items.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <InputField
            label="Rechercher (désignation, référence)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Afficher les éléments archivés
          </label>
        </CardBody>
      </Card>
      {items.state === 'loading' && <LoadingState />}
      {items.state === 'error' && <ErrorState error={items.error} onRetry={items.reload} />}
      {items.state === 'success' && (
        <Card>
          {items.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Catalogue vide.</p>
            </CardBody>
          ) : (
            <div data-testid="facture-item-list">
              <Table head={['Désignation', 'Prix HT', 'TVA', '']}>
                {items.data.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <span className="block font-semibold">{i.name}</span>
                      <span className="block text-xs text-muted">
                        {[i.reference, i.kind === 'SERVICE' ? 'Prestation' : 'Article']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Td>
                    <Td>
                      {formatXof(i.unitPrice)} / {i.unit}
                    </Td>
                    <Td>{formatVatRate(i.vatRate)}</Td>
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {i.isArchived && <Badge>Archivé</Badge>}
                        {i.stockVariantId && <Badge tone="forest">Ocall Stock</Badge>}
                        {canManage && (
                          <>
                            {i.stockVariantId ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void unlink(i)}
                                title="L’article redevient un article Facture ordinaire"
                              >
                                Délier
                              </Button>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => setEditing(i)}>
                                Modifier
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void toggleArchive(i)}
                            >
                              {i.isArchived ? 'Réactiver' : 'Archiver'}
                            </Button>
                          </>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {canManage && editing && (
        <Card>
          <CardHeader title={`Modifier ${editing.name}`} />
          <CardBody>
            <SimpleForm
              key={editing.id}
              path={`/facture/items/${editing.id}`}
              method="PATCH"
              sendEmpty
              submitLabel="Enregistrer"
              fields={FIELDS(editing)}
              numeric={['vatRate']}
              onDone={() => {
                setEditing(null);
                items.reload();
              }}
            />
          </CardBody>
        </Card>
      )}
      {canManage && (
        <Card>
          <CardHeader title="Nouvel élément" />
          <CardBody>
            <SimpleForm
              testId="facture-item-form"
              path="/facture/items"
              submitLabel="Ajouter au catalogue"
              fields={FIELDS()}
              numeric={['vatRate']}
              onDone={() => items.reload()}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
