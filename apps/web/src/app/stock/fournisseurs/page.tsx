'use client';

import { useState } from 'react';
import { StockPage } from '@/components/stock/stock-page';
import { type StockSupplierView, asApiError } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { SimpleForm, type SimpleField } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const FIELDS = (s?: StockSupplierView): SimpleField[] => [
  { name: 'name', label: 'Raison sociale', required: true, defaultValue: s?.name },
  { name: 'contactName', label: 'Contact', defaultValue: s?.contactName ?? '' },
  { name: 'phone', label: 'Téléphone', defaultValue: s?.phone ?? '' },
  { name: 'email', label: 'E-mail', type: 'email', defaultValue: s?.email ?? '' },
  { name: 'address', label: 'Adresse', defaultValue: s?.address ?? '' },
  { name: 'city', label: 'Ville', defaultValue: s?.city ?? '' },
  { name: 'country', label: 'Pays (code à 2 lettres)', defaultValue: s?.country ?? 'ML' },
  { name: 'nif', label: 'NIF', defaultValue: s?.nif ?? '' },
  {
    name: 'leadTimeDays',
    label: 'Délai de livraison habituel (jours)',
    type: 'number',
    defaultValue: s?.leadTimeDays != null ? String(s.leadTimeDays) : '',
  },
  { name: 'notes', label: 'Notes', defaultValue: s?.notes ?? '' },
];

/** Fournisseurs : fiches (S1). Commandes et réceptions arrivent au sprint S3. */
export default function StockSuppliersPage() {
  return (
    <StockPage
      title="Fournisseurs"
      description="Coordonnées et délais de livraison de vos fournisseurs."
    >
      {({ canWrite }) => <Suppliers manage={canWrite('stock.suppliers.manage')} />}
    </StockPage>
  );
}

function Suppliers({ manage }: { manage: boolean }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<StockSupplierView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const suppliers = useApi<StockSupplierView[]>(
    `/ocall-stock/suppliers?${new URLSearchParams({ archived: String(archived), ...(q.trim() ? { q: q.trim() } : {}) })}`,
  );

  async function toggle(s: StockSupplierView) {
    setError(null);
    try {
      await api(`/ocall-stock/suppliers/${s.id}`, {
        method: 'PATCH',
        body: { isArchived: !s.isArchived },
      });
      suppliers.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <InputField
            label="Rechercher (nom, contact, téléphone, ville)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Archivés compris
          </label>
        </CardBody>
      </Card>
      {suppliers.state === 'loading' && <LoadingState />}
      {suppliers.state === 'error' && (
        <ErrorState error={suppliers.error} onRetry={suppliers.reload} />
      )}
      {suppliers.state === 'success' && (
        <Card>
          {suppliers.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun fournisseur.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-supplier-list">
              <Table head={['Fournisseur', 'Contact', 'Délai', '']}>
                {suppliers.data.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-xs text-muted">
                        {[s.city, s.country, s.nif].filter(Boolean).join(' · ')}
                      </span>
                    </Td>
                    <Td>{[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td>{s.leadTimeDays === null ? '—' : `${s.leadTimeDays} j`}</Td>
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {s.isArchived && <Badge>Archivé</Badge>}
                        {manage && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                              Modifier
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => void toggle(s)}>
                              {s.isArchived ? 'Réactiver' : 'Archiver'}
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
      {manage && editing && (
        <Card>
          <CardHeader title={`Modifier ${editing.name}`} />
          <CardBody>
            <SimpleForm
              key={editing.id}
              path={`/ocall-stock/suppliers/${editing.id}`}
              method="PATCH"
              sendEmpty
              submitLabel="Enregistrer"
              fields={FIELDS(editing)}
              onDone={() => {
                setEditing(null);
                suppliers.reload();
              }}
            />
          </CardBody>
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader title="Nouveau fournisseur" />
          <CardBody>
            <SimpleForm
              testId="stock-supplier-form"
              path="/ocall-stock/suppliers"
              submitLabel="Ajouter le fournisseur"
              fields={FIELDS()}
              onDone={() => suppliers.reload()}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
