'use client';

import { type FormEvent, useState } from 'react';
import type { StockCustomerView } from '@/components/stock/pos';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import { asApiError } from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Clients du magasin (facultatifs sur une vente) : nom, téléphone, e-mail, note. */
export default function StockCustomersPage() {
  return (
    <StockPage title="Clients" description="Clients du magasin, choisis à la caisse.">
      {(p) =>
        p.can('stock.customers.read') ? (
          <Customers {...p} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            La liste des clients est réservée aux membres autorisés.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Customers({ canWrite }: StockPageProps) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const list = useApi<StockCustomerView[]>(
    `/ocall-stock/customers?${new URLSearchParams({
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(archived ? { archived: 'true' } : {}),
    })}`,
  );
  const manage = canWrite('stock.customers.manage');
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-72">
          <InputField
            label="Rechercher (nom, téléphone, e-mail)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Afficher les archivés
        </label>
      </div>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          {list.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">Aucun client.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-customer-list">
              <Table head={['Client', 'Téléphone', 'E-mail', '']}>
                {list.data.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <span className="font-semibold">{c.name}</span>
                      {c.isArchived && <span className="ml-2 text-xs text-muted">(archivé)</span>}
                      {c.note && <span className="block text-xs text-muted">{c.note}</span>}
                    </Td>
                    <Td>{c.phone ?? '—'}</Td>
                    <Td>{c.email ?? '—'}</Td>
                    <Td className="text-right">
                      {manage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void api(`/ocall-stock/customers/${c.id}`, {
                              method: 'PATCH',
                              body: { isArchived: !c.isArchived },
                            }).then(list.reload)
                          }
                        >
                          {c.isArchived ? 'Réactiver' : 'Archiver'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {manage && <NewCustomer onDone={list.reload} />}
    </>
  );
}

function NewCustomer({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/ocall-stock/customers', {
        method: 'POST',
        body: { name, phone: phone || null, email: email || null, note: note || null },
      });
      setName('');
      setPhone('');
      setEmail('');
      setNote('');
      onDone();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Nouveau client" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-customer-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Nom"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <InputField
              label="Téléphone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <InputField
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <InputField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit">Ajouter le client</Button>
        </form>
      </CardBody>
    </Card>
  );
}
